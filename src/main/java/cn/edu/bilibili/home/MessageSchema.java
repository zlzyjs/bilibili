package cn.edu.bilibili.home;

import jakarta.annotation.PostConstruct;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

@Component
class MessageSchema {
    private final JdbcClient jdbc;

    MessageSchema(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @PostConstruct
    void upgrade() {
        add("usertable", "MessageNotificationState", "JSON NULL");
        add("privatemessagetable", "InboxFiltered", "BOOLEAN NOT NULL DEFAULT FALSE");
        add("privatemessagetable", "InboxImageMime", "VARCHAR(16) NULL");
        add("privatemessagetable", "InboxImageBytes", "MEDIUMBLOB NULL");
        add("systemnotificationtable", "MentionKind", "ENUM('comment','reply') NULL");
        add("systemnotificationtable", "MentionTarget", "BIGINT UNSIGNED NULL");
        if (!exists("STATISTICS", "INDEX_NAME", "systemnotificationtable", "unique_notification_mention")) {
            jdbc.sql("""
                    ALTER TABLE systemnotificationtable ADD UNIQUE KEY unique_notification_mention
                        (ReceiverUID, MentionKind, MentionTarget)
                    """).update();
        }
        migrate();
    }

    private void migrate() {
        if (oldTable("message_image")) {
            jdbc.sql("""
                    UPDATE privatemessagetable m JOIN message_image i ON i.message_id=m.MessageID
                    SET m.InboxImageMime=i.mime, m.InboxImageBytes=i.image_bytes
                    WHERE m.MessageType=1 AND m.InboxImageBytes IS NULL
                    """).update();
        }
        if (oldTable("message_filtered")) {
            jdbc.sql("""
                    UPDATE privatemessagetable m JOIN message_filtered f ON f.message_id=m.MessageID
                    SET m.InboxFiltered=1 WHERE m.InboxFiltered=0
                    """).update();
        }
        boolean oldMentions = oldTable("message_mention");
        if (oldMentions) {
            jdbc.sql("""
                    INSERT INTO systemnotificationtable(ReceiverUID,NotificationContent,MentionKind,MentionTarget)
                    SELECT receiver,'@',target_type,target_id FROM message_mention
                    ON DUPLICATE KEY UPDATE MentionTarget=systemnotificationtable.MentionTarget
                    """).update();
        }
        if (!oldTable("message_event_state")) return;
        for (String category : new String[]{"system", "replies", "likes", "mentions"}) {
            if (category.equals("mentions") && !oldMentions) continue;
            String fields = category.equals("mentions") ? """
                    CAST(n.NotificationID AS CHAR),s.dismissed) AS flags
                    FROM message_event_state s JOIN message_mention m
                      ON m.id=CAST(s.event_id AS UNSIGNED) AND m.receiver=s.uid
                    JOIN systemnotificationtable n ON n.ReceiverUID=m.receiver
                      AND CAST(n.MentionKind AS BINARY)=CAST(m.target_type AS BINARY)
                      AND n.MentionTarget=m.target_id
                    """ : "s.event_id,s.dismissed) AS flags FROM message_event_state s ";
            jdbc.sql("""
                    UPDATE usertable u JOIN (
                        SELECT s.uid,JSON_OBJECTAGG(
                    """ + fields + """
                        WHERE s.category=:category AND s.dismissed=1 GROUP BY s.uid
                    ) legacy ON legacy.uid=u.UID
                    SET u.MessageNotificationState=JSON_MERGE_PATCH(JSON_OBJECT(:category,legacy.flags),
                        COALESCE(u.MessageNotificationState,JSON_OBJECT()))
                    """).param("category", category).update();
        }
    }

    private void add(String table, String column, String type) {
        if (!exists("COLUMNS", "COLUMN_NAME", table, column)) {
            jdbc.sql("ALTER TABLE " + table + " ADD COLUMN " + column + " " + type).update();
        }
    }

    private boolean oldTable(String table) {
        return jdbc.sql("""
                SELECT EXISTS(SELECT 1 FROM information_schema.TABLES
                  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:table)
                """).param("table", table).query(Boolean.class).single();
    }

    private boolean exists(String metadata, String field, String table, String name) {
        return jdbc.sql("SELECT EXISTS(SELECT 1 FROM information_schema." + metadata
                + " WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:table AND " + field + "=:name)")
                .param("table", table).param("name", name).query(Boolean.class).single();
    }
}

