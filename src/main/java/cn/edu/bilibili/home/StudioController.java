package cn.edu.bilibili.home;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import org.springframework.core.io.Resource;
import org.springframework.dao.DataAccessException;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import static org.springframework.http.HttpStatus.*;

@RestController
@RequestMapping("/api/studio")
class StudioController {
    private static final String VIDEOS = """
        WITH own AS (
          SELECT v.*,
            CASE WHEN v.VideoStatus='draft' THEN COALESCE(pending.VideoTitle,v.VideoTitle) ELSE v.VideoTitle END AS display_title,
            CASE WHEN v.VideoStatus='draft' THEN COALESCE(pending.VideoDescription,v.VideoDescription) ELSE v.VideoDescription END AS display_description,
            COALESCE(v.UploadTime,pending.SubmitTime) AS display_time,
            CASE (SELECT a.AuditStatus FROM videopendingaudittable p JOIN audittable a
                  ON a.TargetType=1 AND a.TargetID=p.PendingAuditID
                  WHERE p.VideoID=v.VideoID ORDER BY a.AuditID DESC LIMIT 1)
              WHEN 0 THEN 'pending' WHEN 2 THEN 'rejected'
              ELSE CASE WHEN v.VideoStatus='published' THEN 'published' ELSE 'draft' END END AS state
          FROM videotable v LEFT JOIN videopendingaudittable pending
            ON pending.PendingAuditID=(SELECT MAX(p.PendingAuditID) FROM videopendingaudittable p WHERE p.VideoID=v.VideoID)
          WHERE v.UID=CAST(:uid AS UNSIGNED)
        )
        """;
    private static final String METRICS = """
        COALESCE(p.PlayCount,0) AS plays,
        (SELECT COUNT(*) FROM liketable l WHERE l.LikeTargetType=0 AND l.LikeTargetID=v.VideoID) AS likes,
        (SELECT COUNT(*) FROM commenttable c WHERE c.CommentStatus='active' AND c.VideoID=v.VideoID) AS comments,
        (SELECT COUNT(*) FROM danmakutable d WHERE d.DanmakuStatus='active' AND d.VideoID=v.VideoID) AS danmaku,
        (SELECT COUNT(*) FROM collectvideotable c WHERE c.VideoID=v.VideoID) AS favorites,
        (SELECT COUNT(*) FROM forwardtable f WHERE f.VideoID=v.VideoID) AS shares,
        (SELECT COALESCE(-SUM(c.CoinChange),0) FROM coinrecordtable c WHERE c.VideoID=v.VideoID AND c.CoinChange<0) AS coins
        """;
    private static final String ACTIVITY = """
        WITH own AS (
          SELECT VideoID FROM videotable WHERE UID=CAST(:uid AS UNSIGNED) AND VideoStatus='published'
            AND (:video='' OR VideoID=CAST(NULLIF(:video,'') AS UNSIGNED))
        ), events AS (
          SELECT 'plays' AS metric, s.CountTime AS happened, 1 AS amount FROM videoplaysessiontable s JOIN own USING(VideoID)
          UNION ALL SELECT 'fanPlays', s.CountTime, 1 FROM videoplaysessiontable s JOIN own USING(VideoID)
                    JOIN relationtable r ON r.UID=s.UID AND r.TargetUID=CAST(:uid AS UNSIGNED)
                        AND r.RelationType=0 AND r.CreationTime<=s.CountTime
          UNION ALL SELECT 'likes', l.LikeTime, 1 FROM liketable l JOIN own ON l.LikeTargetID=own.VideoID WHERE l.LikeTargetType=0
          UNION ALL SELECT 'comments', c.CommentTime, 1 FROM commenttable c JOIN own USING(VideoID) WHERE c.CommentStatus='active'
          UNION ALL SELECT 'danmaku', d.SendTime, 1 FROM danmakutable d JOIN own USING(VideoID) WHERE d.DanmakuStatus='active'
          UNION ALL SELECT 'favorites', c.CollectTime, 1 FROM collectvideotable c JOIN own USING(VideoID)
          UNION ALL SELECT 'shares', f.ForwardTime, 1 FROM forwardtable f JOIN own USING(VideoID)
          UNION ALL SELECT 'coins', c.ChangeTime, -c.CoinChange FROM coinrecordtable c JOIN own USING(VideoID) WHERE c.CoinChange<0
          UNION ALL SELECT 'followers', r.CreationTime, 1 FROM relationtable r JOIN usertable u ON u.UID=r.UID
                    WHERE r.TargetUID=CAST(:uid AS UNSIGNED) AND r.RelationType=0 AND u.AccountStatus='active' AND :video=''
        )
        SELECT metric, DATE(happened), SUM(amount) FROM events WHERE happened>=:start AND happened<:end
        GROUP BY metric, DATE(happened) ORDER BY DATE(happened)
        """;
    private static final String FANS = """
        FROM relationtable r JOIN usertable u ON u.UID=r.UID
        WHERE r.TargetUID=CAST(:uid AS UNSIGNED) AND r.RelationType=0 AND u.AccountStatus='active'
        """;
    private final JdbcClient jdbc;
    private final AuthController auth;
    private final VideoController videoController;
    private final InteractionController interactions;
    private final OssMedia oss;

