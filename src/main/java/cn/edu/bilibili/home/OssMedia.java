package cn.edu.bilibili.home;

import com.aliyun.oss.OSS;
import com.aliyun.oss.OSSException;
import com.aliyun.oss.ClientException;
import com.aliyun.oss.model.ObjectMetadata;
import com.aliyun.oss.model.PutObjectRequest;
import com.aliyun.oss.model.InitiateMultipartUploadRequest;
import com.aliyun.oss.model.UploadPartRequest;
import com.aliyun.oss.model.CompleteMultipartUploadRequest;
import com.aliyun.oss.model.AbortMultipartUploadRequest;
import com.aliyun.oss.model.PartETag;
import java.util.ArrayList;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import com.aliyun.oss.OSSClientBuilder;
import com.aliyun.oss.ClientBuilderConfiguration;
import com.aliyun.oss.common.auth.DefaultCredentialProvider;
import com.aliyun.oss.common.comm.SignVersion;
import jakarta.annotation.PreDestroy;
import java.net.URI;
import java.time.Instant;
import java.util.Date;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import static org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE;
import static org.springframework.http.HttpStatus.NOT_FOUND;

@Component
class OssMedia {
    private final OSS client;
    private final String bucket;

    OssMedia(@Value("${app.oss.endpoint:}") String endpoint,
             @Value("${app.oss.bucket:bilibili-media}") String bucket,
             @Value("${app.oss.access-key-id:}") String key,
             @Value("${app.oss.access-key-secret:}") String secret) {
        this.bucket = bucket;
        if (endpoint.isBlank() || key.isBlank() || secret.isBlank()) {
            client = null;
        } else {
            String host = URI.create(endpoint).getHost();
            if (host == null || !host.matches("oss-[a-z0-9-]+\\.aliyuncs\\.com")) {
                throw new IllegalArgumentException("OSS endpoint must be an HTTPS regional endpoint");
            }
            String region = host.substring(4, host.indexOf(".aliyuncs.com")).replace("-internal", "");
            var config = new ClientBuilderConfiguration();
            config.setSignatureVersion(SignVersion.V4);
            client = OSSClientBuilder.create().endpoint("https://" + host).region(region)
                    .credentialsProvider(new DefaultCredentialProvider(key, secret))
                    .clientConfiguration(config).build();
        }
    }

    URI location(String path, String directory) {
        if (path == null || !path.startsWith("oss://")) return null;
        String object = objectKey(path, directory);
        requireClient();
        return URI.create(client.generatePresignedUrl(bucket, object,
                Date.from(Instant.now().plusSeconds(3600))).toString());
    }

    private String objectKey(String path, String directory) {
        String prefix = "oss://" + bucket + "/";
        if (!path.startsWith(prefix)) throw new ResponseStatusException(NOT_FOUND, "OSS 媒体路径无效");
        String object = path.substring(prefix.length());
        if (!((object.startsWith(directory) && object.length() > directory.length()) ||
                  (object.startsWith("media/" + directory) && object.length() > 6 + directory.length()))) {
            throw new ResponseStatusException(NOT_FOUND, "OSS 媒体路径无效");
        }
        return object;
    }

    String putAvatar(String uid, byte[] png) {
        return putImage("media/avatars/uploads/" + uid + "/", "image/png", png);
    }

