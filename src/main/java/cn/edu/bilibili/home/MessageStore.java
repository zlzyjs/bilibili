package cn.edu.bilibili.home;

import java.io.IOException;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
import javax.imageio.ImageIO;
import javax.imageio.stream.MemoryCacheImageInputStream;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import static org.springframework.http.HttpStatus.*;

@Service
class MessageStore {
    private static final int IMAGE_LIMIT = 4 * 1024 * 1024;
    private static final Pattern MENTION = Pattern.compile(
            "(?<![\\p{L}\\p{N}_])[@＠](?:\\{([^{}\\r\\n]{1,80})\\}|([\\p{L}\\p{M}\\p{N}_-]+))");
    private static final String VISIBLE = """
            ((m.SenderUID=CAST(:uid AS UNSIGNED) AND m.SenderDel=0) OR (m.ReceiverUID=CAST(:uid AS UNSIGNED) AND m.ReceiverDel=0))
            AND NOT EXISTS(SELECT 1 FROM relationtable b WHERE b.RelationType=1 AND b.UID=CAST(:uid AS UNSIGNED)
              AND b.TargetUID=IF(m.SenderUID=CAST(:uid AS UNSIGNED),m.ReceiverUID,m.SenderUID))
            """;
    private static final String PAIR = """
            ((m.SenderUID=CAST(:uid AS UNSIGNED) AND m.ReceiverUID=CAST(:peer AS UNSIGNED)) OR (m.SenderUID=CAST(:peer AS UNSIGNED) AND m.ReceiverUID=CAST(:uid AS UNSIGNED)))
            """;
    private final JdbcClient jdbc;
    private final OssMedia oss;

    MessageStore(JdbcClient jdbc, OssMedia oss) {
        this.jdbc = jdbc;
        this.oss = oss;
    }

    void lockParticipants(String uid, String peer) {
        for (String id : List.of(uid, peer).stream().sorted().toList()) {
            jdbc.sql("SELECT UID FROM usertable WHERE UID=CAST(:id AS UNSIGNED) FOR UPDATE")
                    .param("id", id).query(String.class).optional();
        }
    }

    private boolean follows(String uid, String peer) {
        return jdbc.sql("""
                SELECT EXISTS(SELECT 1 FROM relationtable WHERE UID=CAST(:uid AS UNSIGNED) AND TargetUID=CAST(:peer AS UNSIGNED) AND RelationType=0)
                """).param("uid", uid).param("peer", peer).query(Boolean.class).single();
    }

    private boolean restricted(String uid, String peer) {
        return !follows(peer, uid) && !jdbc.sql("""
                SELECT EXISTS(SELECT 1 FROM privatemessagetable m
                  WHERE m.SenderUID=CAST(:peer AS UNSIGNED) AND m.ReceiverUID=CAST(:uid AS UNSIGNED))
                """).param("uid", uid).param("peer", peer).query(Boolean.class).single();
    }

    private boolean sentBefore(String uid, String peer) {
        return jdbc.sql("""
                SELECT EXISTS(SELECT 1 FROM privatemessagetable WHERE SenderUID=CAST(:uid AS UNSIGNED) AND ReceiverUID=CAST(:peer AS UNSIGNED))
                """).param("uid", uid).param("peer", peer).query(Boolean.class).single();
    }

    void send(String uid, String peer, int type, String value, Image image) {
        if (restricted(uid, peer) && sentBefore(uid, peer)) {
            throw new ResponseStatusException(CONFLICT, "对方回复或关注你前，最多发送 1 条消息");
        }
        if (type == 2) {
            value = jdbc.sql("""
                    SELECT VideoContent FROM videotable WHERE VideoID=CAST(:id AS UNSIGNED)
                      AND VideoStatus='published' AND VisibleStatus='public' FOR SHARE
                    """).param("id", value).query(String.class)
                    .optional().orElseThrow(() -> new ResponseStatusException(NOT_FOUND, "视频不可用"));
        }
        if (image != null) {
            value = oss.putImage("media/message/" + uid + "/" + peer + "/", image.mime(), image.bytes());
        }
        jdbc.sql("""
                INSERT INTO privatemessagetable(SenderUID,ReceiverUID,MessageType,MessageContent)
                VALUES (CAST(:uid AS UNSIGNED),CAST(:peer AS UNSIGNED),:type,:value)
                """).param("uid", uid).param("peer", peer).param("type", type).param("value", value).update();
    }

