package cn.edu.bilibili.home;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import org.springframework.dao.DataAccessException;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import static org.springframework.http.HttpStatus.*;

@RestController
@RequestMapping("/api/interactions")
class InteractionController {
    private final JdbcClient jdbc;
    private final AuthController auth;
    private final MysqlVideoCatalog catalog;

    InteractionController(JdbcClient jdbc, AuthController auth, MysqlVideoCatalog catalog) {
        this.jdbc = jdbc;
        this.auth = auth;
        this.catalog = catalog;
    }

    @ModelAttribute
    void disableCaching(HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
    }

    @GetMapping("/likes/{kind}/{id}")
    ToggleView like(@PathVariable String kind, @PathVariable String id, HttpServletRequest request) {
        var target = target(kind);
        if (target == Target.ACCOUNT) throw error(BAD_REQUEST, "不能为账号点赞");
        requireTarget(target, id);
        return likeView(target, id, auth.currentMember(request));
    }

    @PutMapping("/likes/{kind}/{id}")
    @Transactional(isolation = Isolation.READ_COMMITTED)
    ToggleView like(@PathVariable String kind, @PathVariable String id, @RequestBody Toggle input,
                    HttpServletRequest request) {
        var member = write(request, "点赞", "Lv1");
        var target = target(kind);
        if (target == Target.ACCOUNT) throw error(BAD_REQUEST, "不能为账号点赞");
        requireTarget(target, id);
        String sql = enabled(input) ? """
                INSERT INTO liketable (UID, LikeTargetID, LikeTargetType) VALUES (:uid, :id, :type)
                ON DUPLICATE KEY UPDATE LikeTime=LikeTime
                """ : """
                DELETE FROM liketable WHERE UID=CAST(:uid AS UNSIGNED) AND LikeTargetID=CAST(:id AS UNSIGNED) AND LikeTargetType=:type
                """;
        jdbc.sql(sql).param("uid", member.uid()).param("id", id).param("type", target.code).update();
        return likeView(target, id, member);
    }

    private ToggleView likeView(Target target, String id, AuthController.Member member) {
        return jdbc.sql("""
                SELECT COUNT(*), COALESCE(MAX(UID=CAST(:uid AS UNSIGNED)),0)
                FROM liketable WHERE LikeTargetID=CAST(:id AS UNSIGNED) AND LikeTargetType=:type
                """).param("uid", uid(member)).param("id", id).param("type", target.code)
                .query((rs, row) -> new ToggleView(rs.getBoolean(2), rs.getLong(1))).single();
    }

    @GetMapping("/videos/{id}/state")
    VideoState videoState(@PathVariable String id, HttpServletRequest request) {
        requireTarget(Target.VIDEO, id);
        var member = auth.currentMember(request);
        return jdbc.sql("""
                SELECT EXISTS(SELECT 1 FROM liketable WHERE UID=CAST(:uid AS UNSIGNED) AND LikeTargetID=CAST(:id AS UNSIGNED) AND LikeTargetType=0),
                       EXISTS(SELECT 1 FROM collectvideotable c JOIN favourittable f USING(FavouritID)
                              WHERE f.UID=CAST(:uid AS UNSIGNED) AND c.VideoID=CAST(:id AS UNSIGNED)),
                       EXISTS(SELECT 1 FROM subscriptionsummarytable s JOIN videotable v ON v.CompilationID=s.CollectionID
                              WHERE s.UID=CAST(:uid AS UNSIGNED) AND v.VideoID=CAST(:id AS UNSIGNED)),
                       COALESCE((SELECT LastViewingPosition FROM browsinghistorytable WHERE UID=CAST(:uid AS UNSIGNED) AND VideoID=CAST(:id AS UNSIGNED)),0)
                """).param("uid", uid(member)).param("id", id)
                .query((rs, row) -> new VideoState(rs.getBoolean(1), rs.getBoolean(2), rs.getBoolean(3), rs.getInt(4))).single();
    }

    @GetMapping("/videos/{id}/folders")
    List<Folder> folders(@PathVariable String id, HttpServletRequest request) {
        requireTarget(Target.VIDEO, id);
        return folders(read(request).uid(), id);
    }

