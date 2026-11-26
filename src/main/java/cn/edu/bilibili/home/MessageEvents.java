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
    static final String LEGACY_MENTION = """
            REGEXP_LIKE(NotificationContent, CONCAT('^',CHAR(30 USING utf8mb4),'mention:(comment|reply):[0-9]{1,20}$'),'c')
            """.strip();
    private final JdbcClient jdbc;

    MessageEvents(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    private String source(String category) {
        return switch (category) {
            case "replies" -> """
                SELECT CAST(r.ReplyID AS CHAR) AS id,r.UID AS actor,'reply' AS kind,r.ReplyID AS target,
                       %s AS body,COALESCE(%s,%s) AS context,r.ReplyTime AS sentAt,r.VideoID AS video
                FROM reply_tree r
                LEFT JOIN commenttable c ON r.ReplyTargetType=1 AND r.ReplyTargetID=c.CommentID
                LEFT JOIN replytable p ON r.ReplyTargetType=0 AND r.ReplyTargetID=p.ReplyID
                WHERE COALESCE(c.UID,p.UID)=CAST(:uid AS UNSIGNED) AND r.UID<>CAST(:uid AS UNSIGNED)
                """.formatted(CommentContent.text("r"), CommentContent.text("c"), CommentContent.text("p"));
            case "mentions" -> """
                SELECT CONCAT('comment:',c.CommentID) AS id,c.UID AS actor,'comment' AS kind,c.CommentID AS target,
                       %s AS body,NULL AS context,c.CommentTime AS sentAt,c.VideoID AS video
                FROM commenttable c WHERE c.CommentStatus='active' AND %s
                UNION ALL
                SELECT CONCAT('reply:',r.ReplyID),r.UID,'reply',r.ReplyID,%s,NULL,r.ReplyTime,r.VideoID
                FROM reply_tree r WHERE %s
                """.formatted(CommentContent.text("c"), CommentContent.mentions("c"),
                        CommentContent.text("r"), CommentContent.mentions("r"));
            case "likes" -> """
                SELECT CONCAT(l.UID,':',l.LikeTargetType,':',l.LikeTargetID,':',UNIX_TIMESTAMP(l.LikeTime)) AS id,
                       l.UID AS actor,ELT(l.LikeTargetType+1,'video','danmaku','comment','reply') AS kind,
                       l.LikeTargetID AS target,NULL AS body,COALESCE(v.VideoTitle,d.Content,%s,%s) AS context,
                       l.LikeTime AS sentAt,COALESCE(v.VideoID,d.VideoID,c.VideoID,r.VideoID) AS video
                FROM liketable l
                LEFT JOIN videotable v ON l.LikeTargetType=0 AND l.LikeTargetID=v.VideoID AND v.UID=CAST(:uid AS UNSIGNED)
                LEFT JOIN danmakutable d ON l.LikeTargetType=1 AND l.LikeTargetID=d.DanmakuID AND d.UID=CAST(:uid AS UNSIGNED)
                    AND d.DanmakuStatus='active'
                LEFT JOIN commenttable c ON l.LikeTargetType=2 AND l.LikeTargetID=c.CommentID AND c.UID=CAST(:uid AS UNSIGNED)
                    AND c.CommentStatus='active'
                LEFT JOIN reply_tree r ON l.LikeTargetType=3 AND l.LikeTargetID=r.ReplyID AND r.UID=CAST(:uid AS UNSIGNED)
                WHERE COALESCE(v.UID,d.UID,c.UID,r.UID) IS NOT NULL AND l.UID<>CAST(:uid AS UNSIGNED)
                """.formatted(CommentContent.text("c"), CommentContent.text("r"));
            case "system" -> """
                SELECT CAST(NotificationID AS CHAR) AS id,NULL AS actor,NULL AS kind,NULL AS target,
                       NotificationContent AS body,NULL AS context,NotificationTime AS sentAt,NULL AS video
                FROM systemnotificationtable WHERE ReceiverUID=CAST(:uid AS UNSIGNED) AND NOT %s
                """.formatted(LEGACY_MENTION);
            default -> throw new IllegalArgumentException(category);
        };
    }

    private String events(String category) {
        return (category.equals("system") ? "WITH " : REPLY_TREE + ", ") + """
                events AS (
                  SELECT e.*,u.Name AS name
                  FROM (%s) e
                  LEFT JOIN usertable u ON u.UID=e.actor
                  %s
                )
                """.formatted(source(category), category.equals("system") ? "" : """
                  WHERE EXISTS(SELECT 1 FROM videotable v WHERE v.VideoID=e.video
                      AND v.VideoStatus='published' AND v.VisibleStatus='public')
                """);
    }

    List<Event> list(String uid, String category, int offset) {
        return jdbc.sql(events(category) + """
                SELECT e.*, EXISTS(SELECT 1 FROM liketable l WHERE l.UID=CAST(:uid AS UNSIGNED)
                               AND l.LikeTargetID=e.target AND l.LikeTargetType=IF(e.kind='comment',2,3)) AS liked
                FROM events e ORDER BY e.sentAt DESC,e.id DESC LIMIT 40 OFFSET :offset
                """).param("uid", uid).param("offset", offset)
                .query((rs, row) -> new Event(rs.getString("id"), rs.getString("actor"), rs.getString("name"),
                        rs.getString("kind"), rs.getString("target"), rs.getString("body"), rs.getString("context"),
                        rs.getObject("sentAt", LocalDateTime.class), rs.getString("video"), rs.getBoolean("liked"))).list();
    }

    record Event(String id, String actor, String name, String kind, String target, String body, String context,
                 LocalDateTime sentAt, String video, boolean liked) {}
}

