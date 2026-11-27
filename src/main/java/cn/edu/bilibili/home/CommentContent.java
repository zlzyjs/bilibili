package cn.edu.bilibili.home;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;

final class CommentContent {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final TypeReference<List<Tag>> TAG_LIST = new TypeReference<>() {};
    // A record separator distinguishes structured content from user-entered text.
    private static final String TEXT = """
            CASE WHEN ASCII(%1$s.Content)=30
                 THEN JSON_UNQUOTE(JSON_EXTRACT(SUBSTRING(%1$s.Content,2),'$.text'))
                 ELSE %1$s.Content END
            """.strip();
    static final String LEGACY_IMAGE = """
            CASE WHEN ASCII(c.Content)=30
                 THEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(SUBSTRING(c.Content,2),'$.image')),'null') END
            """.strip();
    static final String ENCODE = """
            CASE WHEN :mentions='[]' AND :tags='[]' THEN :text
                 ELSE CONCAT(CHAR(30 USING utf8mb4),JSON_OBJECT('text',:text,'mentions',CAST(:mentions AS JSON),'tags',CAST(:tags AS JSON)))
            END
            """.strip();

    static String text(String alias) {
        return TEXT.formatted(alias);
    }

    static String tags(String alias) {
        return ("CASE WHEN ASCII(%1$s.Content)=30 THEN JSON_EXTRACT(SUBSTRING(%1$s.Content,2),'$.tags') END")
                .formatted(alias);
    }

    static List<Tag> decodeTags(String value) throws JsonProcessingException {
        if (value == null) return List.of();
        List<Tag> tags = JSON.readValue(value, TAG_LIST);
        return tags == null ? List.of() : tags;
    }

    static List<Tag> storedTags(String value) {
        try {
            return decodeTags(value);
        } catch (JsonProcessingException ex) {
            return List.of();
        }
    }

    static String json(Object value) {
        try {
            return JSON.writeValueAsString(value);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Cannot encode comment mentions", ex);
        }
    }

    record Tag(String uid, int start, int end) {}

    static String mentions(String alias) {
        return """
                CASE WHEN ASCII(%1$s.Content)=30
                     THEN JSON_CONTAINS(SUBSTRING(%1$s.Content,2),JSON_QUOTE(:uid),'$.mentions')=1
                     ELSE FALSE END
                """.strip().formatted(alias);
    }

    private CommentContent() {}
}
