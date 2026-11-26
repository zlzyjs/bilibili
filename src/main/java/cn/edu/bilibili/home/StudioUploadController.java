package cn.edu.bilibili.home;

import jakarta.servlet.http.HttpServletRequest;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import javax.imageio.ImageIO;
import org.springframework.dao.DataAccessException;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.multipart.MultipartHttpServletRequest;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.util.WebUtils;

import static org.springframework.http.HttpStatus.*;

@RestController
@RequestMapping("/api/studio")
class StudioUploadController {
    private static final long VIDEO_LIMIT = 256L * 1024 * 1024;
    private static final long COVER_LIMIT = 5L * 1024 * 1024;
    private static final int MAX_DURATION = 36000;
    private final AuthController auth;
    private final JdbcTemplate jdbc;
    private final OssMedia oss;

    StudioUploadController(AuthController auth, JdbcTemplate jdbc, OssMedia oss) {
        this.auth = auth;
        this.jdbc = jdbc;
        this.oss = oss;
    }

    @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    Map<String, String> upload(HttpServletRequest request) {
        var account = auth.currentMember(request);
        if (account == null) throw new ResponseStatusException(UNAUTHORIZED);
        if (!auth.validCsrf(request) || !"Lv2".equals(account.level())) {
            throw new ResponseStatusException(FORBIDDEN, "视频投稿需要 Lv2 账号和有效登录会话");
        }
        var body = WebUtils.getNativeRequest(request, MultipartHttpServletRequest.class);
        if (body == null) throw invalid("请选择视频和封面");
        String title = field(body, "title");
        String description = field(body, "description");
        String category = field(body, "category");
        String visibility = field(body, "visibility");
        String statement = field(body, "statement");
        String token = field(body, "submission");
        if (title.isEmpty() || title.codePointCount(0, title.length()) > 80 || description.length() > 5000
                || !AuthController.validUid(category) || !statement.matches("[12]")
                || !("public".equals(visibility) || "private".equals(visibility)) || !token.matches("[a-f0-9]{32}")) {
            throw invalid("请检查标题、分区、投稿类型和可见范围");
        }
        var video = body.getFile("video");
        var cover = body.getFile("cover");
        if (video == null || video.isEmpty() || cover == null || cover.isEmpty()) throw invalid("请提供视频和封面");
        if (video.getSize() > VIDEO_LIMIT || cover.getSize() > COVER_LIMIT) {
            throw new ResponseStatusException(PAYLOAD_TOO_LARGE, "视频或封面超过大小限制");
        }
        String name = account.uid() + "-" + token;
        String videoKey = "media/videos/studio/" + name + "/video.mp4";
        String coverKey = "media/covers/studio/" + name + ".jpg";
        String lock = "studio:" + name;
        return jdbc.execute((ConnectionCallback<Map<String, String>>) connection -> {
            // Keep the MySQL lock and submission procedure on the same connection.
            var session = JdbcClient.create(new SingleConnectionDataSource(connection, true));
            Integer acquired = session.sql("SELECT GET_LOCK(:lock, 0)").param("lock", lock)
                    .query(Integer.class).optional().orElse(0);
            if (acquired != 1) {
                throw new ResponseStatusException(CONFLICT, "??????????????????");
            }
            try {
                String existing = receipt(session, account.uid(), oss.reference(videoKey), videoKey);
                if (existing != null) return Map.of("id", existing);
                return uploadAndSubmit(session, account.uid(), video, cover, videoKey, coverKey,
                        title, description, category, Integer.parseInt(statement), visibility);
            } finally {
                session.sql("SELECT RELEASE_LOCK(:lock)").param("lock", lock).query(Integer.class).optional();
            }
        });
    }

