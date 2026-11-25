package cn.edu.bilibili.home;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import org.springframework.dao.DuplicateKeyException;
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
@RequestMapping("/api/account-center")
class AccountCenterController {
    private static final ZoneId SHANGHAI = ZoneId.of("Asia/Shanghai");
    private static final BigDecimal RENAME_COST = BigDecimal.valueOf(6);
    private final AuthController auth;
    private final JdbcClient jdbc;
    private final OssMedia oss;

    AccountCenterController(AuthController auth, JdbcClient jdbc, OssMedia oss) {
        this.auth = auth;
        this.jdbc = jdbc;
        this.oss = oss;
    }

    @ModelAttribute
    void noCache(HttpServletResponse response) {
        response.setHeader("Cache-Control", "private, no-store");
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String, String>> error(ResponseStatusException ex) {
        return ResponseEntity.status(ex.getStatusCode()).body(Map.of("message", ex.getReason()));
    }

    @GetMapping("/overview")
    Overview overview(HttpServletRequest request) {
        String uid = member(request, false).uid();
        var identity = jdbc.sql("""
                SELECT u.Name, u.Experience, l.LevelName, l.RequiredExperience,
                       (SELECT MIN(n.RequiredExperience) FROM userleveltable n
                        WHERE n.RequiredExperience > l.RequiredExperience)
                FROM usertable u JOIN userleveltable l USING(LevelID)
                WHERE u.UID=CAST(:uid AS UNSIGNED) AND u.AccountStatus='active'
                """).param("uid", uid).query((rs, row) -> new Identity(rs.getString(1), rs.getBigDecimal(2),
                        rs.getString(3), rs.getBigDecimal(4), rs.getBigDecimal(5))).single();
        int[] earned = new int[3];
        jdbc.sql("""
                SELECT RewardType,SUM(ExperienceChange) AS gained
                FROM experiencerecordtable WHERE UID=CAST(:uid AS UNSIGNED) AND RewardDate=:today
                GROUP BY RewardType
                """).param("uid", uid).param("today", LocalDate.now(SHANGHAI)).query((rs, row) -> {
            int type = rs.getInt(1);
            if (type >= 0 && type < earned.length) earned[type] = rs.getInt(2);
            return type;
        }).list();
        return new Overview(identity, balance(uid), List.of(
                new Reward("每日登录", earned[0], 2),
                new Reward("观看视频", earned[1], 10),
                new Reward("发布视频", earned[2], 5)));
    }

    @GetMapping("/profile")
    Profile profile(HttpServletRequest request) {
        return readProfile(member(request, false).uid(), false);
    }

    @PutMapping("/profile")
    @Transactional(isolation = Isolation.READ_COMMITTED)
    Profile update(@RequestBody ProfileInput input, HttpServletRequest request) {
        String uid = member(request, true).uid();
        String name = text(input.name(), 16, false, "昵称");
        String signature = text(input.signature(), 60, true, "个性签名");
        if (input.gender() == null || input.gender() < 0 || input.gender() > 2) throw invalid("请选择性别");
        if (input.birthday() != null && input.birthday().isAfter(LocalDate.now(SHANGHAI))) {
            throw invalid("出生日期不能晚于今天");
        }
        Profile prior = readProfile(uid, true);
        boolean renamed = !name.equals(prior.name());
        String oldSignature = prior.signature() == null ? "" : prior.signature();
        if (renamed || !oldSignature.equals(signature)) checkPendingAudit(uid);
        if (renamed && balance(uid).compareTo(RENAME_COST) < 0) {
            throw new ResponseStatusException(CONFLICT, "修改昵称需要 6 个硬币，当前余额不足");
        }
        try {
            jdbc.sql("""
                    UPDATE usertable SET Name=:name,Signature=:signature,Gender=:gender,Birthday=:birthday,UpdateTime=NOW()
                    WHERE UID=CAST(:uid AS UNSIGNED)
                    """).param("name", name).param("signature", signature).param("gender", input.gender())
                    .param("birthday", input.birthday(), java.sql.Types.DATE).param("uid", uid).update();
        } catch (DuplicateKeyException ex) {
            throw new ResponseStatusException(CONFLICT, "这个昵称已被使用");
        }
        if (renamed) {
            jdbc.sql("""
                    INSERT INTO coinrecordtable(UID,CoinChange,ChangeReason)
                    VALUES (CAST(:uid AS UNSIGNED),:cost,'修改昵称')
                    """).param("uid", uid).param("cost", RENAME_COST.negate()).update();
        }
        return readProfile(uid, false);
    }

    @PostMapping(value = "/avatar", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Transactional(isolation = Isolation.READ_COMMITTED)
    Map<String, String> avatar(HttpServletRequest request) {
        String uid = member(request, true).uid();
        if (!(request instanceof org.springframework.web.multipart.MultipartHttpServletRequest multipart)) {
            throw invalid("请选择本地图片");
        }
        MultipartFile file = multipart.getFile("image");
        byte[] bytes = AvatarImage.prepare(file);
        var current = readProfile(uid, true);
        checkPendingAudit(uid);
        String location = oss.putAvatar(uid, bytes);
        if (!location.equals(current.headUrl())) {
            jdbc.sql("""
                    UPDATE usertable SET HeadUrl=:head,UpdateTime=NOW() WHERE UID=CAST(:uid AS UNSIGNED)
                    """).param("head", location).param("uid", uid).update();
        }
        return Map.of("avatar", "/api/authors/" + uid + "/avatar?v=" + location.substring(location.lastIndexOf('/') + 1));
    }

    @GetMapping("/blocked")
    Ledger<Blocked> blocked(@RequestParam(defaultValue = "0") int offset, HttpServletRequest request) {
        String uid = member(request, false).uid();
        var rows = jdbc.sql("""
                SELECT CAST(r.TargetUID AS CHAR),u.Name,u.AccountStatus,r.CreationTime
                FROM relationtable r LEFT JOIN usertable u ON u.UID=r.TargetUID
                WHERE r.UID=CAST(:uid AS UNSIGNED) AND r.RelationType=1
                ORDER BY r.CreationTime DESC,r.TargetUID DESC LIMIT 31 OFFSET :offset
                """).param("uid", uid).param("offset", offset(offset))
                .query((rs, row) -> new Blocked(rs.getString(1), rs.getString(2),
                        "active".equals(rs.getString(3)), dateTime(rs))).list();
        return new Ledger<>(rows.stream().limit(30).toList(), rows.size() > 30);
    }

    @DeleteMapping("/blocked/{peer}")
    @ResponseStatus(NO_CONTENT)
    @Transactional(isolation = Isolation.READ_COMMITTED)
    void unblock(@PathVariable String peer, HttpServletRequest request) {
        String uid = member(request, true).uid();
        if (!AuthController.validUid(peer)) throw invalid("无效的账号编号");
        jdbc.sql("SELECT UID FROM usertable WHERE UID=CAST(:uid AS UNSIGNED) FOR UPDATE")
                .param("uid", uid).query(String.class).single();
        jdbc.sql("""
                DELETE FROM relationtable WHERE UID=CAST(:uid AS UNSIGNED)
                  AND TargetUID=CAST(:peer AS UNSIGNED) AND RelationType=1
                """).param("uid", uid).param("peer", peer).update();
    }

    @GetMapping("/coins")
    Coins coins(@RequestParam(defaultValue = "0") int offset, @RequestParam(defaultValue = "false") boolean recent,
                HttpServletRequest request) {
        String uid = member(request, false).uid();
        int limit = recent ? 7 : 30;
        String window = recent ? "AND ChangeTime>=:since " : "";
        var query = jdbc.sql("""
                SELECT CoinChange,ChangeReason,VideoID,ChangeTime FROM coinrecordtable
                WHERE UID=CAST(:uid AS UNSIGNED) %s
                ORDER BY ChangeTime DESC,CoinRecordID DESC LIMIT :size OFFSET :offset
                """.formatted(window)).param("uid", uid).param("size", limit + 1).param("offset", offset(offset));
        if (recent) query.param("since", LocalDate.now(SHANGHAI).minusDays(6).atStartOfDay());
        var rows = query.query((rs, row) -> new Entry(rs.getBigDecimal(1), rs.getString(2), rs.getString(3), dateTime(rs))).list();
        return new Coins(balance(uid), new Ledger<>(rows.stream().limit(limit).toList(), rows.size() > limit));
    }

    @GetMapping("/experience")
    Ledger<Entry> experience(@RequestParam(defaultValue = "0") int offset, HttpServletRequest request) {
        String uid = member(request, false).uid();
        var rows = jdbc.sql("""
                SELECT ExperienceChange,RewardType,VideoID,CreatedAt
                FROM experiencerecordtable WHERE UID=CAST(:uid AS UNSIGNED) AND ExperienceChange>0
                ORDER BY CreatedAt DESC,ExperienceRecordID DESC LIMIT 31 OFFSET :offset
                """).param("uid", uid).param("offset", offset(offset)).query((rs, row) -> {
            String reason = switch (rs.getInt(2)) {
                case 0 -> "登录奖励";
                case 1 -> "观看视频奖励";
                case 2 -> "发布视频奖励";
                default -> "经验奖励";
            };
            return new Entry(rs.getBigDecimal(1), reason, rs.getString(3), dateTime(rs));
        }).list();
        return new Ledger<>(rows.stream().limit(30).toList(), rows.size() > 30);
    }

    private Profile readProfile(String uid, boolean lock) {
        return jdbc.sql("""
                SELECT Name,Signature,Gender,Birthday,HeadUrl FROM usertable
                WHERE UID=CAST(:uid AS UNSIGNED) AND AccountStatus='active'
                """ + (lock ? " FOR UPDATE" : "")).param("uid", uid)
                .query((rs, row) -> new Profile(rs.getString(1), rs.getString(2), rs.getInt(3),
                        rs.getObject(4, LocalDate.class), rs.getString(5)))
                .optional().orElseThrow(() -> new ResponseStatusException(UNAUTHORIZED, "请先登录"));
    }

    private void checkPendingAudit(String uid) {
        if (jdbc.sql("""
                SELECT EXISTS(SELECT 1 FROM userprofileaudittable p JOIN audittable a
                  ON a.TargetType=0 AND a.TargetID=p.UserProfileAuditID
                  WHERE p.UID=CAST(:uid AS UNSIGNED) AND a.AuditStatus=0)
                """).param("uid", uid).query(Boolean.class).single()) {
            throw new ResponseStatusException(CONFLICT, "有一条资料审核尚未完成，请在审核结束后再修改");
        }
    }

    private BigDecimal balance(String uid) {
        return jdbc.sql("SELECT COALESCE(SUM(CoinChange),0) FROM coinrecordtable WHERE UID=CAST(:uid AS UNSIGNED)")
                .param("uid", uid).query(BigDecimal.class).single();
    }

    private AuthController.Member member(HttpServletRequest request, boolean write) {
        var member = auth.currentMember(request);
        if (member == null) throw new ResponseStatusException(UNAUTHORIZED, "请先登录");
        if (write && !auth.validCsrf(request)) throw new ResponseStatusException(FORBIDDEN, "页面会话已失效，请重试");
        return member;
    }

    private static String text(String value, int size, boolean optional, String label) {
        String clean = value == null ? "" : value.strip();
        if ((!optional && clean.isEmpty()) || clean.codePointCount(0, clean.length()) > size
                || clean.codePoints().anyMatch(Character::isISOControl)) {
            throw invalid(label + "须为单行文字，最多 " + size + " 个字");
        }
        return clean;
    }

    private static int offset(int offset) {
        if (offset < 0) throw invalid("无效的分页参数");
        return offset;
    }

    private static LocalDateTime dateTime(ResultSet rs) throws SQLException {
        return rs.getObject(4, LocalDateTime.class);
    }

    private static ResponseStatusException invalid(String message) {
        return new ResponseStatusException(BAD_REQUEST, message);
    }

    record ProfileInput(String name, String signature, Integer gender, LocalDate birthday) {}
    record Profile(String name, String signature, int gender, LocalDate birthday,
                   @com.fasterxml.jackson.annotation.JsonIgnore String headUrl) {}
    record Identity(String name, BigDecimal experience, String level, BigDecimal threshold, BigDecimal nextThreshold) {}
    record Overview(Identity identity, BigDecimal coins, List<Reward> rewards) {}
    record Reward(String title, int earned, int maximum) {}
    record Blocked(String uid, String name, boolean active, LocalDateTime time) {}
    record Entry(BigDecimal change, String reason, String video, LocalDateTime time) {}
    record Ledger<T>(List<T> items, boolean hasMore) {}
    record Coins(BigDecimal balance, Ledger<Entry> ledger) {}
}