    void deleteForViewer(String uid, String id) {
        int updated = jdbc.sql("""
                UPDATE privatemessagetable
                SET SenderDel=IF(SenderUID=CAST(:uid AS UNSIGNED),1,SenderDel),
                    ReceiverDel=IF(ReceiverUID=CAST(:uid AS UNSIGNED),1,ReceiverDel)
                WHERE MessageID=CAST(:id AS UNSIGNED) AND
                  ((SenderUID=CAST(:uid AS UNSIGNED) AND SenderDel=0)
                   OR (ReceiverUID=CAST(:uid AS UNSIGNED) AND ReceiverDel=0))
                """).param("uid", uid).param("id", id).update();
        if (updated == 0) throw new ResponseStatusException(NOT_FOUND, "消息不可用");
    }

    void recall(String uid, String id) {
        int deleted = jdbc.sql("""
                DELETE FROM privatemessagetable
                WHERE MessageID=CAST(:id AS UNSIGNED) AND SenderUID=CAST(:uid AS UNSIGNED) AND SenderDel=0
                  AND SendTime BETWEEN CURRENT_TIMESTAMP - INTERVAL 180 SECOND AND CURRENT_TIMESTAMP
                """).param("uid", uid).param("id", id).update();
        if (deleted == 0) throw new ResponseStatusException(CONFLICT, "只能撤回三分钟内自己发送的消息");
    }

    List<Conversation> conversations(String uid, int offset) {
        return jdbc.sql("""
                WITH ranked AS (
                  SELECT m.*, IF(m.SenderUID=CAST(:uid AS UNSIGNED),m.ReceiverUID,m.SenderUID) AS peer,
                    ROW_NUMBER() OVER(PARTITION BY IF(m.SenderUID=CAST(:uid AS UNSIGNED),m.ReceiverUID,m.SenderUID)
                                      ORDER BY m.MessageID DESC) AS position
                  FROM privatemessagetable m
                  WHERE %s
                )
                SELECT m.peer,u.Name,m.MessageType,IF(m.MessageType=0,m.MessageContent,NULL)
                FROM ranked m LEFT JOIN usertable u ON u.UID=m.peer
                WHERE m.position=1 ORDER BY m.MessageID DESC LIMIT 50 OFFSET :offset
                """.formatted(VISIBLE)).param("uid", uid).param("offset", offset)
                .query((rs, row) -> new Conversation(rs.getString(1), rs.getString(2), rs.getInt(3),
                        rs.getString(4))).list();
    }

    ThreadView thread(String uid, String peer, String before) {
        String name = jdbc.sql("SELECT Name FROM usertable WHERE UID=CAST(:peer AS UNSIGNED)").param("peer", peer)
                .query(String.class).optional().orElseThrow(() -> new ResponseStatusException(NOT_FOUND, "该账号不存在"));
        boolean blocked = jdbc.sql("""
                SELECT EXISTS(SELECT 1 FROM relationtable WHERE RelationType=1 AND
                  ((UID=CAST(:uid AS UNSIGNED) AND TargetUID=CAST(:peer AS UNSIGNED)) OR (UID=CAST(:peer AS UNSIGNED) AND TargetUID=CAST(:uid AS UNSIGNED))))
                """).param("uid", uid).param("peer", peer).query(Boolean.class).single();
        String issue = blocked ? "双方存在黑名单关系，无法发送" : null;
        boolean canSend = !blocked && !(restricted(uid, peer) && sentBefore(uid, peer));
        List<Chat> rows = jdbc.sql("""
                SELECT m.MessageID,m.SenderUID,m.MessageType,IF(m.MessageType=0,m.MessageContent,NULL),m.SendTime,v.VideoID,u.Name,v.UID,
                       (m.SenderUID=CAST(:uid AS UNSIGNED) AND m.SendTime
                         BETWEEN CURRENT_TIMESTAMP - INTERVAL 180 SECOND AND CURRENT_TIMESTAMP
                         AND NOT EXISTS (SELECT 1 FROM reporttable WHERE TargetType=4 AND TargetID=m.MessageID)) AS recallable
                FROM privatemessagetable m
                LEFT JOIN LATERAL (
                    SELECT VideoID,UID FROM videotable WHERE VideoContent=m.MessageContent
                      AND VideoStatus='published' AND VisibleStatus='public' ORDER BY VideoID LIMIT 1
                ) v ON m.MessageType=2
                LEFT JOIN usertable u ON u.UID=v.UID
                WHERE %s AND %s AND (:before IS NULL OR m.MessageID<CAST(:before AS UNSIGNED))
                ORDER BY m.MessageID DESC LIMIT 41
                """.formatted(PAIR, VISIBLE)).param("uid", uid).param("peer", peer).param("before", before)
                .query((rs, row) -> new Chat(rs.getString(1), rs.getString(2), rs.getInt(3), rs.getString(4),
                        rs.getObject(5, LocalDateTime.class), rs.getString(6), rs.getString(7), rs.getString(8), rs.getBoolean("recallable"))).list();
        return new ThreadView(name, canSend, issue, rows.stream().limit(40).toList(), rows.size() > 40);
    }

