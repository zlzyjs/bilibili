package cn.edu.bilibili.home;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
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
    private static final Pattern MENTION = Pattern.compile(
            "(?<![\\p{L}\\p{N}_])[@＠](?:\\{([^{}\\r\\n]{1,80})\\}|([\\p{L}\\p{M}\\p{N}_-]+))");
    private static final String VISIBLE = """
            ((m.SenderUID=CAST(:uid AS UNSIGNED) AND m.SenderDel=0) OR (m.ReceiverUID=CAST(:uid AS UNSIGNED) AND m.ReceiverDel=0
              AND m.InboxFiltered=0))
            """;
    private static final String PAIR = """
            ((m.SenderUID=CAST(:uid AS UNSIGNED) AND m.ReceiverUID=CAST(:peer AS UNSIGNED)) OR (m.SenderUID=CAST(:peer AS UNSIGNED) AND m.ReceiverUID=CAST(:uid AS UNSIGNED)))
            """;
    private final JdbcClient jdbc;

    MessageStore(JdbcClient jdbc) {
        this.jdbc = jdbc;
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
                  WHERE m.SenderUID=CAST(:peer AS UNSIGNED) AND m.ReceiverUID=CAST(:uid AS UNSIGNED)
                    AND m.InboxFiltered=0)
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
        jdbc.sql("""
                INSERT INTO privatemessagetable(SenderUID,ReceiverUID,MessageType,MessageContent,
                    InboxImageMime,InboxImageBytes)
                VALUES (CAST(:uid AS UNSIGNED),CAST(:peer AS UNSIGNED),:type,:value,:mime,:bytes)
                """).param("uid", uid).param("peer", peer).param("type", type).param("value", value)
                .param("mime", image == null ? null : image.mime(), java.sql.Types.VARCHAR)
                .param("bytes", image == null ? null : image.bytes(), java.sql.Types.LONGVARBINARY).update();
    }

    List<Conversation> conversations(String uid, int offset) {
        return jdbc.sql("""
                WITH ranked AS (
                  SELECT m.MessageID,m.MessageType,IF(m.MessageType=0,m.MessageContent,NULL) AS preview, IF(m.SenderUID=CAST(:uid AS UNSIGNED),m.ReceiverUID,m.SenderUID) AS peer,
                    ROW_NUMBER() OVER(PARTITION BY IF(m.SenderUID=CAST(:uid AS UNSIGNED),m.ReceiverUID,m.SenderUID)
                                      ORDER BY m.MessageID DESC) AS position
                  FROM privatemessagetable m
                  WHERE %s
                )
                SELECT m.peer,u.Name,m.MessageType,m.preview
                FROM ranked m LEFT JOIN usertable u ON u.UID=m.peer
                WHERE m.position=1 ORDER BY m.MessageID DESC LIMIT 50 OFFSET :offset
                """.formatted(VISIBLE)).param("uid", uid).param("offset", offset)
                .query((rs, row) -> new Conversation(rs.getString(1), rs.getString(2), rs.getInt(3),
                        rs.getString(4))).list();
    }

    ThreadView thread(String uid, String peer, String before) {
        String name = jdbc.sql("SELECT Name FROM usertable WHERE UID=CAST(:peer AS UNSIGNED)").param("peer", peer)
                .query(String.class).optional().orElseThrow(() -> new ResponseStatusException(NOT_FOUND, "该账号不存在"));
        boolean restricted = restricted(uid, peer);
        String issue = null;
        if (jdbc.sql("""
                SELECT EXISTS(SELECT 1 FROM relationtable WHERE RelationType=1 AND
                  ((UID=CAST(:uid AS UNSIGNED) AND TargetUID=CAST(:peer AS UNSIGNED)) OR (UID=CAST(:peer AS UNSIGNED) AND TargetUID=CAST(:uid AS UNSIGNED))))
                """).param("uid", uid).param("peer", peer).query(Boolean.class).single()) {
            issue = "双方存在黑名单关系，无法发送";
        } else if (restricted && sentBefore(uid, peer)) {
            issue = "等待对方回复或关注你后，才可继续发送";
        }
        List<Chat> rows = jdbc.sql("""
                SELECT m.MessageID,m.SenderUID,m.MessageType,IF(m.MessageType=0,m.MessageContent,NULL),m.SendTime,v.VideoID
                FROM privatemessagetable m
                LEFT JOIN LATERAL (
                    SELECT VideoID FROM videotable WHERE VideoContent=m.MessageContent
                      AND VideoStatus='published' AND VisibleStatus='public' ORDER BY VideoID LIMIT 1
                ) v ON m.MessageType=2
                WHERE %s AND %s AND (:before IS NULL OR m.MessageID<CAST(:before AS UNSIGNED))
                ORDER BY m.MessageID DESC LIMIT 41
                """.formatted(PAIR, VISIBLE)).param("uid", uid).param("peer", peer).param("before", before)
                .query((rs, row) -> new Chat(rs.getString(1), rs.getString(2), rs.getInt(3), rs.getString(4),
                        rs.getObject(5, LocalDateTime.class), rs.getString(6))).list();
        return new ThreadView(name, restricted, issue, rows.stream().limit(40).toList(), rows.size() > 40);
    }

    Image privateImage(String uid, String id) {
        return jdbc.sql("""
                SELECT m.InboxImageMime,m.InboxImageBytes,m.MessageContent FROM privatemessagetable m
                WHERE m.MessageID=CAST(:id AS UNSIGNED) AND m.MessageType=1 AND %s
                """.formatted(VISIBLE)).param("uid", uid).param("id", id)
                .query((rs, row) -> rs.getString(1) != null ? new Image(rs.getString(1), rs.getBytes(2))
                        : new Image(null, rs.getString(3).getBytes(StandardCharsets.UTF_8)))
                .optional().orElseThrow(() -> new ResponseStatusException(NOT_FOUND, "图片不可用"));
    }

    Image imageUpload(MultipartFile file) {
        if (file.isEmpty() || file.getSize() > 4 * 1024 * 1024) {
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

    void mentions(String author, String type, Number target, String content) {
        var matcher = MENTION.matcher(content);
        while (matcher.find()) {
            jdbc.sql("""
                    INSERT INTO systemnotificationtable(ReceiverUID,NotificationContent,MentionKind,MentionTarget)
                    SELECT UID,'@',:type,CAST(:id AS UNSIGNED) FROM usertable WHERE AccountStatus='active'
                      AND UID<>CAST(:author AS UNSIGNED) AND CAST(Name AS BINARY)=CAST(:name AS BINARY)
                    ON DUPLICATE KEY UPDATE MentionTarget=systemnotificationtable.MentionTarget
                    """).param("type", type).param("id", target).param("author", author)
                    .param("name", matcher.group(1) == null ? matcher.group(2) : matcher.group(1)).update();
        }
    }

    record Image(String mime, byte[] bytes) {}
    record Conversation(String uid, String name, int type, String preview) {}
    record Chat(String id, String sender, int type, String text, LocalDateTime sentAt, String videoId) {}
    record ThreadView(String name, boolean restricted, String issue, List<Chat> messages, boolean hasMore) {}
}

