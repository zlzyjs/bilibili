package cn.edu.bilibili.home;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.sql.SQLException;
import java.sql.Types;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.dao.DataAccessException;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import static org.springframework.http.HttpStatus.*;

@RestController
@RequestMapping("/api/interactions")
class InteractionController {
    private static final int FAVORITE_FOLDER_CAPACITY = 1000;
    private final JdbcClient jdbc;
    private final AuthController auth;
    private final MysqlVideoCatalog catalog;
    private final MessageStore inbox;
    private final OssMedia oss;

    InteractionController(JdbcClient jdbc, AuthController auth, MysqlVideoCatalog catalog, MessageStore inbox,
                          OssMedia oss) {
        this.jdbc = jdbc;
        this.auth = auth;
        this.catalog = catalog;
        this.inbox = inbox;
        this.oss = oss;
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
                       COALESCE((SELECT LastViewingPosition FROM browsinghistorytable WHERE UID=CAST(:uid AS UNSIGNED) AND VideoID=CAST(:id AS UNSIGNED)),0),
                       COALESCE((SELECT SUM(-CoinChange) FROM coinrecordtable
                                 WHERE UID=CAST(:uid AS UNSIGNED) AND VideoID=CAST(:id AS UNSIGNED) AND CoinChange<0),0)
                """).param("uid", uid(member)).param("id", id)
                .query((rs, row) -> new VideoState(rs.getBoolean(1), rs.getBoolean(2), rs.getBoolean(3), rs.getInt(4),
                        rs.getDouble(5))).single();
    }

    @GetMapping("/videos/{id}/folders")
    List<Folder> folders(@PathVariable String id, HttpServletRequest request) {
        requireTarget(Target.VIDEO, id);
        return folders(read(request).uid(), id, null);
    }

    private List<Folder> folders(String uid, String video, String folder) {
        return jdbc.sql("""
                SELECT f.FavouritID, f.FavoriteName, c.VideoID IS NOT NULL, f.VisibleState=0 AS IsPrivate,
                       (SELECT COUNT(*) FROM collectvideotable items WHERE items.FavouritID=f.FavouritID),
                       f.FavoriteName='默认收藏夹'
                FROM favourittable f LEFT JOIN collectvideotable c ON c.FavouritID=f.FavouritID AND c.VideoID=CAST(:id AS UNSIGNED)
                WHERE f.UID=CAST(:uid AS UNSIGNED) AND (:folder IS NULL OR f.FavouritID=CAST(:folder AS UNSIGNED))
                ORDER BY (f.FavoriteName='默认收藏夹') DESC, f.FavouritID
                """).param("id", video).param("uid", uid).param("folder", folder, Types.VARCHAR)
                .query((rs, row) -> new Folder(rs.getString(1), rs.getString(2), rs.getBoolean(3),
                        rs.getBoolean("IsPrivate"), rs.getLong(5), rs.getBoolean(6) ? null : FAVORITE_FOLDER_CAPACITY)).list();
    }

    @PostMapping("/videos/{id}/folders")
    @Transactional(isolation = Isolation.READ_COMMITTED)
    CreatedFolder createFavoriteFolder(@PathVariable String id, @RequestBody FolderName input, HttpServletRequest request) {
        var member = write(request, "收藏", "Lv1");
        requireTarget(Target.VIDEO, id);
        String folder = insertFavoriteFolder(member.uid(), input.name(), true, "");
        setFavorite(id, folder, member.uid(), true);
        Folder created = folders(member.uid(), id, folder).stream().findFirst().orElseThrow();
        return new CreatedFolder(created, favoriteView(id, member.uid()));
    }

    private String insertFavoriteFolder(String uid, String rawName, boolean publiclyVisible, String rawDescription) {
        String name = rawName == null ? "" : rawName.strip();
        if (name.isEmpty()) throw error(BAD_REQUEST, "请填写收藏夹名称");
        if (name.codePointCount(0, name.length()) > 20) throw error(BAD_REQUEST, "收藏夹名称最多可输入20个字");
        if ("默认收藏夹".equals(name)) throw error(BAD_REQUEST, "此名称保留给默认收藏夹");
        String description = rawDescription == null ? "" : rawDescription.strip();
        if (description.codePointCount(0, description.length()) > 200) throw error(BAD_REQUEST, "收藏夹简介最多可输入200个字");
        var keys = new org.springframework.jdbc.support.GeneratedKeyHolder();
        jdbc.sql("""
                INSERT INTO favourittable (UID, FavoriteName, VisibleState, FavoriteDescription)
                VALUES (:uid, :name, :visible, :description)
                """).param("uid", uid).param("name", name).param("visible", publiclyVisible ? 1 : 0)
                .param("description", description).update(keys);
        return keys.getKey().toString();
    }

    @PutMapping("/videos/{id}/folders")
    @Transactional(isolation = Isolation.READ_COMMITTED)
    ToggleView updateFavoriteFolders(@PathVariable String id, @RequestBody FolderChanges input, HttpServletRequest request) {
        var member = write(request, "收藏", "Lv1");
        requireTarget(Target.VIDEO, id);
        if (input.changes() == null || input.changes().stream().anyMatch(change -> change == null || change.enabled() == null)) {
            throw error(BAD_REQUEST, "请选择要更新的收藏夹");
        }
        for (var change : input.changes()) requireId(change.id());
        for (var change : input.changes().stream().sorted(java.util.Comparator.comparing(FolderChange::id)).toList()) {
            setFavorite(id, change.id(), member.uid(), change.enabled());
        }
        return favoriteView(id, member.uid());
    }

    @PutMapping("/videos/{id}/folders/{folder}")
    @Transactional(isolation = Isolation.READ_COMMITTED)
    ToggleView favorite(@PathVariable String id, @PathVariable String folder, @RequestBody Toggle input,
                        HttpServletRequest request) {
        var member = write(request, "收藏", "Lv1");
        requireTarget(Target.VIDEO, id);
        setFavorite(id, folder, member.uid(), enabled(input));
        return favoriteView(id, member.uid());
    }

    private void setFavorite(String id, String folder, String uid, boolean selected) {
        requireId(folder);
        String name = jdbc.sql("""
                SELECT FavoriteName FROM favourittable
                WHERE FavouritID=CAST(:folder AS UNSIGNED) AND UID=CAST(:uid AS UNSIGNED) FOR UPDATE
                """).param("folder", folder).param("uid", uid).query(String.class).optional()
                .orElseThrow(() -> error(NOT_FOUND, "收藏夹不存在"));
        if (selected && !"默认收藏夹".equals(name)) {
            boolean full = jdbc.sql("""
                    SELECT COUNT(*) >= :capacity AND COALESCE(MAX(VideoID=CAST(:id AS UNSIGNED)),0)=0
                    FROM collectvideotable WHERE FavouritID=CAST(:folder AS UNSIGNED)
                    """).param("capacity", FAVORITE_FOLDER_CAPACITY).param("id", id).param("folder", folder)
                    .query(Boolean.class).single();
            if (full) throw error(CONFLICT, "收藏夹已满");
        }
        String sql = selected ? """
                INSERT INTO collectvideotable (VideoID,FavouritID)
                SELECT :id,FavouritID FROM favourittable WHERE FavouritID=CAST(:folder AS UNSIGNED) AND UID=CAST(:uid AS UNSIGNED)
                ON DUPLICATE KEY UPDATE CollectTime=CollectTime
                """ : """
                DELETE c FROM collectvideotable c JOIN favourittable f USING(FavouritID)
                WHERE c.VideoID=CAST(:id AS UNSIGNED) AND f.FavouritID=CAST(:folder AS UNSIGNED) AND f.UID=CAST(:uid AS UNSIGNED)
                """;
        jdbc.sql(sql).param("id", id).param("folder", folder).param("uid", uid).update();
    }

    private ToggleView favoriteView(String id, String uid) {
        boolean selected = jdbc.sql("""
                SELECT EXISTS(SELECT 1 FROM collectvideotable c JOIN favourittable f USING(FavouritID)
                WHERE c.VideoID=CAST(:id AS UNSIGNED) AND f.UID=CAST(:uid AS UNSIGNED))
                """).param("id", id).param("uid", uid).query(Boolean.class).single();
        return new ToggleView(selected, catalog.engagement(id).favorite());
    }

    @PostMapping("/videos/{id}/coins")
    CoinResult coin(@PathVariable String id, @RequestBody NumberInput input, HttpServletRequest request) {
        var member = write(request, "投币", "Lv1");
        requireTarget(Target.VIDEO, id);
        if (input.value() == null || (input.value() != 1 && input.value() != 2)) {
            throw error(BAD_REQUEST, "请选择投 1 枚或 2 枚硬币");
        }
        double coinsGiven;
        try {
            coinsGiven = jdbc.sql("CALL sp_coin_video(:uid,:id,:coins)").param("uid", member.uid())
                    .param("id", id).param("coins", input.value()).query((rs, row) -> rs.getDouble("TotalAfter")).single();
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
        return new CoinResult(catalog.engagement(id).coin(), coinsGiven);
    }

    @PutMapping("/videos/{id}/subscription")
    @Transactional
    ToggleView subscription(@PathVariable String id, @RequestBody Toggle input, HttpServletRequest request) {
        var member = write(request, "订阅", "Lv1");
        requireTarget(Target.VIDEO, id);
        CollectionSubscription collection = jdbc.sql("""
                SELECT c.CompilationID, c.UID, v.UID FROM videotable v JOIN compilationtable c USING(CompilationID)
                WHERE v.VideoID=CAST(:id AS UNSIGNED) FOR SHARE
                """).param("id", id).query((rs, row) -> new CollectionSubscription(rs.getString(1), rs.getString(2), rs.getString(3)))
                .optional().orElseThrow(() -> error(NOT_FOUND, "该视频没有合集"));
        boolean on = enabled(input);
        if (on && (member.uid().equals(collection.owner()) || member.uid().equals(collection.uploader()))) {
            throw error(FORBIDDEN, "不能订阅自己的合集");
        }
        String sql = on ? """
                INSERT INTO subscriptionsummarytable (UID,CollectionID) VALUES (:uid,:id)
                ON DUPLICATE KEY UPDATE SubscribeTime=SubscribeTime
                """ : "DELETE FROM subscriptionsummarytable WHERE UID=CAST(:uid AS UNSIGNED) AND CollectionID=CAST(:id AS UNSIGNED)";
        jdbc.sql(sql).param("uid", member.uid()).param("id", collection.id()).update();
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
        if (block) {
            requireId(id);
            if (!jdbc.sql("SELECT EXISTS(SELECT 1 FROM usertable WHERE UID=CAST(:id AS UNSIGNED))")
                    .param("id", id).query(Boolean.class).single()) throw error(NOT_FOUND, "该账号不存在");
        } else {
            requireTarget(Target.ACCOUNT, id);
        }
        if (member.uid().equals(id)) throw error(BAD_REQUEST, "不能对自己的账号执行此操作");
        inbox.lockParticipants(member.uid(), id);
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

    @GetMapping("/comment-mention-users")
    List<MentionUser> mentionUsers(@RequestParam(defaultValue = "") String q, @RequestParam(defaultValue = "0") int offset,
                                   HttpServletRequest request) {
        String uid = read(request).uid();
        String keyword = q.strip();
        if (keyword.length() > 80 || offset < 0) throw error(BAD_REQUEST, "无效的搜索参数");
        return jdbc.sql("""
                SELECT u.UID,u.Name,(f.TargetUID IS NOT NULL) AS Followed,
                       (SELECT COUNT(*) FROM relationtable r WHERE r.TargetUID=u.UID AND r.RelationType=0) AS Followers
                FROM usertable u LEFT JOIN relationtable f
                  ON f.UID=CAST(:uid AS UNSIGNED) AND f.TargetUID=u.UID AND f.RelationType=0
                WHERE u.AccountStatus='active' AND u.UID<>CAST(:uid AS UNSIGNED)
                  AND ((:q='' AND f.TargetUID IS NOT NULL) OR (:q<>'' AND LOCATE(:q,u.Name)>0))
                ORDER BY Followed DESC, (u.Name=:q) DESC, f.CreationTime DESC, u.UID
                LIMIT 24 OFFSET :offset
                """).param("uid", uid).param("q", keyword).param("offset", offset)
                .query((rs, row) -> new MentionUser(rs.getString(1), rs.getString(2), rs.getBoolean(3), rs.getLong(4))).list();
    }

    @GetMapping("/comment-mention-users/{id}")
    MentionProfile mentionProfile(@PathVariable String id) {
        requireTarget(Target.ACCOUNT, id);
        var author = catalog.findAuthor(id).orElseThrow(() -> error(NOT_FOUND, "该账号不存在"));
        long likes = jdbc.sql("""
                SELECT COUNT(*) FROM liketable l JOIN videotable v ON v.VideoID=l.LikeTargetID
                WHERE l.LikeTargetType=0 AND v.UID=CAST(:id AS UNSIGNED)
                  AND v.VideoStatus='published' AND v.VisibleStatus='public'
                """).param("id", id).query(Long.class).single();
        return new MentionProfile(author, likes);
    }

    @PostMapping("/videos/{id}/comments")
    @Transactional
    ResponseEntity<Void> comment(@PathVariable String id, @RequestBody CommentInput input, HttpServletRequest request) {
        var member = write(request, "评论", "Lv2");
        requireTarget(Target.VIDEO, id);
        createComment(id, member, content(input.value(), 1000), input.tags(), null);
        return ResponseEntity.noContent().build();
    }

    @PostMapping(path = "/videos/{id}/comments/image", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Transactional
    ResponseEntity<Void> commentImage(@PathVariable String id, @RequestParam("image") MultipartFile file,
                                      @RequestParam(defaultValue = "") String value,
                                      @RequestParam(defaultValue = "[]") String tags, HttpServletRequest request) {
        var member = write(request, "评论", "Lv2");
        requireTarget(Target.VIDEO, id);
        List<CommentContent.Tag> selected;
        try {
            selected = CommentContent.decodeTags(tags);
        } catch (com.fasterxml.jackson.core.JsonProcessingException ex) {
            throw error(BAD_REQUEST, "无效的提及对象");
        }
        createComment(id, member, content(value, 1000), selected, inbox.imageUpload(file));
        return ResponseEntity.noContent().build();
    }

    private void createComment(String id, AuthController.Member member, String text, List<CommentContent.Tag> tags,
                               MessageStore.Image image) {
        var selected = validatedCommentTags(text, member.uid(), tags);
        String mentions = commentMentionRecipients(text, member.uid(), selected);
        String path = image == null ? null
                : oss.putImage("media/comment/" + member.uid() + "/", image.mime(), image.bytes());
        jdbc.sql("""
                INSERT INTO commenttable (UID,VideoID,Content,ImageUrl)
                VALUES (:uid,:id,%s,:image)
                """.formatted(CommentContent.ENCODE)).param("uid", member.uid()).param("id", id).param("text", text)
                .param("image", path, Types.VARCHAR).param("mentions", mentions)
                .param("tags", CommentContent.json(selected)).update();
    }

    private String commentMentionRecipients(String text, String author, List<CommentContent.Tag> selected) {
        var plain = new StringBuilder(text);
        for (var tag : selected) {
            plain.replace(tag.start(), tag.end(), " ".repeat(tag.end() - tag.start()));
        }
        var mentions = new java.util.HashSet<>(inbox.mentionedUsers(author, plain.toString()));
        selected.forEach(tag -> mentions.add(tag.uid()));
        return CommentContent.json(mentions);
    }

    private List<CommentContent.Tag> validatedCommentTags(String text, String author, List<CommentContent.Tag> tags) {
        if (tags == null || tags.isEmpty()) return List.of();
        if (tags.size() > text.length() / 2 || tags.stream().anyMatch(java.util.Objects::isNull)) {
            throw error(BAD_REQUEST, "无效的提及对象");
        }
        for (var tag : tags) requireId(tag.uid());
        var users = jdbc.sql("SELECT CAST(UID AS CHAR),Name FROM usertable WHERE AccountStatus='active' AND UID IN (:ids)")
                .param("ids", tags.stream().map(CommentContent.Tag::uid).distinct().toList())
                .query((rs, row) -> Map.entry(rs.getString(1), rs.getString(2))).list();
        var names = new java.util.HashMap<String, String>();
        users.forEach(user -> names.put(user.getKey(), user.getValue()));
        var ordered = tags.stream().sorted(java.util.Comparator.comparingInt(CommentContent.Tag::start)).toList();
        int previousEnd = 0;
        for (var tag : ordered) {
            String name = names.get(tag.uid());
            if (tag.start() < previousEnd || tag.end() <= tag.start() || tag.end() > text.length()
                    || name == null || tag.uid().equals(author)
                    || !text.substring(tag.start(), tag.end()).equals("@" + name)) {
                throw error(BAD_REQUEST, "提及的用户已变更，请重新选择");
            }
            previousEnd = tag.end();
        }
        return ordered;
    }

    @GetMapping("/comments/{id}/image")
    ResponseEntity<byte[]> commentImage(@PathVariable String id) {
        requireTarget(Target.COMMENT, id);
        String path = jdbc.sql("""
                SELECT ImageUrl FROM commenttable
                WHERE CommentID=CAST(:id AS UNSIGNED) AND CommentStatus='active' AND ImageUrl IS NOT NULL
                """).param("id", id).query(String.class)
                .optional().orElseThrow(() -> error(NOT_FOUND, "评论图片不存在"));
        var remote = oss.location(path, "comment/");
        if (remote == null) throw error(NOT_FOUND, "评论图片不存在");
        return ResponseEntity.status(FOUND).location(remote).build();
    }

    @PostMapping("/replies/{kind}/{id}")
    @Transactional
    ResponseEntity<Void> reply(@PathVariable String kind, @PathVariable String id, @RequestBody CommentInput input,
                               HttpServletRequest request) {
        var member = write(request, "回复", "Lv2");
        var target = target(kind);
        if (target != Target.COMMENT && target != Target.REPLY) throw error(BAD_REQUEST, "无效的回复对象");
        requireTarget(target, id);
        String text = content(input.value(), 1000);
        var selected = validatedCommentTags(text, member.uid(), input.tags());
        jdbc.sql("""
                INSERT INTO replytable (UID,ReplyTargetID,ReplyTargetType,Content)
                VALUES (:uid,:id,:type,%s)
                """.formatted(CommentContent.ENCODE))
                .param("uid", member.uid()).param("id", id).param("type", target == Target.COMMENT ? 1 : 0)
                .param("text", text)
                .param("mentions", commentMentionRecipients(text, member.uid(), selected))
                .param("tags", CommentContent.json(selected)).update();
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/{kind:comments|replies}/{id}")
    ResponseEntity<Void> removeCommentOrReply(@PathVariable String kind, @PathVariable String id,
                                               HttpServletRequest request) {
        var member = write(request);
        requireId(id);
        String update = kind.equals("comments") ? """
                UPDATE commenttable SET CommentStatus='removed'
                WHERE CommentID=CAST(:id AS UNSIGNED) AND UID=CAST(:uid AS UNSIGNED) AND CommentStatus='active'
                """ : """
                UPDATE replytable SET ReplyStatus='removed'
                WHERE ReplyID=CAST(:id AS UNSIGNED) AND UID=CAST(:uid AS UNSIGNED) AND ReplyStatus='active'
                """;
        if (jdbc.sql(update).param("id", id).param("uid", member.uid()).update() == 0) {
            throw error(NOT_FOUND, "内容不存在或无权删除");
        }
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/comments/{id}/replies")
    List<MysqlVideoCatalog.ReplyPreview> replies(@PathVariable String id, @RequestParam(defaultValue = "false") boolean recent,
                                                HttpServletRequest request) {
        String viewer = read(request).uid();
        requireTarget(Target.COMMENT, id);
        return catalog.replies(id, 100, viewer, recent);
    }

    @PostMapping("/videos/{id}/danmaku")
    @Transactional
    MysqlVideoCatalog.Danmaku danmaku(@PathVariable String id, @RequestBody TimedText input, HttpServletRequest request) {
        var member = write(request, "弹幕", "Lv2");
        int duration = videoDuration(id);
        int timestamp = position(input.position(), duration);
        String mode = input.mode() == null ? "scroll" : input.mode();
        String size = input.size() == null ? "standard" : input.size();
        String color = input.color() == null ? "#FFFFFF" : input.color();
        if (!Set.of("scroll", "top", "bottom").contains(mode)
                || !Set.of("small", "standard").contains(size) || !color.matches("#[0-9a-fA-F]{6}")) {
            throw error(BAD_REQUEST, "无效的弹幕样式");
        }
        String normalizedColor = color.toUpperCase(Locale.ROOT);
        var keys = new org.springframework.jdbc.support.GeneratedKeyHolder();
        jdbc.sql("""
                INSERT INTO danmakutable (UID,VideoID,Content,VideoTimestamp,DisplayMode,FontSize,Color)
                VALUES (:uid,:id,:text,:position,:mode,:size,:color)
                """).param("uid", member.uid()).param("id", id).param("text", content(input.value(), 100))
                .param("position", timestamp).param("mode", mode).param("size", size).param("color", normalizedColor)
                .update(keys);
        String danmakuId = keys.getKey().toString();
        return jdbc.sql("""
                SELECT DanmakuID,UID,Content,VideoTimestamp,SendTime FROM danmakutable WHERE DanmakuID=CAST(:id AS UNSIGNED)
                """).param("id", danmakuId).query((rs, row) -> new MysqlVideoCatalog.Danmaku(
                    rs.getString(1), rs.getString(2), rs.getString(3), rs.getInt(4),
                    rs.getObject(5, java.time.LocalDateTime.class), mode, size, normalizedColor)).single();
    }

    @DeleteMapping("/danmaku/{id}")
    @Transactional
    ResponseEntity<Void> withdrawDanmaku(@PathVariable String id, HttpServletRequest request) {
        var member = write(request, "弹幕", "Lv2");
        requireId(id);
        int updated = jdbc.sql("""
                UPDATE danmakutable SET DanmakuStatus='removed'
                WHERE DanmakuID=CAST(:id AS UNSIGNED) AND UID=CAST(:uid AS UNSIGNED) AND DanmakuStatus='active'
                """).param("id", id).param("uid", member.uid()).update();
        if (updated == 0 && !exists("""
                SELECT EXISTS(SELECT 1 FROM danmakutable
                WHERE DanmakuID=CAST(:id AS UNSIGNED) AND UID=CAST(:uid AS UNSIGNED))
                """, id, member.uid())) throw error(NOT_FOUND, "弹幕不存在或不可撤回");
        return ResponseEntity.noContent().build();
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
                SELECT SearchContent FROM (
                    SELECT SearchContent,SearchTime,SearchID,
                           ROW_NUMBER() OVER(PARTITION BY SearchContent ORDER BY SearchTime DESC,SearchID DESC) AS entry_rank
                    FROM searchhistorytable WHERE UID=CAST(:uid AS UNSIGNED)
                ) recent WHERE entry_rank=1 ORDER BY SearchTime DESC,SearchID DESC LIMIT 20
                """).param("uid", read(request).uid()).query(String.class).list();
    }

    @DeleteMapping("/search-history")
    ResponseEntity<Void> removeSearchHistory(@RequestBody Text input, HttpServletRequest request) {
        var member = write(request, "视频搜索", "Lv0");
        jdbc.sql("DELETE FROM searchhistorytable WHERE UID=CAST(:uid AS UNSIGNED) AND SearchContent=:keyword")
                .param("uid", member.uid()).param("keyword", content(input.value(), 100)).update();
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/search-history/all")
    ResponseEntity<Void> clearSearchHistory(HttpServletRequest request) {
        var member = write(request, "视频搜索", "Lv0");
        jdbc.sql("DELETE FROM searchhistorytable WHERE UID=CAST(:uid AS UNSIGNED)")
                .param("uid", member.uid()).update();
        return ResponseEntity.noContent().build();
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

    @GetMapping("/me/relations/{list}")
    @Transactional(readOnly = true)
    SpacePeople spacePeople(@PathVariable String list, @RequestParam(defaultValue = "") String q,
                            @RequestParam(defaultValue = "0") int page, HttpServletRequest request) {
        String uid = read(request).uid();
        boolean following = switch (list) {
            case "following" -> true;
            case "followers" -> false;
            default -> throw error(BAD_REQUEST, "无效的关系列表");
        };
        String keyword = q.strip();
        if (keyword.length() > 80 || page < 0) throw error(BAD_REQUEST, "无效的搜索参数");
        String source = """
                FROM relationtable r JOIN usertable u ON u.UID=%s
                LEFT JOIN relationtable reciprocal ON reciprocal.UID=r.TargetUID
                    AND reciprocal.TargetUID=r.UID AND reciprocal.RelationType=0
                WHERE %s=CAST(:uid AS UNSIGNED) AND r.RelationType=0
                    AND u.AccountStatus='active' AND (:q='' OR LOCATE(:q,u.Name)>0)
                """.formatted(following ? "r.TargetUID" : "r.UID", following ? "r.UID" : "r.TargetUID");
        long total = jdbc.sql("SELECT COUNT(*) " + source).param("uid", uid).param("q", keyword)
                .query(Long.class).single();
        int size = 24;
        int safePage = (int) Math.min(page, Math.max(0, (total - 1) / size));
        List<SpacePerson> items = jdbc.sql("""
                SELECT u.UID,u.Name,u.Signature,(reciprocal.UID IS NOT NULL) AS Mutual
                """ + source + " ORDER BY r.CreationTime DESC,u.UID LIMIT :size OFFSET :offset")
                .param("uid", uid).param("q", keyword).param("size", size).param("offset", (long) safePage * size)
                .query((rs, row) -> {
                    boolean mutual = rs.getBoolean("Mutual");
                    return new SpacePerson(rs.getString("UID"), rs.getString("Name"), rs.getString("Signature"),
                            following || mutual, !following || mutual);
                }).list();
        return new SpacePeople(items, safePage, size, total);
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
                SELECT f.FavouritID, f.FavoriteName, COUNT(v.VideoID), f.VisibleState=0 AS IsPrivate, f.FavoriteDescription,
                       (SELECT saved.VideoID FROM collectvideotable saved JOIN videotable cover USING(VideoID)
                        WHERE saved.FavouritID=f.FavouritID AND cover.VideoStatus='published' AND cover.VisibleStatus='public'
                        ORDER BY saved.CollectTime DESC, saved.VideoID DESC LIMIT 1) AS CoverVideo
                FROM favourittable f LEFT JOIN collectvideotable c USING(FavouritID)
                LEFT JOIN videotable v ON v.VideoID=c.VideoID AND v.VideoStatus='published' AND v.VisibleStatus='public'
                WHERE f.UID=CAST(:uid AS UNSIGNED)
                GROUP BY f.FavouritID, f.FavoriteName, f.VisibleState, f.FavoriteDescription
                ORDER BY (f.FavoriteName='默认收藏夹') DESC, f.FavouritID
                """).param("uid", uid).query((rs, row) -> new SpaceFolder(rs.getString(1), rs.getString(2),
                        rs.getLong(3), rs.getString("CoverVideo"), rs.getBoolean("IsPrivate"),
                        rs.getString("FavoriteDescription"))).list();
        return new SpaceSummary(stats, folders);
    }

    @GetMapping("/me/recent-videos")
    SpaceRecentVideos spaceRecentVideos(HttpServletRequest request) {
        String uid = read(request).uid();
        return new SpaceRecentVideos(
                catalog.recentlyCoinedVideos(uid).stream().map(VideoController::card).toList(),
                catalog.recentlyLikedVideos(uid).stream().map(VideoController::card).toList());
    }

    @PostMapping("/me/folders")
    Map<String, String> createSpaceFolder(@RequestBody FolderDraft input, HttpServletRequest request) {
        var member = write(request, "收藏", "Lv1");
        return Map.of("id", insertFavoriteFolder(member.uid(), input.name(),
                !Boolean.FALSE.equals(input.publiclyVisible()), input.description()));
    }

    @GetMapping("/me/folders/{id}/videos")
    List<SpaceSavedVideo> spaceFolderVideos(@PathVariable String id, HttpServletRequest request) {
        String uid = read(request).uid();
        requireId(id);
        return jdbc.sql("""
                SELECT v.VideoID, v.VideoTitle, u.Name, v.UID, v.VideoDuration, v.UploadTime, c.CollectTime,
                       COALESCE(p.PlayCount,0) AS Plays,
                       (SELECT COUNT(*) FROM danmakutable d
                        WHERE d.VideoID=v.VideoID AND d.DanmakuStatus='active') AS Danmaku
                FROM favourittable f JOIN collectvideotable c USING(FavouritID)
                JOIN videotable v USING(VideoID) JOIN usertable u ON u.UID=v.UID
                LEFT JOIN playcounttable p ON p.VideoID=v.VideoID
                WHERE f.UID=CAST(:uid AS UNSIGNED) AND f.FavouritID=CAST(:id AS UNSIGNED)
                  AND v.VideoStatus='published' AND v.VisibleStatus='public'
                ORDER BY c.CollectTime DESC, v.VideoID DESC
                """).param("uid", uid).param("id", id)
                .query((rs, row) -> new SpaceSavedVideo(rs.getString("VideoID"), rs.getString("VideoTitle"),
                        rs.getString("Name"), rs.getString("UID"), rs.getInt("VideoDuration"), rs.getLong("Plays"),
                        rs.getLong("Danmaku"), rs.getObject("UploadTime", LocalDateTime.class),
                        rs.getObject("CollectTime", LocalDateTime.class))).list();
    }

    @GetMapping("/me/subscriptions")
    List<SpaceSubscription> spaceSubscriptions(HttpServletRequest request) {
        String uid = read(request).uid();
        return jdbc.sql("""
                SELECT c.CompilationID, c.CompilationTitle, u.UID, u.Name,
                       COUNT(v.VideoID) AS Videos, COALESCE(SUM(p.PlayCount),0) AS Plays,
                       (SELECT cover.VideoID FROM videotable cover
                        WHERE cover.CompilationID=c.CompilationID AND cover.UID=c.UID
                          AND cover.VideoStatus='published' AND cover.VisibleStatus='public'
                        ORDER BY cover.UploadTime, cover.VideoID LIMIT 1) AS CoverVideo
                FROM subscriptionsummarytable s JOIN compilationtable c ON c.CompilationID=s.CollectionID
                JOIN usertable u ON u.UID=c.UID
                LEFT JOIN videotable v ON v.CompilationID=c.CompilationID AND v.UID=c.UID
                    AND v.VideoStatus='published' AND v.VisibleStatus='public'
                LEFT JOIN playcounttable p ON p.VideoID=v.VideoID
                WHERE s.UID=CAST(:uid AS UNSIGNED)
                GROUP BY c.CompilationID, c.CompilationTitle, c.UID, u.UID, u.Name, s.SubscribeTime
                ORDER BY s.SubscribeTime DESC, c.CompilationID DESC
                """).param("uid", uid).query((rs, row) -> new SpaceSubscription(rs.getString("CompilationID"),
                        rs.getString("CompilationTitle"), rs.getString("UID"), rs.getString("Name"),
                        rs.getLong("Videos"), rs.getString("CoverVideo"), rs.getLong("Plays"))).list();
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

    @GetMapping("/videos/{id}/danmaku/reports")
    List<String> reportedDanmaku(@PathVariable String id, HttpServletRequest request) {
        var member = read(request);
        requireTarget(Target.VIDEO, id);
        return jdbc.sql("""
                SELECT DISTINCT r.TargetID FROM reporttable r JOIN danmakutable d ON d.DanmakuID=r.TargetID
                WHERE r.UID=CAST(:uid AS UNSIGNED) AND r.TargetType=:type AND d.VideoID=CAST(:id AS UNSIGNED)
                """).param("uid", member.uid()).param("type", Target.DANMAKU.code).param("id", id).query(String.class).list();
    }

    @GetMapping("/reports/{kind}/reasons")
    List<Reason> reportReasons(@PathVariable String kind, HttpServletRequest request) {
        read(request);
        return jdbc.sql("""
                SELECT ReportTypeID,ReportTypeName,ReportTypeDescription FROM reporttypetable
                WHERE TargetType=:type AND ReportTypeStatus=1 ORDER BY ReportTypeID
                """).param("type", target(kind).code).query((rs, row) -> new Reason(rs.getString(1), rs.getString(2), rs.getString(3))).list();
    }

    @PostMapping("/reports/{kind}/{id}")
    @Transactional
    ResponseEntity<Void> report(@PathVariable String kind, @PathVariable String id, @RequestBody Report input,
                                HttpServletRequest request) {
        var member = write(request, "举报", "Lv1");
        var target = target(kind);
        requireTarget(target, id, member.uid());
        requireId(input.reason());
        String description = target != Target.VIDEO && (input.description() == null || input.description().isBlank())
                ? "" : content(input.description(), 200);
        if (Boolean.TRUE.equals(input.blockAuthor())) {
            String query = switch (target) {
                case VIDEO -> "SELECT UID FROM videotable WHERE VideoID=CAST(:id AS UNSIGNED)";
                case DANMAKU -> "SELECT UID FROM danmakutable WHERE DanmakuID=CAST(:id AS UNSIGNED)";
                case COMMENT -> "SELECT UID FROM commenttable WHERE CommentID=CAST(:id AS UNSIGNED)";
                case REPLY -> "SELECT UID FROM replytable WHERE ReplyID=CAST(:id AS UNSIGNED)";
                default -> throw error(BAD_REQUEST, "该举报类型不支持同时拉黑");
            };
            String author = jdbc.sql(query).param("id", id).query(String.class).single();
            relation(author, "block", new Toggle(true), request);
        }
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
    @Transactional(isolation = Isolation.READ_COMMITTED)
    ResponseEntity<Void> message(@PathVariable String id, @RequestBody Text input, HttpServletRequest request) {
        var member = write(request, "私信", "Lv1");
        sendPrivate(id, member, 0, content(input.value(), 500), null);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/authors/{id}/messages/image")
    @Transactional(isolation = Isolation.READ_COMMITTED)
    ResponseEntity<Void> image(@PathVariable String id,
                               @RequestParam("image") org.springframework.web.multipart.MultipartFile file,
                               HttpServletRequest request) {
        var member = write(request, "私信", "Lv1");
        sendPrivate(id, member, 1, "[图片]", inbox.imageUpload(file));
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/videos/{id}/forward")
    @Transactional(isolation = Isolation.READ_COMMITTED)
    Map<String, Long> forward(@PathVariable String id, @RequestBody Text input, HttpServletRequest request) {
        var member = write(request, "转发", "Lv1");
        requireTarget(Target.VIDEO, id);
        sendPrivate(input.value(), member, 2, id, null);
        return Map.of("count", catalog.engagement(id).share());
    }

    private void sendPrivate(String id, AuthController.Member member, int type, String value, MessageStore.Image image) {
        requireId(id);
        if (member.uid().equals(id)) throw error(BAD_REQUEST, "请选择其他账号");
        inbox.lockParticipants(member.uid(), id);
        requireRecipient(id, member);
        inbox.send(member.uid(), id, type, value, image);
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

    private AuthController.Member write(HttpServletRequest request) {
        var member = read(request);
        if (!auth.validCsrf(request)) throw error(FORBIDDEN, "页面会话已失效，请重试");
        return member;
    }

    private AuthController.Member write(HttpServletRequest request, String permission, String minimum) {
        var member = write(request);
        if (!hasPermission(member.uid(), permission)) throw error(FORBIDDEN, minimum + " 及以上账号才可使用" + permission + "功能");
        return member;
    }

    private void requireTarget(Target target, String id) {
        requireTarget(target, id, "0");
    }

    private void requireTarget(Target target, String id, String uid) {
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
            case MESSAGE -> """
                    SELECT 1 FROM privatemessagetable m
                    WHERE m.MessageID=CAST(:id AS UNSIGNED) AND m.ReceiverUID=CAST(:uid AS UNSIGNED) AND m.ReceiverDel=0
                    """;
            case ACCOUNT -> "SELECT 1 FROM usertable WHERE UID=CAST(:id AS UNSIGNED) AND AccountStatus='active'";
        };
        if (!jdbc.sql("SELECT EXISTS(" + query + ")").param("id", id).param("uid", uid).query(Boolean.class).single()) {
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
            case "message" -> Target.MESSAGE;
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
                .body(Map.of("message", error.getReason() == null ? "操作失败" : error.getReason()));
    }

    private enum Target {
        VIDEO(0), DANMAKU(1), COMMENT(2), REPLY(3), MESSAGE(4), ACCOUNT(5);
        final int code;
        Target(int code) { this.code = code; }
    }

    record Toggle(Boolean enabled) {}
    record Text(String value) {}
    record CommentInput(String value, List<CommentContent.Tag> tags) {}
    record MentionUser(String uid, String name, boolean followed, long followers) {}
    record MentionProfile(MysqlVideoCatalog.Author author, long likes) {}
    record NumberInput(Integer value) {}
    record TimedText(String value, Integer position, String mode, String size, String color) {}
    record Report(String reason, String description, Boolean blockAuthor) {}
    record Reason(String id, String name, String description) {}
    record ToggleView(boolean enabled, long count) {}
    private record CollectionSubscription(String id, String owner, String uploader) {}
    record VideoState(boolean liked, boolean favorited, boolean subscribed, int position, double coinsGiven) {}
    record CoinResult(long count, double coinsGiven) {}
    record Folder(String id, String name, boolean selected, boolean privateFolder, long count, Integer capacity) {}
    record FolderName(String name) {}
    record FolderDraft(String name, Boolean publiclyVisible, String description) {}
    record FolderChange(String id, Boolean enabled) {}
    record FolderChanges(List<FolderChange> changes) {}
    record CreatedFolder(Folder folder, ToggleView state) {}
    record Relation(boolean following, boolean blocked, long followers) {}
    record VideoLink(String id, String title, int position, String cover, String author, String authorId, int duration, String viewedAt) {}
    record FavoriteLink(String folderId, String folder, String id, String title, String cover, String author,
                        String authorId, int duration) {}
    record SpaceStats(long plays, long likes) {}
    record SpaceFolder(String id, String name, long count, String coverVideoId, boolean privateFolder, String description) {}
    record SpaceSavedVideo(String id, String title, String author, String authorId, int duration, long plays,
                           long danmaku, LocalDateTime publishedAt, LocalDateTime collectedAt) {}
    record SpaceSubscription(String id, String name, String authorId, String author, long count,
                             String coverVideoId, long plays) {}
    record SpaceSummary(SpaceStats stats, List<SpaceFolder> folders) {}
    record SpaceRecentVideos(List<VideoController.VideoCard> coined, List<VideoController.VideoCard> liked) {}
    record Person(String id, String name) {}
    record SpacePerson(String id, String name, String signature, boolean following, boolean followsYou) {}
    record SpacePeople(List<SpacePerson> items, int page, int size, long total) {}
}
