CREATE TABLE IF NOT EXISTS comment_image (
    comment_id BIGINT UNSIGNED PRIMARY KEY,
    mime VARCHAR(16) NOT NULL,
    image_bytes MEDIUMBLOB NOT NULL,
    CONSTRAINT comment_image_comment_fk FOREIGN KEY (comment_id)
        REFERENCES commenttable (CommentID) ON DELETE CASCADE
) ENGINE=InnoDB;
