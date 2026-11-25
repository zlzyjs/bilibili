package cn.edu.bilibili.home;

import com.aliyun.oss.OSS;
import com.aliyun.oss.OSSException;
import com.aliyun.oss.ClientException;
import com.aliyun.oss.model.ObjectMetadata;
import java.io.ByteArrayInputStream;
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
        String prefix = "oss://" + bucket + "/";
        if (!path.startsWith(prefix)) throw new ResponseStatusException(NOT_FOUND, "OSS 媒体路径无效");
        String object = path.substring(prefix.length());
        if (!((object.startsWith(directory) && object.length() > directory.length()) ||
                  (object.startsWith("media/" + directory) && object.length() > 6 + directory.length()))) {
            throw new ResponseStatusException(NOT_FOUND, "OSS 媒体路径无效");
        }
        if (client == null) throw new ResponseStatusException(SERVICE_UNAVAILABLE, "尚未配置 OSS");
        return URI.create(client.generatePresignedUrl(bucket, object,
                Date.from(Instant.now().plusSeconds(3600))).toString());
    }

    String putAvatar(String uid, byte[] png) {
        if (client == null) throw new ResponseStatusException(SERVICE_UNAVAILABLE, "尚未配置 OSS");
        String hash;
        try {
            hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(png));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
        String path = "media/avatars/uploads/" + uid + "/" + hash + ".png";
        var metadata = new ObjectMetadata();
        metadata.setContentLength(png.length);
        metadata.setContentType("image/png");
        try {
            client.putObject(bucket, path, new ByteArrayInputStream(png), metadata);
        } catch (OSSException ex) {
            if ("AccessDenied".equals(ex.getErrorCode())) {
                throw new ResponseStatusException(SERVICE_UNAVAILABLE, "OSS 尚未授予头像目录写权限");
            }
            throw new ResponseStatusException(SERVICE_UNAVAILABLE, "OSS 暂时无法保存头像，请稍后重试");
        } catch (ClientException ex) {
            throw new ResponseStatusException(SERVICE_UNAVAILABLE, "OSS 连接失败，请稍后重试");
        }
        return "oss://" + bucket + "/" + path;
    }

    @PreDestroy
    void close() { if (client != null) client.shutdown(); }

    String bucketName() { return bucket; }
}