    private List<Folder> folders(String uid, String video) {
        return jdbc.sql("""
                SELECT f.FavouritID, f.FavoriteName, c.VideoID IS NOT NULL
                FROM favourittable f LEFT JOIN collectvideotable c ON c.FavouritID=f.FavouritID AND c.VideoID=CAST(:id AS UNSIGNED)
                WHERE f.UID=CAST(:uid AS UNSIGNED) ORDER BY (f.FavoriteName='默认收藏夹') DESC, f.FavouritID
                """).param("id", video).param("uid", uid)
                .query((rs, row) -> new Folder(rs.getString(1), rs.getString(2), rs.getBoolean(3))).list();
    }

    @PutMapping("/videos/{id}/folders/{folder}")
    @Transactional(isolation = Isolation.READ_COMMITTED)
    ToggleView favorite(@PathVariable String id, @PathVariable String folder, @RequestBody Toggle input,
                        HttpServletRequest request) {
        var member = write(request, "收藏", "Lv1");
        requireTarget(Target.VIDEO, id);
        requireId(folder);
        if (!exists("SELECT EXISTS(SELECT 1 FROM favourittable WHERE FavouritID=CAST(:id AS UNSIGNED) AND UID=CAST(:uid AS UNSIGNED))", folder, member.uid())) {
            throw error(NOT_FOUND, "收藏夹不存在");
        }
        String sql = enabled(input) ? """
                INSERT INTO collectvideotable (VideoID,FavouritID)
                SELECT :id,FavouritID FROM favourittable WHERE FavouritID=CAST(:folder AS UNSIGNED) AND UID=CAST(:uid AS UNSIGNED)
                ON DUPLICATE KEY UPDATE CollectTime=CollectTime
                """ : """
                DELETE c FROM collectvideotable c JOIN favourittable f USING(FavouritID)
                WHERE c.VideoID=CAST(:id AS UNSIGNED) AND f.FavouritID=CAST(:folder AS UNSIGNED) AND f.UID=CAST(:uid AS UNSIGNED)
                """;
        jdbc.sql(sql).param("id", id).param("folder", folder).param("uid", member.uid()).update();
        boolean selected = folders(member.uid(), id).stream().anyMatch(Folder::selected);
        return new ToggleView(selected, catalog.engagement(id).favorite());
    }

    @PostMapping("/videos/{id}/coins")
    Map<String, Long> coin(@PathVariable String id, @RequestBody NumberInput input, HttpServletRequest request) {
        var member = write(request, "投币", "Lv1");
        requireTarget(Target.VIDEO, id);
        if (input.value() == null || (input.value() != 1 && input.value() != 2)) {
            throw error(BAD_REQUEST, "请选择投 1 枚或 2 枚硬币");
        }
        try {
            jdbc.sql("CALL sp_coin_video(:uid,:id,:coins)").param("uid", member.uid())
                    .param("id", id).param("coins", input.value()).query((rs, row) -> rs.getInt("Coins")).single();
        } catch (DataAccessException ex) {
            if (!(ex.getMostSpecificCause() instanceof SQLException sql) || !"45000".equals(sql.getSQLState())) throw ex;
            String message = switch (sql.getMessage()) {
                case "Cannot coin your own video" -> "不能给自己的视频投币";
                case "Maximum lifetime coins per user and video is 2" -> "同一个视频最多投 2 枚硬币";
                case "Insufficient coin balance" -> "硬币余额不足";
                default -> "当前无法为该视频投币";
            };
            throw error(CONFLICT, message);
        }
        return Map.of("count", catalog.engagement(id).coin());
    }

    @PutMapping("/videos/{id}/subscription")
    @Transactional
    ToggleView subscription(@PathVariable String id, @RequestBody Toggle input, HttpServletRequest request) {
        var member = write(request, "订阅", "Lv1");
        requireTarget(Target.VIDEO, id);
        String collection = jdbc.sql("SELECT CompilationID FROM videotable WHERE VideoID=CAST(:id AS UNSIGNED) AND CompilationID IS NOT NULL")
                .param("id", id).query(String.class).optional().orElseThrow(() -> error(NOT_FOUND, "该视频没有合集"));
        boolean on = enabled(input);
        String sql = on ? """
                INSERT INTO subscriptionsummarytable (UID,CollectionID) VALUES (:uid,:id)
                ON DUPLICATE KEY UPDATE SubscribeTime=SubscribeTime
                """ : "DELETE FROM subscriptionsummarytable WHERE UID=CAST(:uid AS UNSIGNED) AND CollectionID=CAST(:id AS UNSIGNED)";
        jdbc.sql(sql).param("uid", member.uid()).param("id", collection).update();
        return new ToggleView(on, 0);
    }

