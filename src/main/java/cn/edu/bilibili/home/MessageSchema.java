package cn.edu.bilibili.home;

import jakarta.annotation.PostConstruct;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

@Component
class MessageSchema {
    // Matches videotable.VideoContent, including its character set and collation.
    private static final String IMAGE_URL_TYPE = "VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL";
    private final JdbcClient jdbc;
    private final OssMedia oss;

    MessageSchema(JdbcClient jdbc, OssMedia oss) {
        this.jdbc = jdbc;
        this.oss = oss;
    }

    @PostConstruct
    void upgrade() {
        migrateCommentImages();
        if (column("systemnotificationtable", "MentionKind") && column("systemnotificationtable", "MentionTarget")) {
            jdbc.sql("""
                    UPDATE systemnotificationtable
                    SET NotificationContent=CONCAT(CHAR(30 USING utf8mb4),'mention:',MentionKind,':',MentionTarget)
                    WHERE MentionKind IS NOT NULL AND MentionTarget IS NOT NULL AND ASCII(NotificationContent)<>30
                    """).update();
        }
        migrateMentions(jdbc.sql("""
                SELECT CAST(ReceiverUID AS CHAR),
                       SUBSTRING_INDEX(SUBSTRING_INDEX(NotificationContent,':',2),':',-1),
                       SUBSTRING_INDEX(NotificationContent,':',-1)
                FROM systemnotificationtable WHERE %s
                """.formatted(MessageEvents.LEGACY_MENTION)));
        if (oldTable("message_mention")) {
            migrateMentions(jdbc.sql("""
                    SELECT CAST(receiver AS CHAR),target_type,CAST(target_id AS CHAR) FROM message_mention
                    """));
        }
    }

    private void migrateMentions(JdbcClient.StatementSpec source) {
        var mentions = source.query((rs, row) -> new LegacyMention(rs.getString(1), rs.getString(2), rs.getString(3))).list();
        for (var mention : mentions) {
            boolean comment = "comment".equals(mention.kind());
            jdbc.sql("""
                    UPDATE %s c
                    SET c.Content=CONCAT(CHAR(30 USING utf8mb4),JSON_SET(
                        CASE WHEN ASCII(c.Content)=30 THEN JSON_EXTRACT(SUBSTRING(c.Content,2),'$')
                             ELSE JSON_OBJECT('text',c.Content) END,
                        '$.mentions',JSON_ARRAY_APPEND(COALESCE(
                            CASE WHEN ASCII(c.Content)=30 THEN JSON_EXTRACT(SUBSTRING(c.Content,2),'$.mentions') END,
                            JSON_ARRAY()),'$',:uid)))
                    WHERE c.%s=CAST(:id AS UNSIGNED) AND NOT COALESCE(%s,FALSE)
                    """.formatted(comment ? "commenttable" : "replytable", comment ? "CommentID" : "ReplyID",
                            CommentContent.mentions("c"))).param("uid", mention.uid()).param("id", mention.target()).update();
        }
    }

    private void migrateCommentImages() {
        ensureCommentImageUrl();
        if (column("commenttable", "ImagePath")) {
            jdbc.sql("UPDATE commenttable SET ImageUrl=ImagePath WHERE ImageUrl IS NULL AND ImagePath IS NOT NULL").update();
        }
        jdbc.sql("""
                UPDATE commenttable c SET c.ImageUrl=%1$s
                WHERE c.ImageUrl IS NULL AND %1$s IS NOT NULL
                """.formatted(CommentContent.LEGACY_IMAGE)).update();
        jdbc.sql("""
                UPDATE commenttable c
                SET c.Content=CONCAT(CHAR(30 USING utf8mb4),JSON_REMOVE(SUBSTRING(c.Content,2),'$.image'))
                WHERE c.ImageUrl IS NOT NULL AND BINARY c.ImageUrl=BINARY (%s)
                """.formatted(CommentContent.LEGACY_IMAGE)).update();
        if (!column("commenttable", "ImageBytes") || !column("commenttable", "ImageMime")) return;
        while (true) {
            var batch = jdbc.sql("""
                    SELECT CommentID,UID,ImageMime,ImageBytes FROM commenttable
                    WHERE ImageUrl IS NULL AND ImageMime IN ('image/png','image/jpeg','image/gif')
                      AND OCTET_LENGTH(ImageBytes)>0 ORDER BY CommentID LIMIT 5
                    """).query((rs, row) -> new LegacyImage(rs.getString(1), rs.getString(2),
                            rs.getString(3), rs.getBytes(4))).list();
            if (batch.isEmpty()) return;
            for (var image : batch) {
                String path = oss.putImage("media/comment/" + image.uid() + "/", image.mime(), image.bytes());
                jdbc.sql("""
                        UPDATE commenttable SET ImageUrl=:image
                        WHERE CommentID=CAST(:id AS UNSIGNED) AND ImageUrl IS NULL
                        """).param("image", path)
                        .param("id", image.id()).update();
            }
        }
    }

    private void ensureCommentImageUrl() {
        String current = jdbc.sql("""
                SELECT COLUMN_NAME FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='commenttable' AND LOWER(COLUMN_NAME)='imageurl'
                """).query(String.class).optional().orElse(null);
        if ("ImageUrl".equals(current)) return;
        String ddl = current != null ? "CHANGE COLUMN imageurl ImageUrl "
                : column("commenttable", "ImagePath") ? "CHANGE COLUMN ImagePath ImageUrl " : "ADD COLUMN ImageUrl ";
        jdbc.sql("ALTER TABLE commenttable " + ddl + IMAGE_URL_TYPE).update();
    }

    private boolean oldTable(String table) {
        return jdbc.sql("""
                SELECT EXISTS(SELECT 1 FROM information_schema.TABLES
                  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:table)
                """).param("table", table).query(Boolean.class).single();
    }

    private boolean column(String table, String name) {
        return jdbc.sql("""
                SELECT EXISTS(SELECT 1 FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:table AND COLUMN_NAME=:name)
                """).param("table", table).param("name", name).query(Boolean.class).single();
    }

    private record LegacyImage(String id, String uid, String mime, byte[] bytes) {}
    private record LegacyMention(String uid, String kind, String target) {}
}

