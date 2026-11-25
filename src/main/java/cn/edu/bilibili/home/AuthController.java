package cn.edu.bilibili.home;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/auth")
class AuthController {
    private static final String USER_ID = "auth.uid";
    private static final String CSRF = "auth.csrf";
    private static final BigInteger MAX_UID = BigInteger.ONE.shiftLeft(64).subtract(BigInteger.ONE);
    private final JdbcClient jdbc;
    private final BCryptPasswordEncoder passwords = new BCryptPasswordEncoder();
    private final String dummyHash = passwords.encode(UUID.randomUUID().toString());

    AuthController(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping("/csrf")
    ResponseEntity<Map<String, String>> csrf(HttpSession session) {
        String token;
        synchronized (session) {
            token = (String) session.getAttribute(CSRF);
            if (token == null) {
                token = UUID.randomUUID().toString();
                session.setAttribute(CSRF, token);
            }
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("token", token));
    }

    @GetMapping("/me")
    ResponseEntity<?> me(HttpServletRequest request) {
        Member member = currentMember(request);
        return member == null ? error(HttpStatus.UNAUTHORIZED, "请先登录")
                : ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(member);
    }

    @PostMapping("/register")
    ResponseEntity<?> register(@RequestBody Registration input, HttpServletRequest request) {
        if (!validCsrf(request)) return csrfError();
        if (currentMember(request) != null) return error(HttpStatus.CONFLICT, "请先退出当前账号");
        String name = input.name() == null ? "" : input.name().strip();
        if (name.isEmpty() || name.codePointCount(0, name.length()) > 16
                || name.codePoints().anyMatch(Character::isISOControl)) {
            return error(HttpStatus.BAD_REQUEST, "请输入 1 至 16 个字符的昵称");
        }
        if (!validPassword(input.password()) || input.password().codePointCount(0, input.password().length()) < 8) {
            return error(HttpStatus.BAD_REQUEST, "密码至少 8 个字符，最多 72 个 UTF-8 字节");
        }
        var keys = new GeneratedKeyHolder();
        int inserted;
        try {
            inserted = jdbc.sql("""
                    INSERT INTO usertable (Name, Password, LevelID)
                    SELECT :name, :hash, LevelID FROM userleveltable WHERE LevelName = 'Lv0'
                    """).param("name", name).param("hash", passwords.encode(input.password())).update(keys);
        } catch (DuplicateKeyException ex) {
            return error(HttpStatus.CONFLICT, "这个昵称已被使用");
        }
        if (inserted != 1) return error(HttpStatus.SERVICE_UNAVAILABLE, "注册暂不可用，缺少初始用户等级");
        String uid = keys.getKey().toString();
        startSession(request, uid);
        return ResponseEntity.status(HttpStatus.CREATED).body(new Member(uid, name, "Lv0"));
    }

    @PostMapping("/signature")
    ResponseEntity<?> signature(@RequestBody Signature input, HttpServletRequest request) {
        if (!validCsrf(request)) return csrfError();
        Member member = currentMember(request);
        if (member == null) return error(HttpStatus.UNAUTHORIZED, "请先登录");
        String value = input.value() == null ? "" : input.value().strip();
        if (value.codePointCount(0, value.length()) > 60 || value.codePoints().anyMatch(Character::isISOControl)) {
            return error(HttpStatus.BAD_REQUEST, "个性签名最多 60 个字，且须为单行文字");
        }
        jdbc.sql("UPDATE usertable SET Signature=:signature WHERE UID=CAST(:uid AS UNSIGNED) AND AccountStatus='active'")
                .param("signature", value).param("uid", member.uid()).update();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new Signature(value));
    }

    @PostMapping("/login")
    ResponseEntity<?> login(@RequestBody Credentials input, HttpServletRequest request) {
        if (!validCsrf(request)) return csrfError();
        if (!validUid(input.uid()) || !validPassword(input.password())) {
            return error(HttpStatus.BAD_REQUEST, "请输入有效的 UID 和密码");
        }
        Account account = jdbc.sql("""
                SELECT CAST(u.UID AS CHAR) AS UID, u.Name, u.Password, u.AccountStatus, l.LevelName
                FROM usertable u JOIN userleveltable l ON l.LevelID = u.LevelID
                WHERE u.UID = CAST(:uid AS UNSIGNED)
                """).param("uid", input.uid()).query((rs, row) -> new Account(
                new Member(rs.getString("UID"), rs.getString("Name"), rs.getString("LevelName")),
                rs.getString("Password"), rs.getString("AccountStatus"))).optional().orElse(null);
        boolean matched = passwords.matches(input.password(), account == null ? dummyHash : account.hash());
        if (!matched || account == null) return error(HttpStatus.UNAUTHORIZED, "UID 或密码错误");
        if (!"active".equals(account.status())) return error(HttpStatus.FORBIDDEN, "该账号已被停用");

        jdbc.sql("CALL sp_record_login_exp(CAST(:uid AS UNSIGNED))").param("uid", input.uid())
                .query(Integer.class).single();
        startSession(request, account.member().uid());
        return ResponseEntity.ok(currentMember(request));
    }