    @GetMapping("/authors/{id}/relation")
    Relation relation(@PathVariable String id, HttpServletRequest request) {
        requireTarget(Target.ACCOUNT, id);
        return relation(id, auth.currentMember(request));
    }

    @PutMapping("/authors/{id}/relation/{kind}")
    @Transactional
    Relation relation(@PathVariable String id, @PathVariable String kind, @RequestBody Toggle input,
                      HttpServletRequest request) {
        boolean block = switch (kind) {
            case "block" -> true;
            case "follow" -> false;
            default -> throw error(BAD_REQUEST, "无效的关系操作");
        };
        var member = write(request, block ? "拉黑" : "关注&粉丝", block ? "Lv1" : "Lv0");
        requireTarget(Target.ACCOUNT, id);
        if (member.uid().equals(id)) throw error(BAD_REQUEST, "不能对自己的账号执行此操作");
        boolean on = enabled(input);
        if (on && !block && exists("""
                SELECT EXISTS(SELECT 1 FROM relationtable WHERE RelationType=1
                  AND ((UID=CAST(:uid AS UNSIGNED) AND TargetUID=CAST(:id AS UNSIGNED)) OR (UID=CAST(:id AS UNSIGNED) AND TargetUID=CAST(:uid AS UNSIGNED))))
                """, id, member.uid())) throw error(CONFLICT, "双方存在黑名单关系，无法关注");
        String sql = !on ? "DELETE FROM relationtable WHERE UID=CAST(:uid AS UNSIGNED) AND TargetUID=CAST(:id AS UNSIGNED) AND RelationType=:type"
                : block ? """
                INSERT INTO relationtable (UID,TargetUID,RelationType) VALUES (:uid,:id,:type)
                ON DUPLICATE KEY UPDATE CreationTime=IF(RelationType<>1,NOW(),CreationTime), RelationType=1
                """ : """
                INSERT INTO relationtable (UID,TargetUID,RelationType) VALUES (:uid,:id,:type)
                ON DUPLICATE KEY UPDATE CreationTime=CreationTime
                """;
        jdbc.sql(sql).param("uid", member.uid()).param("id", id).param("type", block ? 1 : 0).update();
        return relation(id, member);
    }

    private Relation relation(String id, AuthController.Member member) {
        return jdbc.sql("""
                SELECT (SELECT RelationType FROM relationtable WHERE UID=CAST(:uid AS UNSIGNED) AND TargetUID=CAST(:id AS UNSIGNED)),
                       (SELECT COUNT(*) FROM relationtable WHERE TargetUID=CAST(:id AS UNSIGNED) AND RelationType=0)
                """).param("uid", uid(member)).param("id", id)
                .query((rs, row) -> {
                    Integer type = rs.getObject(1, Integer.class);
                    return new Relation(type != null && type == 0, type != null && type == 1, rs.getLong(2));
                }).single();
    }