    StudioController(JdbcClient jdbc, AuthController auth, VideoController videoController,
                     InteractionController interactions, OssMedia oss) {
        this.jdbc = jdbc;
        this.auth = auth;
        this.videoController = videoController;
        this.interactions = interactions;
        this.oss = oss;
    }

    @ModelAttribute
    void privateResponse(HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
    }

    @GetMapping("/overview")
    Overview overview(HttpServletRequest request) {
        String uid = member(request).uid();
        LocalDateTime now = LocalDateTime.now(ZoneId.of("Asia/Shanghai"));
        LocalDate statisticsDate = statisticsDate(now);
        Metrics metrics = jdbc.sql("SELECT COALESCE(SUM(plays),0), COALESCE(SUM(likes),0), COALESCE(SUM(comments),0), "
                + "COALESCE(SUM(danmaku),0), COALESCE(SUM(favorites),0), COALESCE(SUM(shares),0), COALESCE(SUM(coins),0) "
                + "FROM (SELECT " + METRICS + """
                FROM videotable v LEFT JOIN playcounttable p USING(VideoID)
                WHERE v.UID=CAST(:uid AS UNSIGNED) AND v.VideoStatus='published') AS totals
                """).param("uid", uid).query((rs, row) -> new Metrics(rs.getLong(1), rs.getLong(2), rs.getLong(3),
                        rs.getLong(4), rs.getLong(5), rs.getLong(6), rs.getLong(7))).single();
        LocalDate fanStart = now.toLocalDate().minusDays(now.getHour() < 12 ? 1 : 0);
        long newFans = jdbc.sql("SELECT COUNT(*) " + FANS + " AND r.CreationTime>=:start AND r.CreationTime<:end")
                .param("uid", uid).param("start", fanStart.atStartOfDay()).param("end", now)
                .query(Long.class).single();
        BigDecimal received = jdbc.sql("SELECT COALESCE(SUM(ChargeAmount),0) FROM chargetable WHERE UPUID=CAST(:uid AS UNSIGNED)")
                .param("uid", uid).query(BigDecimal.class).single();
        return new Overview(metrics, fanCount(uid), newFans, received, statisticsDate);
    }

    static LocalDate statisticsDate(LocalDateTime now) {
        return now.toLocalDate().minusDays(now.getHour() < 12 ? 2 : 1);
    }

    @GetMapping("/analytics")
    Trend analytics(@RequestParam(defaultValue="7") int days, @RequestParam(defaultValue="") String video,
                    HttpServletRequest request) {
        String uid = member(request).uid();
        if (days != 7 && days != 30 && days != 90) throw new ResponseStatusException(BAD_REQUEST);
        if (!video.isEmpty()) ownVideo(uid, video);
        LocalDate end = MysqlVideoCatalog.today();
        LocalDate start = end.minusDays(days - 1L);
        List<Point> points = jdbc.sql(ACTIVITY).param("uid", uid).param("video", video)
                .param("start", start.minusDays(days).atStartOfDay()).param("end", end.plusDays(1).atStartOfDay())
                .query((rs, row) -> new Point(rs.getString(1), rs.getObject(2, LocalDate.class), rs.getBigDecimal(3))).list();
        return new Trend(start, end, points);
    }