    @PostMapping("/logout")
    ResponseEntity<?> logout(HttpServletRequest request) {
        if (!validCsrf(request)) return csrfError();
        request.getSession(false).invalidate();
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/me/summary")
    ResponseEntity<?> mySummary(HttpServletRequest request) {
        Member member = currentMember(request);
        if (member == null) return error(HttpStatus.UNAUTHORIZED, "请先登录");
        MemberSummary summary = jdbc.sql("""
                SELECT u.Experience,
                  (SELECT COUNT(*) FROM relationtable r WHERE r.UID = u.UID AND r.RelationType = 0) AS following,
                  (SELECT COUNT(*) FROM relationtable r WHERE r.TargetUID = u.UID AND r.RelationType = 0) AS followers,
                  (SELECT COUNT(*) FROM videotable v WHERE v.UID = u.UID AND v.VideoStatus = 'published' AND v.VisibleStatus = 'public') AS videos,
                  (SELECT COALESCE(SUM(c.CoinChange), 0) FROM coinrecordtable c WHERE c.UID = u.UID) AS coins,
                  (SELECT COALESCE(SUM(p.BCoinAmount), 0) FROM bcoinpurchasetable p WHERE p.UID = u.UID AND p.OrderStatus = 1)
                    - (SELECT COALESCE(SUM(cc.BCoinAmount), 0) FROM bcoinconsumptiontable cc WHERE cc.UID = u.UID AND cc.OrderStatus = 1) AS bcoins,
                  (SELECT MIN(l.RequiredExperience) FROM userleveltable l WHERE l.LevelID > u.LevelID) AS nextExp
                FROM usertable u
                WHERE u.UID = CAST(:uid AS UNSIGNED) AND u.AccountStatus = 'active'
                """).param("uid", member.uid()).query((rs, row) -> new MemberSummary(
                member.uid(), member.name(), member.level(),
                rs.getLong("Experience"),
                rs.getObject("nextExp") == null ? null : rs.getLong("nextExp"),
                rs.getLong("following"), rs.getLong("followers"), rs.getLong("videos"),
                rs.getDouble("coins"), rs.getDouble("bcoins"))).optional().orElse(null);
        if (summary == null) return error(HttpStatus.UNAUTHORIZED, "请先登录");
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(summary);
    }

    Member currentMember(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session == null || !(session.getAttribute(USER_ID) instanceof String uid)) return null;
        return jdbc.sql("""
                SELECT CAST(u.UID AS CHAR) AS UID, u.Name, l.LevelName
                FROM usertable u JOIN userleveltable l ON l.LevelID = u.LevelID
                WHERE u.UID = CAST(:uid AS UNSIGNED) AND u.AccountStatus = 'active'
                """).param("uid", uid).query((rs, row) -> new Member(
                rs.getString("UID"), rs.getString("Name"), rs.getString("LevelName"))).optional().orElse(null);
    }

    private void startSession(HttpServletRequest request, String uid) {
        HttpSession session = request.getSession();
        request.changeSessionId();
        session.setAttribute(USER_ID, uid);
        session.removeAttribute(CSRF);
    }

    boolean validCsrf(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        String supplied = request.getHeader("X-CSRF-Token");
        return session != null && session.getAttribute(CSRF) instanceof String token
                && supplied != null && MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8),
                supplied.getBytes(StandardCharsets.UTF_8));
    }

    static boolean validUid(String uid) {
        return uid != null && uid.matches("[1-9][0-9]{0,19}") && new BigInteger(uid).compareTo(MAX_UID) <= 0;
    }

    private static boolean validPassword(String password) {
        return password != null && !password.isEmpty() && password.length() <= 72
                && password.getBytes(StandardCharsets.UTF_8).length <= 72;
    }

    private static ResponseEntity<?> csrfError() {
        return error(HttpStatus.FORBIDDEN, "页面会话已失效，请重试");
    }

    private static ResponseEntity<?> error(HttpStatus status, String message) {
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(Map.of("message", message));
    }

    record Registration(String name, String password) {}
    record Credentials(String uid, String password) {}
    record Signature(String value) {}
    record Member(String uid, String name, String level) {}
    record MemberSummary(String uid, String name, String level, long experience, Long nextExp,
                         long following, long followers, long videos, double coins, double bcoins) {}
    private record Account(Member member, String hash, String status) {}
}
