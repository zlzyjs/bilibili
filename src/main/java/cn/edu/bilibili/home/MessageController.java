package cn.edu.bilibili.home;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import static org.springframework.http.HttpStatus.*;

@RestController
@RequestMapping("/api/message-center")
class MessageController {
    private static final Set<String> CATEGORIES = Set.of("replies", "mentions", "likes", "system");
    private final MessageStore store;
    private final MessageEvents events;
    private final AuthController auth;

    MessageController(MessageStore store, MessageEvents events, AuthController auth) {
        this.store = store;
        this.events = events;
        this.auth = auth;
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String, String>> rejected(ResponseStatusException failure) {
        return ResponseEntity.status(failure.getStatusCode())
                .body(Map.of("message", failure.getReason() == null ? "操作失败" : failure.getReason()));
    }

    @ModelAttribute
    void privateResponse(HttpServletResponse response) {
        response.setHeader("Cache-Control", "private, no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
    }

    @GetMapping("/threads")
    List<MessageStore.Conversation> conversations(@RequestParam(defaultValue = "0") int offset,
                                                  HttpServletRequest request) {
        return store.conversations(user(request, false), offset(offset));
    }

    @GetMapping("/threads/{peer}")
    MessageStore.ThreadView thread(@PathVariable String peer, @RequestParam(required = false) String before,
                                  HttpServletRequest request) {
        String uid = user(request, false);
        checkId(peer);
        if (uid.equals(peer)) throw new ResponseStatusException(BAD_REQUEST, "请选择其他账号");
        if (before != null) checkId(before);
        return store.thread(uid, peer, before);
    }

    @GetMapping("/images/{id}")
    ResponseEntity<?> image(@PathVariable String id, HttpServletRequest request) {
        checkId(id);
        var image = store.privateImage(user(request, false), id);
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(image.mime())).body(image.bytes());
    }

    @DeleteMapping("/messages/{id}")
    @ResponseStatus(NO_CONTENT)
    void delete(@PathVariable String id, HttpServletRequest request) {
        String uid = user(request, true);
        checkId(id);
        changeMessage(() -> store.deleteForViewer(uid, id));
    }

    @DeleteMapping("/messages/{id}/recall")
    @ResponseStatus(NO_CONTENT)
    void recall(@PathVariable String id, HttpServletRequest request) {
        String uid = user(request, true);
        checkId(id);
        changeMessage(() -> store.recall(uid, id));
    }

    private void changeMessage(Runnable action) {
        try {
            action.run();
        } catch (org.springframework.dao.DataAccessException ex) {
            if (ex.getMostSpecificCause() instanceof java.sql.SQLException error && "45000".equals(error.getSQLState())) {
                throw new ResponseStatusException(CONFLICT, "消息已被举报或超过撤回时限，无法执行此操作");
            }
            throw ex;
        }
    }

    @GetMapping("/events/{category}")
    List<MessageEvents.Event> events(@PathVariable String category, @RequestParam(defaultValue = "0") int offset,
                                    HttpServletRequest request) {
        checkCategory(category);
        return events.list(user(request, false), category, offset(offset));
    }

    private String user(HttpServletRequest request, boolean write) {
        var account = auth.currentMember(request);
        if (account == null) throw new ResponseStatusException(UNAUTHORIZED, "请先登录");
        if (write && !auth.validCsrf(request)) throw new ResponseStatusException(FORBIDDEN, "页面会话已失效，请重试");
        return account.uid();
    }

    private static void checkId(String id) {
        if (!AuthController.validUid(id)) throw new ResponseStatusException(BAD_REQUEST, "无效的编号");
    }

    private static void checkCategory(String category) {
        if (!CATEGORIES.contains(category)) throw new ResponseStatusException(NOT_FOUND, "消息类型不存在");
    }

    private static int offset(int offset) {
        if (offset < 0) throw new ResponseStatusException(BAD_REQUEST, "无效的分页参数");
        return offset;
    }

}