    void streamVideo(String path, jakarta.servlet.http.HttpServletRequest request,
                     jakarta.servlet.http.HttpServletResponse response) throws IOException {
        String object = objectKey(path, "videos/");
        requireClient();
        try {
            long length = client.getObjectMetadata(bucket, object).getContentLength();
            long start = 0, end = length - 1;
            String range = request.getHeader("Range");
            if (range != null) {
                try {
                    var ranges = org.springframework.http.HttpRange.parseRanges(range);
                    if (ranges.size() != 1) throw new IllegalArgumentException();
                    start = ranges.get(0).getRangeStart(length);
                    end = ranges.get(0).getRangeEnd(length);
                    if (start > end || start >= length) throw new IllegalArgumentException();
                } catch (IllegalArgumentException ex) {
                    response.setStatus(416);
                    response.setHeader("Content-Range", "bytes */" + length);
                    return;
                }
                response.setStatus(206);
                response.setHeader("Content-Range", "bytes " + start + "-" + end + "/" + length);
            }
            response.setContentType("video/mp4");
            response.setHeader("Cache-Control", "no-store");
            response.setHeader("Accept-Ranges", "bytes");
            response.setContentLengthLong(end - start + 1);
            var get = new com.aliyun.oss.model.GetObjectRequest(bucket, object);
            get.setRange(start, end);
            try (var stored = client.getObject(get)) {
                stored.getObjectContent().transferTo(response.getOutputStream());
            }
        } catch (OSSException | ClientException ex) {
            throw new ResponseStatusException(SERVICE_UNAVAILABLE, "OSS 暂时无法读取视频", ex);
        }
    }

    String putImage(String prefix, String mime, byte[] bytes) {
        String hash;
        try {
            hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
        String object = prefix + hash + "." + mime.substring("image/".length());
        return put(new PutObjectRequest(bucket, object, new ByteArrayInputStream(bytes), metadata(mime, bytes.length)));
    }

    String reference(String object) {
        return "oss://" + bucket + "/" + object;
    }

    String putFile(String object, String mime, Path file) throws IOException {
        return put(new PutObjectRequest(bucket, object, file.toFile(), metadata(mime, Files.size(file))));
    }

    private static ObjectMetadata metadata(String mime, long length) {
        var metadata = new ObjectMetadata();
        metadata.setContentLength(length);
        metadata.setContentType(mime);
        return metadata;
    }

    private String put(PutObjectRequest upload) {
        requireClient();
        try {
            client.putObject(upload);
        } catch (OSSException ex) {
            if ("AccessDenied".equals(ex.getErrorCode())) {
                throw new ResponseStatusException(SERVICE_UNAVAILABLE, "OSS 尚未授予目标目录写权限", ex);
            }
            throw new ResponseStatusException(SERVICE_UNAVAILABLE, "OSS 暂时无法保存文件，请稍后重试", ex);
        } catch (ClientException ex) {
            throw new ResponseStatusException(SERVICE_UNAVAILABLE, "OSS 连接失败，请稍后重试", ex);
        }
        return reference(upload.getKey());
    }

    MessageStore.Image privateImage(String path, int limit) {
        String object = objectKey(path, "message/");
        String mime = switch (object.substring(object.lastIndexOf('.') + 1)) {
            case "png" -> "image/png";
            case "jpeg" -> "image/jpeg";
            case "gif" -> "image/gif";
            default -> throw new ResponseStatusException(NOT_FOUND, "私信图片不可用");
        };
        requireClient();
        try (var stored = client.getObject(bucket, object)) {
            byte[] bytes = stored.getObjectContent().readNBytes(limit + 1);
            if (bytes.length == 0 || bytes.length > limit) {
                throw new ResponseStatusException(NOT_FOUND, "私信图片不可用");
            }
            return new MessageStore.Image(mime, bytes);
        } catch (OSSException ex) {
            if ("NoSuchKey".equals(ex.getErrorCode())) {
                throw new ResponseStatusException(NOT_FOUND, "私信图片不存在");
            }
            throw new ResponseStatusException(SERVICE_UNAVAILABLE, "OSS 暂时无法读取私信图片", ex);
        } catch (IOException | ClientException ex) {
            throw new ResponseStatusException(SERVICE_UNAVAILABLE, "OSS 暂时无法读取私信图片", ex);
        }
    }

    private void requireClient() {
        if (client == null) throw new ResponseStatusException(SERVICE_UNAVAILABLE, "尚未配置 OSS");
    }

    @PreDestroy
    void close() { if (client != null) client.shutdown(); }

    String bucketName() { return bucket; }
}
