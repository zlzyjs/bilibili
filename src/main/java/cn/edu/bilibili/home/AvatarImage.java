package cn.edu.bilibili.home;

import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Locale;
import javax.imageio.ImageIO;
import javax.imageio.stream.MemoryCacheImageInputStream;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import static org.springframework.http.HttpStatus.BAD_REQUEST;
import static org.springframework.http.HttpStatus.PAYLOAD_TOO_LARGE;

final class AvatarImage {
    private static final int SIZE = 180;

    private AvatarImage() {}

    static byte[] prepare(MultipartFile source) {
        if (source == null || source.isEmpty()) throw invalid();
        if (source.getSize() >= 2L * 1024 * 1024) {
            throw new ResponseStatusException(PAYLOAD_TOO_LARGE, "头像图片须小于 2 MB");
        }
        try (var input = new MemoryCacheImageInputStream(source.getInputStream())) {
            var readers = ImageIO.getImageReaders(input);
            if (!readers.hasNext()) throw invalid();
            var reader = readers.next();
            try {
                reader.setInput(input, true, true);
                String format = reader.getFormatName().toLowerCase(Locale.ROOT);
                if (!format.equals("jpeg") && !format.equals("png")) throw invalid();
                int width = reader.getWidth(0);
                int height = reader.getHeight(0);
                if (Math.min(width, height) < SIZE || (long) width * height > 20_000_000) {
                    throw new ResponseStatusException(BAD_REQUEST, "头像至少 180 × 180 像素，且不得超过 2000 万像素");
                }
                var image = reader.read(0);
                if (image == null) throw invalid();
                return crop(image);
            } finally {
                reader.dispose();
            }
        } catch (IOException | IllegalArgumentException ex) {
            throw invalid();
        }
    }

    private static byte[] crop(BufferedImage source) throws IOException {
        int size = Math.min(source.getWidth(), source.getHeight());
        int x = (source.getWidth() - size) / 2;
        int y = (source.getHeight() - size) / 2;
        var result = new BufferedImage(SIZE, SIZE, BufferedImage.TYPE_INT_ARGB);
        var graphics = result.createGraphics();
        try {
            graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
            graphics.drawImage(source, 0, 0, SIZE, SIZE, x, y, x + size, y + size, null);
        } finally {
            graphics.dispose();
        }
        var output = new ByteArrayOutputStream();
        ImageIO.write(result, "png", output);
        return output.toByteArray();
    }

    private static ResponseStatusException invalid() {
        return new ResponseStatusException(BAD_REQUEST, "请选择有效的 JPG 或 PNG 图片");
    }
}