    Image privateImage(String uid, String id) {
        String path = jdbc.sql("""
                SELECT m.MessageContent FROM privatemessagetable m
                WHERE m.MessageID=CAST(:id AS UNSIGNED) AND m.MessageType=1 AND %s
                """.formatted(VISIBLE)).param("uid", uid).param("id", id).query(String.class)
                .optional().orElseThrow(() -> new ResponseStatusException(NOT_FOUND, "图片不可用"));
        if (!path.startsWith(oss.reference("media/message/"))) {
            throw new ResponseStatusException(NOT_FOUND, "图片不可用");
        }
        return oss.privateImage(path, IMAGE_LIMIT);
    }

    Image imageUpload(MultipartFile file) {
        if (file.isEmpty() || file.getSize() > IMAGE_LIMIT) {
            throw new ResponseStatusException(BAD_REQUEST, "请选择不超过 4 MB 的图片");
        }
        try (var stream = new MemoryCacheImageInputStream(file.getInputStream())) {
            var readers = ImageIO.getImageReaders(stream);
            if (readers.hasNext()) {
                var reader = readers.next();
                try {
                    reader.setInput(stream, true, true);
                    String format = reader.getFormatName().toLowerCase(Locale.ROOT);
                    if (Set.of("png", "jpeg", "gif").contains(format)
                            && (long) reader.getWidth(0) * reader.getHeight(0) <= 12_000_000
                            && reader.read(0) != null) {
                        return new Image("image/" + format, file.getBytes());
                    }
                } finally {
                    reader.dispose();
                }
            }
        } catch (IOException | RuntimeException ignored) {
            // Malformed image data is a bad request.
        }
        throw new ResponseStatusException(BAD_REQUEST, "请选择有效的 PNG、JPEG 或 GIF 图片");
    }

    String mentionedUsers(String author, String content) {
        var matcher = MENTION.matcher(content);
        var names = new java.util.HashSet<String>();
        while (matcher.find()) {
            names.add(matcher.group(1) == null ? matcher.group(2) : matcher.group(1));
        }
        if (names.isEmpty()) return "[]";
        return jdbc.sql("""
                SELECT COALESCE(JSON_ARRAYAGG(CAST(UID AS CHAR)),JSON_ARRAY())
                FROM usertable WHERE AccountStatus='active'
                  AND UID<>CAST(:author AS UNSIGNED) AND BINARY Name IN (:names)
                """).param("author", author).param("names", names).query(String.class).single();
    }

    record Image(String mime, byte[] bytes) {}
    record Conversation(String uid, String name, int type, String preview) {}
    record Chat(String id, String sender, int type, String text, LocalDateTime sentAt, String videoId,
                String author, String authorId, boolean recallable) {}
    record ThreadView(String name, boolean canSend, String issue, List<Chat> messages, boolean hasMore) {}
}

