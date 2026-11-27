package cn.edu.bilibili.home;

import jakarta.annotation.PostConstruct;
import java.sql.SQLException;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

@Component
class FavoriteFolderSchema {
    private final JdbcClient jdbc;

    FavoriteFolderSchema(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @PostConstruct
    void upgrade() {
        boolean exists = jdbc.sql("""
                SELECT EXISTS(SELECT 1 FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='favourittable' AND COLUMN_NAME='FavoriteDescription')
                """).query(Boolean.class).single();
        if (exists) return;
        try {
            jdbc.sql("ALTER TABLE favourittable ADD COLUMN FavoriteDescription VARCHAR(200) NOT NULL DEFAULT ''").update();
        } catch (DataAccessException ex) {
            // Another application instance can add the column after the existence check.
            if (!(ex.getMostSpecificCause() instanceof SQLException sql) || sql.getErrorCode() != 1060) throw ex;
        }
    }
}
