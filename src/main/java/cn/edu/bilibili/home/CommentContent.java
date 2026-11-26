package cn.edu.bilibili.home;

final class CommentContent {
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
            CASE WHEN :mentions='[]' THEN :text
                 ELSE CONCAT(CHAR(30 USING utf8mb4),JSON_OBJECT('text',:text,'mentions',CAST(:mentions AS JSON)))
            END
            """.strip();

    static String text(String alias) {
        return TEXT.formatted(alias);
    }

    static String mentions(String alias) {
        return """
                CASE WHEN ASCII(%1$s.Content)=30
                     THEN JSON_CONTAINS(SUBSTRING(%1$s.Content,2),JSON_QUOTE(:uid),'$.mentions')=1
                     ELSE FALSE END
                """.strip().formatted(alias);
    }

    private CommentContent() {}
}