    @GetMapping("/videos")
    VideoPage videos(@RequestParam(defaultValue="all") String state, @RequestParam(defaultValue="") String q,
                     @RequestParam(defaultValue="latest") String sort, @RequestParam(defaultValue="0") int page,
                     HttpServletRequest request) {
        String uid = member(request).uid();
        int offset = offset(page);
        String term = q.strip();
        if (term.length() > 80 || !List.of("all", "draft", "pending", "published", "rejected").contains(state)) {
            throw new ResponseStatusException(BAD_REQUEST);
        }
        String order = switch (sort) {
            case "latest" -> "v.display_time DESC, v.VideoID DESC";
            case "oldest" -> "v.display_time IS NULL, v.display_time ASC, v.VideoID ASC";
            case "plays" -> "plays DESC, v.VideoID DESC";
            default -> throw new ResponseStatusException(BAD_REQUEST);
        };
        Map<String, Long> counts = jdbc.sql(VIDEOS + "SELECT state, COUNT(*) FROM own WHERE LOCATE(:q,display_title)>0 OR :q='' GROUP BY state")
                .param("uid", uid).param("q", term).query((rs, row) -> Map.entry(rs.getString(1),rs.getLong(2)))
                .list().stream().collect(java.util.stream.Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
        var items = jdbc.sql(VIDEOS + """
                SELECT v.VideoID,v.display_title,v.display_description,v.VideoDuration,v.VideoStatus,v.VisibleStatus,v.display_time,v.state,
                """ + METRICS + """
                FROM own v LEFT JOIN playcounttable p USING(VideoID)
                WHERE (LOCATE(:q,v.display_title)>0 OR :q='') AND ((:state='all' AND v.state<>'draft') OR v.state=:state)
                ORDER BY
                """ + " " + order + " LIMIT 12 OFFSET :offset").param("uid", uid).param("q", term)
                .param("state", state).param("offset", offset).query((rs, row) -> new Draft(
                        rs.getString("VideoID"), rs.getString("display_title"), rs.getString("display_description"),
                        rs.getInt("VideoDuration"), rs.getString("state"), rs.getString("VisibleStatus"),
                        rs.getObject("display_time", LocalDateTime.class),
                        "published".equals(rs.getString("VideoStatus")) && "public".equals(rs.getString("VisibleStatus")),
                        new Metrics(rs.getLong("plays"),rs.getLong("likes"),rs.getLong("comments"),rs.getLong("danmaku"),
                                rs.getLong("favorites"),rs.getLong("shares"),rs.getLong("coins")))).list();
        return new VideoPage(items, counts, "all".equals(state) ? counts.entrySet().stream().filter(entry -> !entry.getKey().equals("draft")).mapToLong(Map.Entry::getValue).sum()
                                                               : counts.getOrDefault(state, 0L));
    }

    @GetMapping("/videos/{id}/cover")
    ResponseEntity<Resource> cover(@PathVariable String id, HttpServletRequest request) {
        String path = ownVideo(member(request).uid(), id).cover();
        if (path == null || path.isBlank()) throw new ResponseStatusException(NOT_FOUND);
        var response = videoController.image(path, "covers/");
        var headers = new org.springframework.http.HttpHeaders();
        headers.putAll(response.getHeaders());
        headers.setCacheControl("no-store");
        return new ResponseEntity<>(response.getBody(), headers, response.getStatusCode());
    }

    @GetMapping("/videos/{id}/stream")
    ResponseEntity<Resource> stream(@PathVariable String id, HttpServletRequest request,
                                    HttpServletResponse response) throws java.io.IOException {
        String path = ownVideo(member(request).uid(), id).content();
        if (path == null || path.isBlank()) throw new ResponseStatusException(NOT_FOUND);
        if (path.startsWith("oss://")) {
            oss.streamVideo(path, request, response);
            return null;
        }
        return videoController.videoFile(path);
    }

    @GetMapping("/videos/{id}/edit")
    Map<String, Object> editDetails(@PathVariable String id, HttpServletRequest request) {
        String uid = member(request).uid();
        var original = ownVideo(uid, id);
        var result = new java.util.HashMap<String, Object>(jdbc.sql(VIDEOS +
                "SELECT display_title AS title,display_description AS description,VisibleStatus AS visibility,state FROM own WHERE VideoID=CAST(:id AS UNSIGNED)")
                .param("uid", uid).param("id", id).query((rs, row) -> {
                    var data = new java.util.HashMap<String, Object>();
                    data.put("title", rs.getString("title"));
                    data.put("description", rs.getString("description"));
                    data.put("visibility", rs.getString("visibility"));
                    data.put("state", rs.getString("state"));
                    return data;
                }).single());
        result.put("id", id);
        result.put("statement", original.statement());
        result.put("category", original.category());
        result.put("duration", original.duration());
        result.put("tags", jdbc.sql("SELECT t.TagName FROM videotagtable vt JOIN tagtable t ON t.TagID=vt.TagID WHERE vt.VideoID=CAST(:id AS UNSIGNED) ORDER BY t.TagID")
                .param("id", id).query(String.class).list());
        return result;
    }

    @PostMapping("/videos/{id}")
    Map<String, String> edit(@PathVariable String id, @RequestBody Edit input, HttpServletRequest request) {
        var member = member(request);
        if (!auth.validCsrf(request) || !"Lv2".equals(member.level())) throw new ResponseStatusException(FORBIDDEN);
        String title = input.title() == null ? "" : input.title().strip();
        String description = input.description() == null ? "" : input.description().strip();
        if (title.isEmpty() || title.codePointCount(0,title.length()) > 80 || description.length() > 5000) {
            throw new ResponseStatusException(BAD_REQUEST, "标题须为 1–80 字，简介最多 5000 字");
        }
        var video = ownVideo(member.uid(), id);
        if (video.cover() == null || video.content() == null) {
            throw new ResponseStatusException(CONFLICT, "该稿件缺少视频或封面，暂时无法提交审核");
        }
        try {
            return jdbc.sql("""
                CALL sp_submit_video_audit_with_tags(:uid,:id,:title,:description,:cover,:content,
                    :statement,:category,:collection,:duration,NULL,NULL)
                """).param("uid", member.uid()).param("id", id).param("title", title).param("description", description)
                .param("cover", video.cover()).param("content", video.content()).param("statement", video.statement())
                .param("category", video.category()).param("collection", video.collection(), java.sql.Types.VARCHAR)
                .param("duration", video.duration()).query((rs, row) -> Map.of("state","pending")).single();
        } catch (DataAccessException error) {
            if (error.getMostSpecificCause() instanceof java.sql.SQLException sql && "45000".equals(sql.getSQLState())) {
                throw new ResponseStatusException(CONFLICT, "当前稿件无法提交，请检查是否已有审核申请");
            }
            throw error;
        }
    }

    @GetMapping("/fans")
    FanPage fans(@RequestParam(defaultValue="0") int page,
                 @RequestParam(defaultValue="all") String filter, HttpServletRequest request) {
        String uid = member(request).uid();
        if (!List.of("all", "mutual").contains(filter)) throw new ResponseStatusException(BAD_REQUEST);
        String following = "EXISTS(SELECT 1 FROM relationtable back WHERE back.UID=CAST(:uid AS UNSIGNED) AND back.TargetUID=r.UID AND back.RelationType=0)";
        String condition = FANS + (filter.equals("mutual") ? " AND " + following : "");
        long total = jdbc.sql("SELECT COUNT(*) " + condition).param("uid", uid).query(Long.class).single();
        var items = jdbc.sql("SELECT u.UID,u.Name,r.CreationTime," + following + " " + condition + " ORDER BY r.CreationTime DESC,u.UID LIMIT 12 OFFSET :offset")
                .param("uid", uid).param("offset", offset(page)).query((rs, row) -> new Fan(rs.getString(1),
                        rs.getString(2), rs.getObject(3, LocalDateTime.class), rs.getBoolean(4))).list();
        return new FanPage(items, total, fanCount(uid));
    }

    @DeleteMapping("/fans/{id}")
    @Transactional
    ResponseEntity<Void> removeFan(@PathVariable String id,
                                   @RequestParam(defaultValue="false") boolean block,
                                   HttpServletRequest request) {
        String uid = member(request).uid();
        if (!auth.validCsrf(request)) throw new ResponseStatusException(FORBIDDEN);
        if (!AuthController.validUid(id) || uid.equals(id)) throw new ResponseStatusException(BAD_REQUEST);
        if (block) interactions.relation(id, "block", new InteractionController.Toggle(true), request);
        jdbc.sql("DELETE FROM relationtable WHERE UID=CAST(:id AS UNSIGNED) AND TargetUID=CAST(:uid AS UNSIGNED) AND RelationType=0")
                .param("id", id).param("uid", uid).update();
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/income")
    Trend income(@RequestParam(defaultValue="30") int days, HttpServletRequest request) {
        String uid = member(request).uid();
        if (days != 30 && days != 365) throw new ResponseStatusException(BAD_REQUEST);
        LocalDate end = MysqlVideoCatalog.today();
        LocalDate start = end.minusDays(days-1L);
        var points = jdbc.sql("""
            SELECT CASE ChargeType WHEN 1 THEN 'custom' ELSE 'monthly' END, DATE(ChargeTime), SUM(ChargeAmount)
            FROM chargetable WHERE UPUID=CAST(:uid AS UNSIGNED) AND ChargeTime>=:start AND ChargeTime<:end
            GROUP BY ChargeType, DATE(ChargeTime) ORDER BY DATE(ChargeTime)
            """).param("uid", uid).param("start", start.minusDays(days).atStartOfDay()).param("end", end.plusDays(1).atStartOfDay())
            .query((rs, row) -> new Point(rs.getString(1), rs.getObject(2, LocalDate.class), rs.getBigDecimal(3))).list();
        return new Trend(start, end, points);
    }

    @GetMapping("/charges")
    ChargePage charges(@RequestParam(defaultValue="0") int page, HttpServletRequest request) {
        String uid = member(request).uid();
        String source = " FROM chargetable c JOIN usertable u ON u.UID=c.UID WHERE c.UPUID=CAST(:uid AS UNSIGNED)";
        var items = jdbc.sql("""
                SELECT c.ChargeTime,u.Name,c.ChargeAmount,c.ChargeType,c.ChargeMessage
                """ + source + " ORDER BY c.ChargeTime DESC,c.ChargeID DESC LIMIT 12 OFFSET :offset")
                .param("uid", uid).param("offset", offset(page)).query((rs, row) -> new Charge(
                        rs.getObject(1, LocalDateTime.class), rs.getString(2), rs.getBigDecimal(3),
                        rs.getInt(4), rs.getString(5))).list();
        return new ChargePage(items, jdbc.sql("SELECT COUNT(*)" + source).param("uid", uid).query(Long.class).single());
    }

    private AuthController.Member member(HttpServletRequest request) {
        var member = auth.currentMember(request);
        if (member == null) throw new ResponseStatusException(UNAUTHORIZED);
        return member;
    }

    private long fanCount(String uid) {
        return jdbc.sql("SELECT COUNT(*) " + FANS).param("uid", uid).query(Long.class).single();
    }

    OwnedVideo ownVideo(String uid, String id) {
        if (!AuthController.validUid(id)) throw new ResponseStatusException(NOT_FOUND);
        return jdbc.sql("""
            SELECT CASE WHEN v.VideoStatus='draft' THEN COALESCE(p.CoverUrl,v.CoverUrl) ELSE v.CoverUrl END,
                   CASE WHEN v.VideoStatus='draft' THEN COALESCE(p.VideoContent,v.VideoContent) ELSE v.VideoContent END,
                   CASE WHEN v.VideoStatus='draft' THEN COALESCE(p.Statement,v.Statement) ELSE v.Statement END,
                   CASE WHEN v.VideoStatus='draft' THEN COALESCE(p.CategoryID,v.CategoryID) ELSE v.CategoryID END,
                   CASE WHEN v.VideoStatus='draft' AND p.PendingAuditID IS NOT NULL THEN p.CompilationID ELSE v.CompilationID END,
                   CASE WHEN v.VideoStatus='draft' THEN COALESCE(p.VideoDuration,v.VideoDuration) ELSE v.VideoDuration END
            FROM videotable v LEFT JOIN videopendingaudittable p
                ON p.PendingAuditID=(SELECT MAX(h.PendingAuditID) FROM videopendingaudittable h WHERE h.VideoID=v.VideoID)
            WHERE v.UID=CAST(:uid AS UNSIGNED) AND v.VideoID=CAST(:id AS UNSIGNED)
            """).param("uid", uid).param("id", id).query((rs, row) -> new OwnedVideo(rs.getString(1),
                rs.getString(2),rs.getInt(3),rs.getString(4),rs.getString(5),rs.getInt(6)))
            .optional().orElseThrow(() -> new ResponseStatusException(NOT_FOUND));
    }

    private static int offset(int page) {
        if (page < 0 || page > 10000) throw new ResponseStatusException(BAD_REQUEST);
        return page * 12;
    }

    record Metrics(long plays,long likes,long comments,long danmaku,long favorites,long shares,long coins) {}
    record Overview(Metrics metrics,long followers,long newFans,BigDecimal received,LocalDate statisticsDate) {}
    record Point(String metric,LocalDate date,BigDecimal value) {}
    record Trend(LocalDate start,LocalDate end,List<Point> points) {}
    record Draft(String id,String title,String description,int duration,String state,String visibility,
                 LocalDateTime uploadTime,boolean playable,Metrics metrics) {}
    record VideoPage(List<Draft> items,Map<String,Long> counts,long total) {}
    record Fan(String id,String name,LocalDateTime since,boolean following) {}
    record FanPage(List<Fan> items,long total,long followers) {}
    record Charge(LocalDateTime date,String name,BigDecimal amount,int type,String message) {}
    record ChargePage(List<Charge> items,long total) {}
    record Edit(String title,String description) {}
    record OwnedVideo(String cover,String content,int statement,String category,String collection,int duration) {}
}

