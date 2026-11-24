CREATE TABLE IF NOT EXISTS message_preferences (
    uid BIGINT UNSIGNED PRIMARY KEY,
    reminders BOOLEAN NOT NULL DEFAULT TRUE,
    smart_filter BOOLEAN NOT NULL DEFAULT TRUE,
    keywords JSON NOT NULL DEFAULT (JSON_ARRAY()),
    reply_policy ENUM('all','following','none') NOT NULL DEFAULT 'all',
    mention_policy ENUM('all','following','none') NOT NULL DEFAULT 'all',
    like_alert BOOLEAN NOT NULL DEFAULT TRUE,
    fold_strangers BOOLEAN NOT NULL DEFAULT FALSE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS message_event_state (
    uid BIGINT UNSIGNED NOT NULL,
    category VARCHAR(12) NOT NULL,
    event_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    dismissed BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (uid, category, event_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS message_image (
    message_id BIGINT UNSIGNED PRIMARY KEY,
    mime VARCHAR(16) NOT NULL,
    image_bytes MEDIUMBLOB NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS message_filtered (
    message_id BIGINT UNSIGNED PRIMARY KEY
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS message_mention (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    receiver BIGINT UNSIGNED NOT NULL,
    target_type ENUM('comment','reply') NOT NULL,
    target_id BIGINT UNSIGNED NOT NULL,
    UNIQUE KEY mention_target (receiver, target_type, target_id)
) ENGINE=InnoDB;