    private Map<String, String> uploadAndSubmit(JdbcClient session, String uid, MultipartFile video,
            MultipartFile cover, String videoKey, String coverKey, String title, String description,
            String category, int statement, String visibility) {
        Path directory = null;
        Path videoFile = null;
        Path coverFile = null;
        try {
            directory = Files.createTempDirectory("bili-studio-");
            videoFile = directory.resolve("video.mp4");
            coverFile = directory.resolve("cover.jpg");
            video.transferTo(videoFile);
            int duration = mp4Duration(videoFile);
            writeCover(cover, coverFile);
            String coverPath = oss.putFile(coverKey, "image/jpeg", coverFile);
            String videoPath = oss.putFile(videoKey, "video/mp4", videoFile);
            String id = session.sql("""
                CALL sp_submit_video_audit_with_tags(:uid,NULL,:title,:description,:cover,:video,
                    :statement,:category,NULL,:duration,:visibility,NULL)
                """).param("uid", uid).param("title", title).param("description", description)
                    .param("cover", coverPath).param("video", videoPath).param("statement", statement)
                    .param("category", category).param("duration", duration).param("visibility", visibility)
                    .query((rs, row) -> rs.getString("VideoID")).single();
            return Map.of("id", id);
        } catch (DataAccessException error) {
            if (error.getMostSpecificCause() instanceof java.sql.SQLException sql && "45000".equals(sql.getSQLState())) {
                throw new ResponseStatusException(CONFLICT, "????????????????????");
            }
            throw error;
        } catch (IOException error) {
            throw new ResponseStatusException(INTERNAL_SERVER_ERROR, "??????????????", error);
        } finally {
            delete(coverFile);
            delete(videoFile);
            delete(directory);
        }
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    @ResponseStatus(PAYLOAD_TOO_LARGE)
    Map<String, String> tooLarge() {
        return Map.of("message", "视频最多 256 MB，封面最多 5 MB");
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String, String>> uploadError(ResponseStatusException error) {
        String message = error.getReason() == null ? "登录后才能提交视频" : error.getReason();
        return ResponseEntity.status(error.getStatusCode()).body(Map.of("message", message));
    }

    private String receipt(JdbcClient session, String uid, String remotePath, String localPath) {
        return session.sql("""
            SELECT CAST(VideoID AS CHAR) FROM videopendingaudittable
            WHERE UID=CAST(:uid AS UNSIGNED) AND VideoContent IN (:remote,:local)
            ORDER BY PendingAuditID LIMIT 1
            """).param("uid", uid).param("remote", remotePath).param("local", localPath)
                .query(String.class).optional().orElseGet(() -> session.sql("""
                    SELECT CAST(VideoID AS CHAR) FROM videotable
                    WHERE UID=CAST(:uid AS UNSIGNED) AND VideoContent IN (:remote,:local)
                    ORDER BY VideoID LIMIT 1
                    """).param("uid", uid).param("remote", remotePath).param("local", localPath)
                        .query(String.class).optional().orElse(null));
    }

    private static String field(MultipartHttpServletRequest body, String name) {
        String value = body.getParameter(name);
        return value == null ? "" : value.strip();
    }

    private static void delete(Path file) {
        if (file == null) return;
        try {
            Files.deleteIfExists(file);
        } catch (IOException error) {
            System.getLogger(StudioUploadController.class.getName()).log(System.Logger.Level.WARNING,
                    "Could not remove an incomplete upload", error);
        }
    }

    private static void writeCover(MultipartFile cover, Path target) throws IOException {
        try (var input = cover.getInputStream(); var imageInput = ImageIO.createImageInputStream(input)) {
            if (imageInput == null) throw invalid("无法读取封面");
            var readers = ImageIO.getImageReaders(imageInput);
            if (!readers.hasNext()) throw invalid("封面必须是 JPG 或 PNG 图片");
            var reader = readers.next();
            try {
                if (!java.util.Set.of("jpeg", "png").contains(reader.getFormatName().toLowerCase(java.util.Locale.ROOT))) {
                    throw invalid("封面必须是 JPG 或 PNG 图片");
                }
                reader.setInput(imageInput);
                int width = reader.getWidth(0);
                int height = reader.getHeight(0);
                if (width < 1 || height < 1 || width > 8192 || height > 8192) throw invalid("封面尺寸不受支持");
                int sample = Math.max(1, (Math.max(width, height) + 1599) / 1600);
                var settings = reader.getDefaultReadParam();
                settings.setSourceSubsampling(sample, sample, 0, 0);
                var source = reader.read(0, settings);
                var image = new BufferedImage(source.getWidth(), source.getHeight(), BufferedImage.TYPE_INT_RGB);
                var graphics = image.createGraphics();
                try { graphics.drawImage(source, 0, 0, java.awt.Color.WHITE, null); }
                finally { graphics.dispose(); }
                try (var output = Files.newOutputStream(target, java.nio.file.StandardOpenOption.CREATE_NEW, java.nio.file.StandardOpenOption.WRITE)) {
                    if (!ImageIO.write(image, "jpg", output)) throw new IOException("JPEG writer not available");
                }
            } catch (javax.imageio.IIOException ex) {
                throw invalid("封面损坏，请重新选择");
            } finally {
                reader.dispose();
            }
        }
    }

    static int mp4Duration(Path file) throws IOException {
        try (var input = new RandomAccessFile(file.toFile(), "r")) {
            Box movie = null;
            boolean fileType = false;
            boolean media = false;
            for (long start = 0, end = input.length(); start < end;) {
                Box box = boxAt(input, start, end);
                if ("ftyp".equals(box.type()) && box.end() - box.data() >= 8) fileType = true;
                if ("moov".equals(box.type())) movie = box;
                if ("mdat".equals(box.type()) && box.end() > box.data()) media = true;
                start = box.end();
            }
            if (!fileType || !media || movie == null || !hasVideoTrack(input, movie)) throw invalid("请选择有效的 MP4 视频");
            Box header = child(input, movie, "mvhd");
            if (header == null || header.end() - header.data() < 20) throw invalid("无法读取视频时长");
            input.seek(header.data());
            int version = input.readUnsignedByte();
            if (version != 0 && (version != 1 || header.end() - header.data() < 32)) throw invalid("无法读取视频时长");
            input.seek(header.data() + (version == 1 ? 20 : 12));
            long scale = Integer.toUnsignedLong(input.readInt());
            long duration = version == 1 ? input.readLong() : Integer.toUnsignedLong(input.readInt());
            if (scale == 0 || duration <= 0 || duration > scale * MAX_DURATION) throw invalid("视频时长须大于 0 秒且不超过 10 小时");
            return (int) ((duration + scale - 1) / scale);
        }
    }

    private static boolean hasVideoTrack(RandomAccessFile input, Box movie) throws IOException {
        for (long start = movie.data(); start < movie.end();) {
            Box track = boxAt(input, start, movie.end());
            start = track.end();
            if (!"trak".equals(track.type())) continue;
            Box media = child(input, track, "mdia");
            Box handler = media == null ? null : child(input, media, "hdlr");
            if (handler != null && handler.end() - handler.data() >= 12) {
                input.seek(handler.data() + 8);
                if (input.readInt() == 0x76696465) return true;
            }
        }
        return false;
    }

    private static Box child(RandomAccessFile input, Box parent, String type) throws IOException {
        for (long start = parent.data(); start < parent.end();) {
            Box box = boxAt(input, start, parent.end());
            if (type.equals(box.type())) return box;
            start = box.end();
        }
        return null;
    }

    private static Box boxAt(RandomAccessFile input, long start, long end) throws IOException {
        if (end - start < 8) throw invalid("MP4 文件不完整");
        input.seek(start);
        long size = Integer.toUnsignedLong(input.readInt());
        byte[] type = new byte[4];
        input.readFully(type);
        int header = 8;
        if (size == 1 && end - start >= 16) {
            size = input.readLong();
            header = 16;
        } else if (size == 0) {
            size = end - start;
        }
        if (size < header || size > end - start) throw invalid("MP4 文件不完整");
        return new Box(new String(type, java.nio.charset.StandardCharsets.ISO_8859_1), start + header, start + size);
    }

    private static ResponseStatusException invalid(String message) {
        return new ResponseStatusException(BAD_REQUEST, message);
    }

    private record Box(String type, long data, long end) {}
}

