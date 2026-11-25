CREATE TABLE IF NOT EXISTS danmaku_style (
    danmaku_id BIGINT UNSIGNED PRIMARY KEY,
    display_mode ENUM('scroll', 'top', 'bottom') NOT NULL,
    font_size ENUM('small', 'standard') NOT NULL,
    color CHAR(7) CHARACTER SET ascii NOT NULL,
    CONSTRAINT danmaku_style_danmaku_fk FOREIGN KEY (danmaku_id)
        REFERENCES danmakutable (DanmakuID) ON DELETE CASCADE
) ENGINE=InnoDB;