    @PostMapping("/videos/{id}/comments")
    ResponseEntity<Void> comment(@PathVariable String id, @RequestBody Text input, HttpServletRequest request) {
        var member = write(request, "评论", "Lv2");
        requireTarget(Target.VIDEO, id);
        jdbc.sql("INSERT INTO commenttable (UID,VideoID,Content) VALUES (:uid,:id,:text)")
                .param("uid", member.uid()).param("id", id).param("text", content(input.value(), 1000)).update();
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/replies/{kind}/{id}")
    ResponseEntity<Void> reply(@PathVariable String kind, @PathVariable String id, @RequestBody Text input,
                               HttpServletRequest request) {
        var member = write(request, "回复", "Lv2");
        var target = target(kind);
        if (target != Target.COMMENT && target != Target.REPLY) throw error(BAD_REQUEST, "无效的回复对象");
        requireTarget(target, id);
        jdbc.sql("INSERT INTO replytable (UID,ReplyTargetID,ReplyTargetType,Content) VALUES (:uid,:id,:type,:text)")
                .param("uid", member.uid()).param("id", id).param("type", target == Target.COMMENT ? 1 : 0)
                .param("text", content(input.value(), 1000)).update();
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/comments/{id}/replies")
    List<MysqlVideoCatalog.ReplyPreview> replies(@PathVariable String id, HttpServletRequest request) {
        read(request);
        requireTarget(Target.COMMENT, id);
        return catalog.replies(id, 100);
    }

    @PostMapping("/videos/{id}/danmaku")
    MysqlVideoCatalog.Danmaku danmaku(@PathVariable String id, @RequestBody TimedText input, HttpServletRequest request) {
        var member = write(request, "弹幕", "Lv2");
        int duration = videoDuration(id);
        int timestamp = position(input.position(), duration);
        var keys = new org.springframework.jdbc.support.GeneratedKeyHolder();
        jdbc.sql("""
                INSERT INTO danmakutable (UID,VideoID,Content,VideoTimestamp) VALUES (:uid,:id,:text,:position)
                """).param("uid", member.uid()).param("id", id).param("text", content(input.value(), 100))
                .param("position", timestamp).update(keys);
        return jdbc.sql("""
                SELECT DanmakuID,UID,Content,VideoTimestamp,SendTime FROM danmakutable WHERE DanmakuID=CAST(:id AS UNSIGNED)
                """).param("id", keys.getKey().toString()).query((rs, row) -> new MysqlVideoCatalog.Danmaku(
                    rs.getString(1), rs.getString(2), rs.getString(3), rs.getInt(4),
                    rs.getObject(5, java.time.LocalDateTime.class))).single();
    }

    @PutMapping("/videos/{id}/progress")
    ResponseEntity<Void> progress(@PathVariable String id, @RequestBody NumberInput input, HttpServletRequest request) {
        var member = write(request, "历史记录", "Lv0");
        int position = position(input.value(), videoDuration(id));
        jdbc.sql("CALL sp_save_video_progress(:uid,:id,:position)").param("uid", member.uid()).param("id", id)
                .param("position", position).update();
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/history")
    List<VideoLink> history(HttpServletRequest request) {
        return jdbc.sql("""
                SELECT v.VideoID,v.VideoTitle,h.LastViewingPosition,v.CoverUrl,u.Name,v.UID,v.VideoDuration,h.LatestBrowseTime
                FROM browsinghistorytable h JOIN videotable v USING(VideoID)
                JOIN usertable u ON u.UID=v.UID
                WHERE h.UID=CAST(:uid AS UNSIGNED) AND v.VideoStatus='published' AND v.VisibleStatus='public'
                ORDER BY h.LatestBrowseTime DESC,v.VideoID DESC LIMIT 100
                """).param("uid", read(request).uid()).query((rs, row) -> {
            java.time.LocalDateTime viewedAt = rs.getObject(8, java.time.LocalDateTime.class);
            return new VideoLink(rs.getString(1), rs.getString(2), rs.getInt(3), rs.getString(4),
                    rs.getString(5), rs.getString(6), rs.getInt(7), viewedAt == null ? null : viewedAt.toString());
        }).list();
    }

    @PostMapping("/search-history")
    ResponseEntity<Void> searchHistory(@RequestBody Text input, HttpServletRequest request) {
        var member = write(request, "视频搜索", "Lv0");
        jdbc.sql("INSERT INTO searchhistorytable (UID,SearchContent) VALUES (:uid,:keyword)")
                .param("uid", member.uid()).param("keyword", content(input.value(), 100)).update();
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/search-history")
    List<String> searchHistory(HttpServletRequest request) {
        return jdbc.sql("""
                SELECT SearchContent FROM searchhistorytable WHERE UID=CAST(:uid AS UNSIGNED)
                GROUP BY SearchContent ORDER BY MAX(SearchTime) DESC, MAX(SearchID) DESC LIMIT 20
                """).param("uid", read(request).uid()).query(String.class).list();
    }

    @GetMapping("/authors/{id}/relations/{list}")
    List<Person> people(@PathVariable String id, @PathVariable String list, HttpServletRequest request) {
        read(request);
        requireTarget(Target.ACCOUNT, id);
        String joins = switch (list) {
            case "followers" -> "u.UID=r.UID WHERE r.TargetUID=CAST(:id AS UNSIGNED)";
            case "following" -> "u.UID=r.TargetUID WHERE r.UID=CAST(:id AS UNSIGNED)";
            default -> throw error(BAD_REQUEST, "无效的关系列表");
        };
        return jdbc.sql("SELECT u.UID,u.Name FROM relationtable r JOIN usertable u ON " + joins
                + " AND r.RelationType=0 AND u.AccountStatus='active' ORDER BY r.CreationTime DESC,u.UID LIMIT 100")
                .param("id", id).query((rs, row) -> new Person(rs.getString(1), rs.getString(2))).list();
    }

    @GetMapping("/favorites")
    List<FavoriteLink> favorites(HttpServletRequest request) {
        return jdbc.sql("""
                SELECT f.FavouritID,f.FavoriteName,v.VideoID,v.VideoTitle,v.CoverUrl,u.Name,v.UID,v.VideoDuration
                FROM favourittable f JOIN collectvideotable c USING(FavouritID)
                JOIN videotable v USING(VideoID) JOIN usertable u ON u.UID=v.UID
                WHERE f.UID=CAST(:uid AS UNSIGNED) AND v.VideoStatus='published' AND v.VisibleStatus='public'
                ORDER BY c.CollectTime DESC,v.VideoID DESC LIMIT 100
                """).param("uid", read(request).uid()).query((rs, row) -> new FavoriteLink(rs.getString(1),
                rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6),
                rs.getString(7), rs.getInt(8))).list();
    }

    @GetMapping("/me/space")
    SpaceSummary spaceSummary(HttpServletRequest request) {
        String uid = read(request).uid();
        SpaceStats stats = jdbc.sql("""
                SELECT COALESCE(SUM(p.PlayCount),0),
                       COALESCE(SUM((SELECT COUNT(*) FROM liketable l
                                    WHERE l.LikeTargetType=0 AND l.LikeTargetID=v.VideoID)),0)
                FROM videotable v LEFT JOIN playcounttable p USING(VideoID)
                WHERE v.UID=CAST(:uid AS UNSIGNED) AND v.VideoStatus='published' AND v.VisibleStatus='public'
                """).param("uid", uid).query((rs, row) -> new SpaceStats(rs.getLong(1), rs.getLong(2))).single();
        List<SpaceFolder> folders = jdbc.sql("""
                SELECT f.FavouritID, f.FavoriteName, COUNT(v.VideoID), MAX(v.VideoID)
                FROM favourittable f LEFT JOIN collectvideotable c USING(FavouritID)
                LEFT JOIN videotable v ON v.VideoID=c.VideoID AND v.VideoStatus='published' AND v.VisibleStatus='public'
                WHERE f.UID=CAST(:uid AS UNSIGNED)
                GROUP BY f.FavouritID, f.FavoriteName
                ORDER BY (f.FavoriteName='默认收藏夹') DESC, f.FavouritID
                """).param("uid", uid).query((rs, row) -> new SpaceFolder(rs.getString(1), rs.getString(2),
                        rs.getLong(3), rs.getString(4))).list();
        return new SpaceSummary(stats, folders);
    }

    @GetMapping("/me/folders/{id}")
    List<VideoLink> spaceFolder(@PathVariable String id, HttpServletRequest request) {
        String uid = read(request).uid();
        requireId(id);
        return jdbc.sql("""
                SELECT v.VideoID, v.VideoTitle, v.CoverUrl, u.Name, v.UID, v.VideoDuration FROM favourittable f
                JOIN collectvideotable c USING(FavouritID)
                JOIN videotable v USING(VideoID) JOIN usertable u ON u.UID=v.UID
                WHERE f.UID=CAST(:uid AS UNSIGNED) AND f.FavouritID=CAST(:id AS UNSIGNED)
                  AND v.VideoStatus='published' AND v.VisibleStatus='public'
                ORDER BY c.CollectTime DESC, v.VideoID DESC LIMIT 100
                """).param("uid", uid).param("id", id)
                .query((rs, row) -> new VideoLink(rs.getString(1), rs.getString(2), 0, rs.getString(3),
                    rs.getString(4), rs.getString(5), rs.getInt(6), null)).list();
    }

    @GetMapping("/reports/{kind}/reasons")
    List<Reason> reportReasons(@PathVariable String kind, HttpServletRequest request) {
        read(request);
        return jdbc.sql("""
                SELECT ReportTypeID,ReportTypeName FROM reporttypetable
                WHERE TargetType=:type AND ReportTypeStatus=1 ORDER BY ReportTypeID
                """).param("type", target(kind).code).query((rs, row) -> new Reason(rs.getString(1), rs.getString(2))).list();
    }

    @PostMapping("/reports/{kind}/{id}")
    @Transactional
    ResponseEntity<Void> report(@PathVariable String kind, @PathVariable String id, @RequestBody Report input,
                                HttpServletRequest request) {
        var member = write(request, "举报", "Lv1");
        var target = target(kind);
        requireTarget(target, id);
        requireId(input.reason());
        String description = input.description() == null || input.description().isBlank() ? "" : content(input.description(), 200);
        // Serialize repeat reports by the same user so retries cannot open duplicates.
        jdbc.sql("SELECT UID FROM usertable WHERE UID=CAST(:uid AS UNSIGNED) FOR UPDATE").param("uid", member.uid()).query(String.class).single();
        if (jdbc.sql("""
                SELECT ReportID FROM reporttable WHERE UID=CAST(:uid AS UNSIGNED) AND TargetID=CAST(:id AS UNSIGNED) AND TargetType=:type LIMIT 1 FOR UPDATE
                """).param("uid", member.uid()).param("id", id).param("type", target.code).query(String.class).optional().isPresent()) {
            throw error(CONFLICT, "你已经举报过该内容");
        }
        int inserted = jdbc.sql("""
                INSERT INTO reporttable (UID,TargetID,TargetType,ReportTypeID,DetailedDescription)
                SELECT :uid,:id,:type,ReportTypeID,:text FROM reporttypetable
                WHERE ReportTypeID=CAST(:reason AS UNSIGNED) AND TargetType=:type AND ReportTypeStatus=1
                """).param("uid", member.uid()).param("id", id).param("type", target.code)
                .param("text", description).param("reason", input.reason()).update();
        if (inserted == 0) throw error(BAD_REQUEST, "请选择有效的举报原因");
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/authors/{id}/messages")
    ResponseEntity<Void> message(@PathVariable String id, @RequestBody Text input, HttpServletRequest request) {
        var member = write(request, "私信", "Lv1");
        requireRecipient(id, member);
        jdbc.sql("INSERT INTO privatemessagetable (SenderUID,ReceiverUID,MessageType,MessageContent) VALUES (:uid,:id,0,:text)")
                .param("uid", member.uid()).param("id", id).param("text", content(input.value(), 1000)).update();
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/videos/{id}/forward")
    Map<String, Long> forward(@PathVariable String id, @RequestBody Text input, HttpServletRequest request) {
        var member = write(request, "转发", "Lv1");
        requireTarget(Target.VIDEO, id);
        requireRecipient(input.value(), member);
        jdbc.sql("CALL sp_forward_video(:uid,:receiver,:id)").param("uid", member.uid())
                .param("receiver", input.value()).param("id", id).update();
        return Map.of("count", catalog.engagement(id).share());
    }

    @GetMapping("/messages")
    List<MessageRow> messages(HttpServletRequest request) {
        return jdbc.sql("""
                SELECT m.SenderUID,u.Name,m.MessageType,m.MessageContent,m.SendTime,v.VideoID
                FROM privatemessagetable m JOIN usertable u ON u.UID=m.SenderUID
                LEFT JOIN LATERAL (
                  SELECT VideoID FROM videotable WHERE VideoContent=m.MessageContent AND VideoStatus='published'
                    AND VisibleStatus='public' ORDER BY VideoID LIMIT 1
                ) v ON m.MessageType=2
                WHERE m.ReceiverUID=CAST(:uid AS UNSIGNED) AND m.ReceiverDel=0 ORDER BY m.SendTime DESC,m.MessageID DESC LIMIT 50
                """).param("uid", read(request).uid()).query((rs, row) -> new MessageRow(rs.getString(1),
                rs.getString(2), rs.getInt(3), rs.getInt(3) == 0 ? rs.getString(4) : null,
                rs.getObject(5, java.time.LocalDateTime.class), rs.getString(6))).list();
    }

    @GetMapping("/notifications")
    List<Notification> notifications(HttpServletRequest request) {
        return jdbc.sql("""
                SELECT NotificationContent,NotificationTime FROM systemnotificationtable
                WHERE ReceiverUID=CAST(:uid AS UNSIGNED) ORDER BY NotificationTime DESC,NotificationID DESC LIMIT 50
                """).param("uid", read(request).uid()).query((rs, row) -> new Notification(rs.getString(1),
                rs.getObject(2, java.time.LocalDateTime.class))).list();
    }

    private void requireRecipient(String id, AuthController.Member member) {
        requireTarget(Target.ACCOUNT, id);
        if (member.uid().equals(id)) throw error(BAD_REQUEST, "请选择其他账号");
        if (exists("""
                SELECT EXISTS(SELECT 1 FROM relationtable WHERE RelationType=1
                  AND ((UID=CAST(:uid AS UNSIGNED) AND TargetUID=CAST(:id AS UNSIGNED)) OR (UID=CAST(:id AS UNSIGNED) AND TargetUID=CAST(:uid AS UNSIGNED))))
                """, id, member.uid())) throw error(CONFLICT, "双方存在黑名单关系，无法发送");
        if (!hasPermission(id, "私信")) throw error(FORBIDDEN, "对方当前等级无法接收私信");
    }

    private boolean hasPermission(String uid, String name) {
        return jdbc.sql("""
                SELECT EXISTS(SELECT 1 FROM usertable u JOIN levelprivilegetable lp USING(LevelID)
                  JOIN privilegetable p USING(PrivilegeID) WHERE u.UID=CAST(:uid AS UNSIGNED) AND p.PrivilegeStatus=1 AND p.PrivilegeName=:name)
                """).param("uid", uid).param("name", name).query(Boolean.class).single();
    }

    private AuthController.Member read(HttpServletRequest request) {
        var member = auth.currentMember(request);
        if (member == null) throw error(UNAUTHORIZED, "请先登录");
        return member;
    }

    private AuthController.Member write(HttpServletRequest request, String permission, String minimum) {
        var member = read(request);
        if (!auth.validCsrf(request)) throw error(FORBIDDEN, "页面会话已失效，请重试");
        if (!hasPermission(member.uid(), permission)) throw error(FORBIDDEN, minimum + " 及以上账号才可使用" + permission + "功能");
        return member;
    }

    private void requireTarget(Target target, String id) {
        requireId(id);
        String publicVideo = "v.VideoStatus='published' AND v.VisibleStatus='public'";
        String query = switch (target) {
            case VIDEO -> "SELECT 1 FROM videotable v WHERE v.VideoID=CAST(:id AS UNSIGNED) AND " + publicVideo;
            case DANMAKU -> """
                    SELECT 1 FROM danmakutable d JOIN videotable v USING(VideoID)
                    WHERE d.DanmakuID=CAST(:id AS UNSIGNED) AND d.DanmakuStatus='active' AND
                    """ + " " + publicVideo;
            case COMMENT -> """
                    SELECT 1 FROM commenttable c JOIN videotable v USING(VideoID)
                    WHERE c.CommentID=CAST(:id AS UNSIGNED) AND c.CommentStatus='active' AND
                    """ + " " + publicVideo;
            case REPLY -> """
                    WITH RECURSIVE chain AS (
                      SELECT ReplyTargetType,ReplyTargetID,1 AS depth FROM replytable WHERE ReplyID=CAST(:id AS UNSIGNED) AND ReplyStatus='active'
                      UNION ALL
                      SELECT r.ReplyTargetType,r.ReplyTargetID,t.depth+1 FROM chain t JOIN replytable r
                      ON t.ReplyTargetType=0 AND t.ReplyTargetID=r.ReplyID WHERE r.ReplyStatus='active' AND t.depth<30
                    )
                    SELECT 1 FROM chain t JOIN commenttable c ON t.ReplyTargetType=1 AND t.ReplyTargetID=c.CommentID
                    JOIN videotable v USING(VideoID) WHERE c.CommentStatus='active' AND
                    """ + " " + publicVideo;
            case ACCOUNT -> "SELECT 1 FROM usertable WHERE UID=CAST(:id AS UNSIGNED) AND AccountStatus='active'";
        };
        if (!jdbc.sql("SELECT EXISTS(" + query + ")").param("id", id).query(Boolean.class).single()) {
            throw error(NOT_FOUND, "操作对象不存在或已不可见");
        }
    }

    private boolean exists(String sql, String id, String uid) {
        return jdbc.sql(sql).param("id", id).param("uid", uid).query(Boolean.class).single();
    }

    private int videoDuration(String id) {
        requireId(id);
        return jdbc.sql("""
                SELECT VideoDuration FROM videotable WHERE VideoID=CAST(:id AS UNSIGNED) AND VideoStatus='published' AND VisibleStatus='public'
                """).param("id", id).query(Integer.class).optional().orElseThrow(() -> error(NOT_FOUND, "视频不可用"));
    }

    private static void requireId(String id) {
        if (!AuthController.validUid(id)) throw error(BAD_REQUEST, "无效的编号");
    }

    private static boolean enabled(Toggle input) {
        if (input.enabled() == null) throw error(BAD_REQUEST, "缺少操作状态");
        return input.enabled();
    }

    private static int position(Integer value, int duration) {
        if (value == null || value < 0 || value > duration) throw error(BAD_REQUEST, "播放位置超出视频范围");
        return value;
    }

    private static String content(String value, int max) {
        if (value == null || value.isBlank()) throw error(BAD_REQUEST, "请输入内容");
        String text = value.strip();
        if (text.codePointCount(0, text.length()) > max) throw error(BAD_REQUEST, "内容最多 " + max + " 个字符");
        return text;
    }

    private static Target target(String name) {
        return switch (name) {
            case "video" -> Target.VIDEO;
            case "danmaku" -> Target.DANMAKU;
            case "comment" -> Target.COMMENT;
            case "reply" -> Target.REPLY;
            case "account" -> Target.ACCOUNT;
            default -> throw error(BAD_REQUEST, "无效的操作对象");
        };
    }

    private static String uid(AuthController.Member member) {
        return member == null ? "0" : member.uid();
    }

    private static ResponseStatusException error(HttpStatus status, String message) {
        return new ResponseStatusException(status, message);
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String, String>> problem(ResponseStatusException error) {
        return ResponseEntity.status(error.getStatusCode()).cacheControl(CacheControl.noStore())
                .body(Map.of("message", error.getReason()));
    }

    private enum Target {
        VIDEO(0), DANMAKU(1), COMMENT(2), REPLY(3), ACCOUNT(5);
        final int code;
        Target(int code) { this.code = code; }
    }

    record Toggle(Boolean enabled) {}
    record Text(String value) {}
    record NumberInput(Integer value) {}
    record TimedText(String value, Integer position) {}
    record Report(String reason, String description) {}
    record Reason(String id, String name) {}
    record ToggleView(boolean enabled, long count) {}
    record VideoState(boolean liked, boolean favorited, boolean subscribed, int position) {}
    record Folder(String id, String name, boolean selected) {}
    record Relation(boolean following, boolean blocked, long followers) {}
    record VideoLink(String id, String title, int position, String cover, String author, String authorId, int duration, String viewedAt) {}
    record FavoriteLink(String folderId, String folder, String id, String title, String cover, String author,
                        String authorId, int duration) {}
    record SpaceStats(long plays, long likes) {}
    record SpaceFolder(String id, String name, long count, String coverVideoId) {}
    record SpaceSummary(SpaceStats stats, List<SpaceFolder> folders) {}
    record Person(String id, String name) {}
    record Notification(String content, java.time.LocalDateTime sentAt) {}
    record MessageRow(String senderId, String sender, int type, String content, java.time.LocalDateTime sentAt, String videoId) {}
}
