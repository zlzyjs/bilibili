package cn.edu.bilibili.home;

import java.time.LocalDateTime;
import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

@Service
class MessageEvents {
    private static final String REPLY_TREE = """
            WITH RECURSIVE reply_tree AS (
                SELECT r.ReplyID,r.UID,r.Content,r.ReplyTime,r.ReplyTargetID,r.ReplyTargetType,c.VideoID,1 AS depth
                FROM replytable r JOIN commenttable c ON r.ReplyTargetType=1 AND r.ReplyTargetID=c.CommentID
                WHERE r.ReplyStatus='active' AND c.CommentStatus='active'
                UNION ALL
                SELECT r.ReplyID,r.UID,r.Content,r.ReplyTime,r.ReplyTargetID,r.ReplyTargetType,t.VideoID,t.depth+1
                FROM replytable r JOIN reply_tree t ON r.ReplyTargetType=0 AND r.ReplyTargetID=t.ReplyID
                WHERE r.ReplyStatus='active' AND t.depth<30
            )
            """;
    private final JdbcClient jdbc;

    MessageEvents(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    private String source(String category) {
        return switch (category) {
            case "replies" -> """
                SELECT CAST(r.ReplyID AS CHAR) AS id,r.UID AS actor,'reply' AS kind,r.ReplyID AS target,
                       r.Content AS body,COALESCE(c.Content,p.Content) AS context,r.ReplyTime AS sentAt,r.VideoID AS video
                FROM reply_tree r
                LEFT JOIN commenttable c ON r.ReplyTargetType=1 AND r.ReplyTargetID=c.CommentID
                LEFT JOIN replytable p ON r.ReplyTargetType=0 AND r.ReplyTargetID=p.ReplyID
                WHERE COALESCE(c.UID,p.UID)=CAST(:uid AS UNSIGNED) AND r.UID<>CAST(:uid AS UNSIGNED)
                """;
            case "mentions" -> """
                SELECT CAST(m.id AS CHAR) AS id,COALESCE(c.UID,r.UID) AS actor,m.target_type AS kind,m.target_id AS target,
                       COALESCE(c.Content,r.Content) AS body,NULL AS context,
                       COALESCE(c.CommentTime,r.ReplyTime) AS sentAt,COALESCE(c.VideoID,r.VideoID) AS video
                FROM message_mention m
                LEFT JOIN commenttable c ON m.target_type='comment' AND m.target_id=c.CommentID AND c.CommentStatus='active'
                LEFT JOIN reply_tree r ON m.target_type='reply' AND m.target_id=r.ReplyID
                WHERE m.receiver=CAST(:uid AS UNSIGNED) AND COALESCE(c.UID,r.UID) IS NOT NULL
                """;
            case "likes" -> """
                SELECT CONCAT(l.UID,':',l.LikeTargetType,':',l.LikeTargetID,':',UNIX_TIMESTAMP(l.LikeTime)) AS id,
                       l.UID AS actor,ELT(l.LikeTargetType+1,'video','danmaku','comment','reply') AS kind,
                       l.LikeTargetID AS target,NULL AS body,COALESCE(v.VideoTitle,d.Content,c.Content,r.Content) AS context,
                       l.LikeTime AS sentAt,COALESCE(v.VideoID,d.VideoID,c.VideoID,r.VideoID) AS video
                FROM liketable l
                LEFT JOIN videotable v ON l.LikeTargetType=0 AND l.LikeTargetID=v.VideoID AND v.UID=CAST(:uid AS UNSIGNED)
                LEFT JOIN danmakutable d ON l.LikeTargetType=1 AND l.LikeTargetID=d.DanmakuID AND d.UID=CAST(:uid AS UNSIGNED)
                    AND d.DanmakuStatus='active'
                LEFT JOIN commenttable c ON l.LikeTargetType=2 AND l.LikeTargetID=c.CommentID AND c.UID=CAST(:uid AS UNSIGNED)
                    AND c.CommentStatus='active'
                LEFT JOIN reply_tree r ON l.LikeTargetType=3 AND l.LikeTargetID=r.ReplyID AND r.UID=CAST(:uid AS UNSIGNED)
                WHERE COALESCE(v.UID,d.UID,c.UID,r.UID) IS NOT NULL AND l.UID<>CAST(:uid AS UNSIGNED)
                """;
            case "system" -> """
                SELECT CAST(NotificationID AS CHAR) AS id,NULL AS actor,NULL AS kind,NULL AS target,
                       NotificationContent AS body,NULL AS context,NotificationTime AS sentAt,NULL AS video
                FROM systemnotificationtable WHERE ReceiverUID=CAST(:uid AS UNSIGNED)
                """;
            default -> throw new IllegalArgumentException(category);
        };
    }

    private String events(String category) {
        return (category.equals("system") ? "WITH " : REPLY_TREE + ", ") + """
                events AS (
                  SELECT e.*,u.Name AS name,s.event_id IS NULL AS unread,
                    EXISTS(SELECT 1 FROM relationtable WHERE UID=CAST(:uid AS UNSIGNED)
                      AND TargetUID=e.actor AND RelationType=0) AS following
                  FROM (%s) e
                  LEFT JOIN usertable u ON u.UID=e.actor
                  LEFT JOIN message_event_state s ON s.uid=CAST(:uid AS UNSIGNED)
                    AND s.category=:category AND s.event_id=e.id
                  WHERE COALESCE(s.dismissed,0)=0 %s
                )
                """.formatted(source(category), category.equals("system") ? "" : """
                  AND EXISTS(SELECT 1 FROM videotable v WHERE v.VideoID=e.video
                      AND v.VideoStatus='published' AND v.VisibleStatus='public')
                """);
    }

    List<Event> list(String uid, String category, int offset) {
        return jdbc.sql(events(category) + """
                SELECT e.*, EXISTS(SELECT 1 FROM liketable l WHERE l.UID=CAST(:uid AS UNSIGNED)
                               AND l.LikeTargetID=e.target AND l.LikeTargetType=IF(e.kind='comment',2,3)) AS liked
                FROM events e ORDER BY e.sentAt DESC,e.id DESC LIMIT 40 OFFSET :offset
                """).param("uid", uid).param("category", category).param("offset", offset)
                .query((rs, row) -> new Event(rs.getString("id"), rs.getString("actor"), rs.getString("name"),
                        rs.getString("kind"), rs.getString("target"), rs.getString("body"), rs.getString("context"),
                        rs.getObject("sentAt", LocalDateTime.class), rs.getString("video"), rs.getBoolean("liked"),
                        rs.getBoolean("unread"))).list();
    }

    int unread(String uid, String category, String policy) {
        if (policy.equals("none")) return 0;
        return jdbc.sql(events(category) + "SELECT COUNT(*) FROM events WHERE unread AND (:policy='all' OR following)")
                .param("uid", uid).param("category", category).param("policy", policy).query(Integer.class).single();
    }

    void updateState(String uid, String category, List<String> ids, boolean dismissed) {
        if (ids.isEmpty()) return;
        jdbc.sql("""
                INSERT INTO message_event_state (uid,category,event_id,dismissed)
                """ + events(category) + """
                SELECT :uid,:category,id,:dismissed FROM events WHERE id IN (:ids)
                ON DUPLICATE KEY UPDATE dismissed=GREATEST(message_event_state.dismissed,:dismissed)
                """).param("uid", uid).param("category", category).param("ids", ids).param("dismissed", dismissed).update();
    }

    record Event(String id, String actor, String name, String kind, String target, String body, String context,
                 LocalDateTime sentAt, String video, boolean liked, boolean unread) {}
}

