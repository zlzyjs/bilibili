package cn.edu.bilibili.home;

import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
class PageController {
    private final Resource index = new ClassPathResource("static/index.html");

    @GetMapping({"/studio", "/studio/{section}"})
    ResponseEntity<Resource> studio() {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .contentType(MediaType.TEXT_HTML).body(new ClassPathResource("static/studio.html"));
    }

    @GetMapping({"/", "/index.html", "/recommend", "/search", "/channel/{id}", "/popular", "/popular/must-watch", "/popular/rank", "/latest",
            "/messages", "/account", "/account/{section}", "/account/{section}/{detail}", "/video/{id}", "/space/{id}", "/me", "/service/{name}", "/collections", "/creators"})
    ResponseEntity<Resource> page() {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .contentType(MediaType.TEXT_HTML)
                .body(index);
    }
}
