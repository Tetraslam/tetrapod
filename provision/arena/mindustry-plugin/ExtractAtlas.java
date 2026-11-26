import arc.files.Fi;
import arc.graphics.g2d.TextureAtlas;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

public class ExtractAtlas {
    public static void main(String[] args) throws Exception {
        File dir = new File(args[0]);
        Fi aatls = new Fi(new File(dir, "sprites.aatls"));
        TextureAtlas.TextureAtlasData data = new TextureAtlas.TextureAtlasData(aatls, new Fi(dir), false);
        StringBuilder sb = new StringBuilder(1 << 20);
        sb.append("{\"pages\":[");
        var pages = data.getPages();
        for (int i = 0; i < pages.size; i++) {
            if (i > 0) sb.append(',');
            sb.append('"').append(pages.get(i).textureFile.name()).append('"');
        }
        sb.append("],\"regions\":{");
        var regions = data.getRegions();
        for (int i = 0; i < regions.size; i++) {
            var r = regions.get(i);
            int pIdx = pages.indexOf(r.page, true);
            if (i > 0) sb.append(',');
            sb.append('"').append(r.name.replace("\\", "\\\\").replace("\"", "\\\"")).append("\":[")
              .append(pIdx).append(',').append(r.left).append(',').append(r.top).append(',')
              .append(r.width).append(',').append(r.height).append(']');
        }
        sb.append("}}");
        try (FileOutputStream fos = new FileOutputStream(new File(dir, "atlas.json"))) {
            fos.write(sb.toString().getBytes(StandardCharsets.UTF_8));
        }
        System.out.println("Extracted " + pages.size + " pages, " + regions.size + " regions");
    }
}
