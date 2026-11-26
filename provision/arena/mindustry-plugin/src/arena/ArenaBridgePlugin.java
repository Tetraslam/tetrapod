package arena;

import arc.Core;
import arc.util.Log;
import arc.util.serialization.JsonReader;
import arc.util.serialization.JsonValue;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import mindustry.Vars;
import mindustry.game.Team;
import mindustry.gen.Building;
import mindustry.gen.Bullet;
import mindustry.gen.Call;
import mindustry.gen.Groups;
import mindustry.gen.Unit;
import mindustry.maps.Map;
import mindustry.mod.Plugin;
import mindustry.server.ServerControl;
import mindustry.type.Item;
import mindustry.type.ItemStack;
import mindustry.world.Block;
import mindustry.world.Build;
import mindustry.world.Tile;
import mindustry.world.blocks.defense.turrets.Turret;
import mindustry.world.blocks.storage.CoreBlock;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public class ArenaBridgePlugin extends Plugin {
    private HttpServer server;

    @Override
    public void init() {
        try {
            int port = Integer.parseInt(System.getenv().getOrDefault("ARENA_BRIDGE_PORT", "6568"));
            server = HttpServer.create(new InetSocketAddress("0.0.0.0", port), 0);
            server.createContext("/health", this::handleHealth);
            server.createContext("/state", this::handleState);
            server.createContext("/terrain", this::handleTerrain);
            server.createContext("/tactical", this::handleTactical);
            server.createContext("/maps", this::handleMaps);
            server.createContext("/action", this::handleAction);
            server.setExecutor(Executors.newFixedThreadPool(4));
            server.start();
            Log.info("[arena-bridge] HTTP server listening on port @", port);
        } catch (Exception e) {
            Log.err("[arena-bridge] Failed to start HTTP server", e);
        }
    }

    private <T> T onMainThread(Callable<T> task) throws Exception {
        CompletableFuture<T> fut = new CompletableFuture<>();
        Core.app.post(() -> {
            try {
                fut.complete(task.call());
            } catch (Throwable t) {
                fut.completeExceptionally(t);
            }
        });
        return fut.get(5, TimeUnit.SECONDS);
    }

    private void sendJson(HttpExchange ex, int status, String json) throws IOException {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        ex.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(bytes);
        }
    }

    private static String esc(String s) {
        if (s == null) return "";
        StringBuilder sb = new StringBuilder(s.length() + 8);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> {
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
                }
            }
        }
        return sb.toString();
    }

    private static String hexColor(int rgba) {
        int rgb = (rgba >>> 8) & 0xFFFFFF;
        return String.format("#%06x", rgb);
    }

    private void handleHealth(HttpExchange ex) throws IOException {
        sendJson(ex, 200, "{\"ok\":true}");
    }

    private void handleTactical(HttpExchange ex) throws IOException {
        try {
            String json = onMainThread(() -> {
                if (Vars.world == null || Vars.world.width() == 0) {
                    return "{\"ready\":false}";
                }
                CoreBlock.CoreBuild core = Team.sharded.core();
                if (core == null) return "{\"ready\":false}";
                int cx = core.tileX();
                int cy = core.tileY();
                int w = Vars.world.width();
                int h = Vars.world.height();
                Block mechDrill = Vars.content.block("mechanical-drill");

                // Find nearest valid 2x2 drill sites per ore type within radius 34 of core
                HashMap<String, List<int[]>> drillSites = new HashMap<>();
                for (String ore : new String[]{"copper", "lead", "coal", "sand", "titanium"}) {
                    drillSites.put(ore, new ArrayList<>());
                }
                int searchR = 34;
                for (int r = 2; r <= searchR; r++) {
                    for (int dy = -r; dy <= r; dy++) {
                        for (int dx = -r; dx <= r; dx++) {
                            if (Math.max(Math.abs(dx), Math.abs(dy)) != r) continue;
                            int tx = cx + dx;
                            int ty = cy + dy;
                            if (tx < 2 || ty < 2 || tx >= w - 2 || ty >= h - 2) continue;
                            if (mechDrill == null || !Build.validPlace(mechDrill, Team.sharded, tx, ty, 0)) continue;
                            // Count ore tiles under 2x2 footprint (tx..tx+1, ty..ty+1)
                            HashMap<String, Integer> counts = new HashMap<>();
                            for (int oy = 0; oy <= 1; oy++) {
                                for (int ox = 0; ox <= 1; ox++) {
                                    Tile t = Vars.world.tile(tx + ox, ty + oy);
                                    if (t != null && t.overlay() != null && t.overlay().itemDrop != null) {
                                        String name = t.overlay().itemDrop.name;
                                        counts.put(name, counts.getOrDefault(name, 0) + 1);
                                    }
                                }
                            }
                            for (var entry : counts.entrySet()) {
                                List<int[]> list = drillSites.get(entry.getKey());
                                if (list != null && list.size() < 6) {
                                    boolean tooClose = false;
                                    for (int[] prev : list) {
                                        if (Math.abs(prev[0] - tx) < 2 && Math.abs(prev[1] - ty) < 2) {
                                            tooClose = true;
                                            break;
                                        }
                                    }
                                    if (!tooClose) list.add(new int[]{tx, ty, entry.getValue()});
                                }
                            }
                        }
                    }
                }

                // 33x33 ASCII grid centered on core (radius 16)
                int gr = 16;
                int minX = Math.max(0, cx - gr);
                int maxX = Math.min(w - 1, cx + gr);
                int minY = Math.max(0, cy - gr);
                int maxY = Math.min(h - 1, cy + gr);
                StringBuilder grid = new StringBuilder();
                for (int y = maxY; y >= minY; y--) {
                    grid.append(String.format("y=%3d ", y));
                    for (int x = minX; x <= maxX; x++) {
                        Tile t = Vars.world.tile(x, y);
                        char ch = '.';
                        if (t == null) {
                            ch = '#';
                        } else if (t.build != null) {
                            String bn = t.build.block.name;
                            if (t.build instanceof CoreBlock.CoreBuild) ch = 'C';
                            else if (bn.contains("drill")) ch = 'D';
                            else if (t.build instanceof Turret.TurretBuild) ch = 'T';
                            else if (bn.contains("wall")) ch = 'W';
                            else if (bn.contains("conveyor")) ch = switch (t.build.rotation) {
                                case 0 -> '>';
                                case 1 -> '^';
                                case 2 -> '<';
                                default -> 'v';
                            };
                            else if (bn.contains("router") || bn.contains("junction") || bn.contains("distributor")) ch = '+';
                            else if (bn.contains("power") || bn.contains("generator") || bn.contains("battery") || bn.contains("solar")) ch = 'P';
                            else ch = 'B';
                        } else if (t.block() != null && t.block().solid) {
                            ch = '#';
                        } else if (t.floor() != null && t.floor().isLiquid) {
                            ch = '~';
                        } else if (t.overlay() != null && t.overlay().itemDrop != null) {
                            String on = t.overlay().itemDrop.name;
                            ch = switch (on) {
                                case "copper" -> 'c';
                                case "lead" -> 'l';
                                case "coal" -> 'k';
                                case "sand" -> 's';
                                case "titanium" -> 't';
                                default -> 'o';
                            };
                        }
                        grid.append(ch);
                    }
                    grid.append('\n');
                }

                StringBuilder sb = new StringBuilder(4096);
                sb.append("{\"ready\":true,\"core\":{\"x\":").append(cx).append(",\"y\":").append(cy).append('}');
                sb.append(",\"gridBounds\":{\"minX\":").append(minX).append(",\"maxX\":").append(maxX)
                  .append(",\"minY\":").append(minY).append(",\"maxY\":").append(maxY).append('}');
                sb.append(",\"drillSites\":{");
                boolean firstOre = true;
                for (var entry : drillSites.entrySet()) {
                    if (!firstOre) sb.append(',');
                    firstOre = false;
                    sb.append('"').append(esc(entry.getKey())).append("\":[");
                    List<int[]> pts = entry.getValue();
                    for (int i = 0; i < pts.size(); i++) {
                        if (i > 0) sb.append(',');
                        sb.append("{\"x\":").append(pts.get(i)[0])
                          .append(",\"y\":").append(pts.get(i)[1])
                          .append(",\"tiles\":").append(pts.get(i)[2]).append('}');
                    }
                    sb.append(']');
                }
                sb.append('}');
                sb.append(",\"ascii\":\"").append(esc(grid.toString())).append("\"}");
                return sb.toString();
            });
            sendJson(ex, 200, json);
        } catch (Exception e) {
            sendJson(ex, 500, "{\"error\":\"" + esc(e.toString()) + "\"}");
        }
    }

    private void handleMaps(HttpExchange ex) throws IOException {
        try {
            String json = onMainThread(() -> {
                StringBuilder sb = new StringBuilder("{\"maps\":[");
                boolean first = true;
                for (Map m : Vars.maps.defaultMaps()) {
                    if (!first) sb.append(',');
                    first = false;
                    sb.append("{\"name\":\"").append(esc(m.plainName()))
                      .append("\",\"width\":").append(m.width)
                      .append(",\"height\":").append(m.height).append('}');
                }
                sb.append("]}");
                return sb.toString();
            });
            sendJson(ex, 200, json);
        } catch (Exception e) {
            sendJson(ex, 500, "{\"error\":\"" + esc(e.toString()) + "\"}");
        }
    }

    private void handleTerrain(HttpExchange ex) throws IOException {
        try {
            String json = onMainThread(() -> {
                if (Vars.world == null || Vars.world.width() == 0) {
                    return "{\"ready\":false}";
                }
                int w = Vars.world.width();
                int h = Vars.world.height();
                String mapName = Vars.state.map != null ? Vars.state.map.plainName() : "unknown";

                HashMap<String, Integer> paletteIdx = new HashMap<>();
                List<String> palette = new ArrayList<>();
                int[] cells = new int[w * h];
                StringBuilder ores = new StringBuilder("[");
                boolean firstOre = true;

                for (int y = 0; y < h; y++) {
                    for (int x = 0; x < w; x++) {
                        Tile t = Vars.world.tile(x, y);
                        String col = "#1a1f26";
                        if (t != null) {
                            Block b = t.block();
                            if (b != null && b.solid && t.build == null) {
                                col = hexColor(b.mapColor.rgba());
                            } else if (t.floor() != null) {
                                col = hexColor(t.floor().mapColor.rgba());
                            }
                            if (t.overlay() != null && t.overlay().itemDrop != null) {
                                if (!firstOre) ores.append(',');
                                firstOre = false;
                                ores.append("[").append(x).append(',').append(y).append(",\"")
                                    .append(esc(t.overlay().itemDrop.name)).append("\"]");
                            }
                        }
                        Integer idx = paletteIdx.get(col);
                        if (idx == null) {
                            idx = palette.size();
                            palette.add(col);
                            paletteIdx.put(col, idx);
                        }
                        cells[y * w + x] = idx;
                    }
                }
                ores.append(']');

                StringBuilder sb = new StringBuilder(w * h * 3 + 2048);
                sb.append("{\"ready\":true,\"map\":\"").append(esc(mapName))
                  .append("\",\"width\":").append(w)
                  .append(",\"height\":").append(h);

                // Spawns
                sb.append(",\"spawns\":[");
                boolean firstSpawn = true;
                if (Vars.spawner != null) {
                    for (Tile sp : Vars.spawner.getSpawns()) {
                        if (!firstSpawn) sb.append(',');
                        firstSpawn = false;
                        sb.append("{\"x\":").append(sp.x).append(",\"y\":").append(sp.y).append('}');
                    }
                }
                sb.append(']');

                // Core
                CoreBlock.CoreBuild core = Team.sharded.core();
                if (core != null) {
                    sb.append(",\"core\":{\"x\":").append(core.tileX())
                      .append(",\"y\":").append(core.tileY()).append('}');
                } else {
                    sb.append(",\"core\":null");
                }

                // Palette
                sb.append(",\"palette\":[");
                for (int i = 0; i < palette.size(); i++) {
                    if (i > 0) sb.append(',');
                    sb.append('"').append(palette.get(i)).append('"');
                }
                sb.append(']');

                // RLE encoded cells: [colorIdx, count, ...]
                sb.append(",\"rle\":[");
                int i = 0;
                boolean firstRun = true;
                while (i < cells.length) {
                    int val = cells[i];
                    int run = 1;
                    while (i + run < cells.length && cells[i + run] == val) run++;
                    if (!firstRun) sb.append(',');
                    firstRun = false;
                    sb.append(val).append(',').append(run);
                    i += run;
                }
                sb.append(']');

                sb.append(",\"ores\":").append(ores);
                sb.append('}');
                return sb.toString();
            });
            sendJson(ex, 200, json);
        } catch (Exception e) {
            sendJson(ex, 500, "{\"error\":\"" + esc(e.toString()) + "\"}");
        }
    }

    private void handleState(HttpExchange ex) throws IOException {
        try {
            String json = onMainThread(() -> {
                if (Vars.world == null || Vars.world.width() == 0) {
                    return "{\"ready\":false}";
                }
                String mapName = Vars.state.map != null ? Vars.state.map.plainName() : "unknown";
                StringBuilder sb = new StringBuilder(16384);
                sb.append("{\"ready\":true,\"map\":\"").append(esc(mapName))
                  .append("\",\"width\":").append(Vars.world.width())
                  .append(",\"height\":").append(Vars.world.height())
                  .append(",\"wave\":").append(Vars.state.wave)
                  .append(",\"waveTime\":").append(Math.round(Vars.state.wavetime / 60f * 10f) / 10f)
                  .append(",\"enemies\":").append(Vars.state.enemies)
                  .append(",\"gameOver\":").append(Vars.state.gameOver)
                  .append(",\"playing\":").append(Vars.state.isPlaying());

                CoreBlock.CoreBuild core = Team.sharded.core();
                if (core != null) {
                    sb.append(",\"core\":{\"x\":").append(core.tileX())
                      .append(",\"y\":").append(core.tileY())
                      .append(",\"hp\":").append(Math.round(core.health))
                      .append(",\"maxHp\":").append(Math.round(core.maxHealth))
                      .append(",\"block\":\"").append(esc(core.block.name)).append("\"}");
                    sb.append(",\"items\":{");
                    boolean firstItem = true;
                    for (Item item : Vars.content.items()) {
                        int amt = core.items.get(item);
                        if (amt > 0) {
                            if (!firstItem) sb.append(',');
                            firstItem = false;
                            sb.append('"').append(esc(item.name)).append("\":").append(amt);
                        }
                    }
                    sb.append('}');
                } else {
                    sb.append(",\"core\":null,\"items\":{}");
                }

                // Spawns
                sb.append(",\"spawns\":[");
                boolean firstSpawn = true;
                if (Vars.spawner != null) {
                    for (Tile sp : Vars.spawner.getSpawns()) {
                        if (!firstSpawn) sb.append(',');
                        firstSpawn = false;
                        sb.append("{\"x\":").append(sp.x).append(",\"y\":").append(sp.y).append('}');
                    }
                }
                sb.append(']');

                // Buildings
                float powerProd = 0f;
                float powerCons = 0f;
                sb.append(",\"buildings\":[");
                boolean firstB = true;
                for (Building b : Groups.build) {
                    if (b == null || b.block == null) continue;
                    if (!firstB) sb.append(',');
                    firstB = false;
                    int ammo = 0;
                    if (b instanceof Turret.TurretBuild tb) {
                        ammo = tb.totalAmmo;
                    }
                    if (b.team == Team.sharded && b.power != null && b.power.graph != null) {
                        powerProd = Math.max(powerProd, b.power.graph.getPowerProduced() * 60f);
                        powerCons = Math.max(powerCons, b.power.graph.getPowerNeeded() * 60f);
                    }
                    sb.append("{\"x\":").append(b.tileX())
                      .append(",\"y\":").append(b.tileY())
                      .append(",\"block\":\"").append(esc(b.block.name))
                      .append("\",\"size\":").append(b.block.size)
                      .append(",\"rot\":").append(b.rotation)
                      .append(",\"hp\":").append(Math.round(b.health))
                      .append(",\"maxHp\":").append(Math.round(b.maxHealth))
                      .append(",\"team\":\"").append(esc(b.team.name))
                      .append("\",\"ammo\":").append(ammo).append('}');
                }
                sb.append(']');
                sb.append(",\"power\":{\"produced\":").append(Math.round(powerProd))
                  .append(",\"consumed\":").append(Math.round(powerCons)).append('}');

                // Units
                sb.append(",\"units\":[");
                boolean firstU = true;
                for (Unit u : Groups.unit) {
                    if (u == null || u.dead()) continue;
                    if (!firstU) sb.append(',');
                    firstU = false;
                    sb.append("{\"id\":").append(u.id)
                      .append(",\"type\":\"").append(esc(u.type != null ? u.type.name : "unit"))
                      .append("\",\"team\":\"").append(esc(u.team.name))
                      .append("\",\"x\":").append(Math.round(u.x / 8f * 10f) / 10f)
                      .append(",\"y\":").append(Math.round(u.y / 8f * 10f) / 10f)
                      .append(",\"hp\":").append(Math.round(u.health))
                      .append(",\"maxHp\":").append(Math.round(u.maxHealth))
                      .append(",\"rot\":").append(Math.round(u.rotation)).append('}');
                }
                sb.append(']');

                // Bullets (cap at 200)
                sb.append(",\"bullets\":[");
                boolean firstBul = true;
                int bCount = 0;
                for (Bullet bul : Groups.bullet) {
                    if (bul == null || bCount >= 200) break;
                    if (!firstBul) sb.append(',');
                    firstBul = false;
                    bCount++;
                    sb.append("{\"x\":").append(Math.round(bul.x / 8f * 10f) / 10f)
                      .append(",\"y\":").append(Math.round(bul.y / 8f * 10f) / 10f)
                      .append(",\"team\":\"").append(esc(bul.team != null ? bul.team.name : "none"))
                      .append("\",\"dmg\":").append(Math.round(bul.damage)).append('}');
                }
                sb.append(']');

                sb.append('}');
                return sb.toString();
            });
            sendJson(ex, 200, json);
        } catch (Exception e) {
            sendJson(ex, 500, "{\"error\":\"" + esc(e.toString()) + "\"}");
        }
    }

    private String buildOne(String blockName, int x, int y, int rot) {
        Block block = Vars.content.block(blockName);
        if (block == null) return "unknown block: " + blockName;
        if (block.requirements == null || block.requirements.length == 0) {
            return "block not buildable: " + blockName;
        }
        CoreBlock.CoreBuild core = Team.sharded.core();
        if (core == null) return "no core";
        Tile tile = Vars.world.tile(x, y);
        if (tile == null) return "out of bounds";
        int r = ((rot % 4) + 4) % 4;
        if (!Build.validPlace(block, Team.sharded, x, y, r)) {
            return "invalid placement at (" + x + "," + y + ") for " + blockName;
        }
        if (!core.items.has(block.requirements)) {
            StringBuilder need = new StringBuilder("insufficient resources (need ");
            for (int i = 0; i < block.requirements.length; i++) {
                ItemStack s = block.requirements[i];
                if (i > 0) need.append(", ");
                need.append(s.amount).append(' ').append(s.item.name);
            }
            need.append(')');
            return need.toString();
        }
        core.items.remove(block.requirements);
        tile.setNet(block, Team.sharded, r);
        return null;
    }

    private void handleAction(HttpExchange ex) throws IOException {
        if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
            sendJson(ex, 405, "{\"ok\":false,\"error\":\"POST required\"}");
            return;
        }
        String body;
        try (InputStream is = ex.getRequestBody()) {
            body = new String(is.readAllBytes(), StandardCharsets.UTF_8);
        }
        try {
            JsonValue req = new JsonReader().parse(body);
            String type = req.getString("type", "");
            String resultJson = onMainThread(() -> {
                switch (type) {
                    case "build" -> {
                        String blockName = req.getString("block", "");
                        int x = req.getInt("x", -1);
                        int y = req.getInt("y", -1);
                        int rot = req.getInt("rot", 0);
                        String err = buildOne(blockName, x, y, rot);
                        if (err != null) return "{\"ok\":false,\"error\":\"" + esc(err) + "\"}";
                        return "{\"ok\":true,\"built\":1}";
                    }
                    case "build_line" -> {
                        String blockName = req.getString("block", "conveyor");
                        int x1 = req.getInt("x1", -1);
                        int y1 = req.getInt("y1", -1);
                        int x2 = req.getInt("x2", -1);
                        int y2 = req.getInt("y2", -1);
                        int built = 0;
                        int skipped = 0;
                        String lastErr = null;
                        int cx = x1, cy = y1;
                        int maxSteps = 60;
                        int steps = 0;
                        while (steps++ < maxSteps) {
                            int dx = Integer.compare(x2, cx);
                            int dy = Integer.compare(y2, cy);
                            int rot = 0;
                            if (dx != 0) rot = dx > 0 ? 0 : 2;
                            else if (dy != 0) rot = dy > 0 ? 1 : 3;
                            String err = buildOne(blockName, cx, cy, rot);
                            if (err == null) built++;
                            else {
                                skipped++;
                                lastErr = err;
                                if (err.startsWith("insufficient resources") || err.startsWith("unknown block")) break;
                            }
                            if (cx == x2 && cy == y2) break;
                            if (dx != 0) cx += dx;
                            else if (dy != 0) cy += dy;
                        }
                        if (built == 0) {
                            return "{\"ok\":false,\"built\":0,\"error\":\"" + esc(lastErr != null ? lastErr : "nothing built") + "\"}";
                        }
                        return "{\"ok\":true,\"built\":" + built + ",\"skipped\":" + skipped + "}";
                    }
                    case "demolish" -> {
                        int x = req.getInt("x", -1);
                        int y = req.getInt("y", -1);
                        Tile t = Vars.world.tile(x, y);
                        if (t == null || t.build == null || t.build.team != Team.sharded) {
                            return "{\"ok\":false,\"error\":\"no friendly building at (" + x + "," + y + ")\"}";
                        }
                        if (t.build instanceof CoreBlock.CoreBuild) {
                            return "{\"ok\":false,\"error\":\"cannot demolish core\"}";
                        }
                        CoreBlock.CoreBuild core = Team.sharded.core();
                        if (core != null && t.block().requirements != null) {
                            for (ItemStack s : t.block().requirements) {
                                int refund = Math.max(1, s.amount / 2);
                                core.items.add(s.item, refund);
                            }
                        }
                        t.build.tile.removeNet();
                        return "{\"ok\":true}";
                    }
                    case "send_wave" -> {
                        Vars.logic.runWave();
                        return "{\"ok\":true,\"wave\":" + Vars.state.wave + "}";
                    }
                    case "say" -> {
                        String msg = req.getString("text", "").trim();
                        if (!msg.isEmpty()) {
                            Call.sendMessage("[accent][AI][] " + msg);
                        }
                        return "{\"ok\":true}";
                    }
                    case "new_game" -> {
                        String mapName = req.getString("map", "").trim();
                        if (!mapName.isEmpty() && ServerControl.instance != null) {
                            ServerControl.instance.handler.handleMessage("nextmap " + mapName);
                        }
                        if (ServerControl.instance != null) {
                            ServerControl.instance.handler.handleMessage("gameover");
                        }
                        return "{\"ok\":true,\"map\":\"" + esc(mapName) + "\"}";
                    }
                    default -> {
                        return "{\"ok\":false,\"error\":\"unknown action type: " + esc(type) + "\"}";
                    }
                }
            });
            sendJson(ex, 200, resultJson);
        } catch (Exception e) {
            sendJson(ex, 400, "{\"ok\":false,\"error\":\"" + esc(e.toString()) + "\"}");
        }
    }
}
