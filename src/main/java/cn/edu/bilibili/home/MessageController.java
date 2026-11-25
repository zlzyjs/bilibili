package cn.edu.bilibili.home;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
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
    private final VideoController videos;

    MessageController(MessageStore store, MessageEvents events, AuthController auth, VideoController videos) {
        this.store = store;
        this.events = events;
        this.auth = auth;
        this.videos = videos;
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
        if (image.mime() == null) {
            var source = videos.image(new String(image.bytes(), StandardCharsets.UTF_8), "covers/");
            var type = source.getHeaders().getContentType();
            if (type == null || !Set.of("image/jpeg", "image/png", "image/gif", "image/webp").contains(type.toString())) {
                throw new ResponseStatusException(NOT_FOUND, "图片不可用");
            }
            return ResponseEntity.ok().contentType(type).body(source.getBody());
        }
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(image.mime())).body(image.bytes());
    }

    @GetMapping("/events/{category}")
    List<MessageEvents.Event> events(@PathVariable String category, @RequestParam(defaultValue = "0") int offset,
                                    HttpServletRequest request) {
        checkCategory(category);
        return events.list(user(request, false), category, offset(offset));
    }

    @PutMapping("/events/{category}/state")
    @ResponseStatus(NO_CONTENT)
    void state(@PathVariable String category, @RequestBody EventState input, HttpServletRequest request) {
        String uid = user(request, true);
        checkCategory(category);
        if (input.ids() == null || input.ids().size() > 40 || input.ids().stream().anyMatch(
                id -> id == null || !id.matches("[0-9:]{1,80}"))) {
            throw new ResponseStatusException(BAD_REQUEST, "无效的通知编号");
        }
        if (input.dismissed()) events.dismiss(uid, category, input.ids());
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

    record EventState(List<String> ids, boolean dismissed) {}
}

