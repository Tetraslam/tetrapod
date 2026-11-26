package arena;

import arc.Core;
import arc.Events;
import arc.math.Angles;
import arc.math.Mathf;
import arc.math.geom.Point2;
import arc.util.Log;
import arc.util.serialization.JsonReader;
import arc.util.serialization.JsonValue;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import mindustry.Vars;
import mindustry.content.UnitTypes;
import mindustry.core.GameState;
import mindustry.game.EventType;
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
import mindustry.type.UnitType;
import mindustry.world.Block;
import mindustry.world.Build;
import mindustry.world.Tile;
import mindustry.world.blocks.defense.turrets.BaseTurret;
import mindustry.world.blocks.defense.turrets.ItemTurret;
import mindustry.world.blocks.defense.turrets.Turret;
import mindustry.world.blocks.distribution.Conveyor;
import mindustry.world.blocks.power.PowerNode;
import mindustry.world.blocks.production.Drill;
import mindustry.world.blocks.storage.CoreBlock;
import mindustry.world.meta.BuildVisibility;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public class ArenaBridgePlugin extends Plugin {
    private HttpServer server;
    private Unit aiDrone;
    private float droneTargetX = -1f;
    private float droneTargetY = -1f;
    private int buildBeamX = -1;
    private int buildBeamY = -1;
    private String buildBeamBlock = "";
    private long buildBeamUntil = 0L;
    private float patrolAngle = 0f;

    @Override
    public void init() {
        Events.run(EventType.Trigger.update, this::updateAiDrone);
        Events.on(EventType.WorldLoadEvent.class, e -> {
            aiDrone = null;
            droneTargetX = -1f;
            droneTargetY = -1f;
            buildBeamUntil = 0L;
        });
        try {
            int port = Integer.parseInt(System.getenv().getOrDefault("ARENA_BRIDGE_PORT", "6568"));
            server = HttpServer.create(new InetSocketAddress("0.0.0.0", port), 0);
            server.createContext("/health", this::handleHealth);
            server.createContext("/state", this::handleState);
            server.createContext("/terrain", this::handleTerrain);
            server.createContext("/tactical", this::handleTactical);
            server.createContext("/scan", this::handleScan);
            server.createContext("/ores", this::handleOres);
            server.createContext("/catalog", this::handleCatalog);
            server.createContext("/maps", this::handleMaps);
            server.createContext("/action", this::handleAction);
            server.setExecutor(Executors.newFixedThreadPool(4));
            server.start();
            Log.info("[arena-bridge] HTTP server listening on port @", port);
        } catch (Exception e) {
            Log.err("[arena-bridge] Failed to start HTTP server", e);
        }
    }

    private void updateAiDrone() {
        if (Vars.state == null || !Vars.state.isPlaying() || Vars.state.gameOver) return;
        CoreBlock.CoreBuild core = Team.sharded.core();
        if (core == null) return;

        if (aiDrone == null || aiDrone.dead() || !aiDrone.isAdded()) {
            UnitType shipType = UnitTypes.alpha;
            if (core.block != null && core.block.name != null) {
                if (core.block.name.contains("nucleus")) shipType = UnitTypes.gamma;
                else if (core.block.name.contains("foundation")) shipType = UnitTypes.beta;
            }
            aiDrone = shipType.spawn(Team.sharded, core.x, core.y);
            droneTargetX = core.x;
            droneTargetY = core.y;
        }

        long now = System.currentTimeMillis();
        float tx = droneTargetX;
        float ty = droneTargetY;
        if (now > buildBeamUntil + 3500L || tx < 0f) {
            // Patrol smoothly around core or shadow nearest enemy unit
            Unit nearestEnemy = null;
            float bestDist = 260f * 260f;
            for (Unit u : Groups.unit) {
                if (u == null || u.dead() || u.team == Team.sharded) continue;
                float d2 = Mathf.dst2(core.x, core.y, u.x, u.y);
                if (d2 < bestDist) {
                    bestDist = d2;
                    nearestEnemy = u;
                }
            }
            if (nearestEnemy != null) {
                float ang = Angles.angle(nearestEnemy.x, nearestEnemy.y, core.x, core.y);
                tx = nearestEnemy.x + Angles.trnsx(ang, 56f);
                ty = nearestEnemy.y + Angles.trnsy(ang, 56f);
            } else {
                patrolAngle = (patrolAngle + 0.55f) % 360f;
                tx = core.x + Angles.trnsx(patrolAngle, 52f);
                ty = core.y + Angles.trnsy(patrolAngle, 52f);
            }
        }

        float dx = tx - aiDrone.x;
        float dy = ty - aiDrone.y;
        float dist = Mathf.len(dx, dy);
        if (dist > 6f) {
            float speed = Math.min(3.8f, dist * 0.08f);
            float vx = (dx / dist) * speed;
            float vy = (dy / dist) * speed;
            aiDrone.vel.lerp(vx, vy, 0.22f);
            aiDrone.rotation = Angles.moveToward(aiDrone.rotation, Angles.angle(dx, dy), 9f);
        } else {
            aiDrone.vel.scl(0.85f);
            if (now <= buildBeamUntil && buildBeamX >= 0) {
                float bAng = Angles.angle(aiDrone.x, aiDrone.y, buildBeamX * 8f, buildBeamY * 8f);
                aiDrone.rotation = Angles.moveToward(aiDrone.rotation, bAng, 12f);
            }
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

    private static String biomeColor(Tile t) {
        if (t == null) return "#0b0f16";
        Block b = t.block();
        if (b != null && b.solid && t.build == null) {
            String bn = b.name != null ? b.name : "";
            if (bn.contains("snow") || bn.contains("ice")) return "#7a90a8";
            if (bn.contains("sand") || bn.contains("dune") || bn.contains("yellow")) return "#786246";
            if (bn.contains("spore") || bn.contains("moss") || bn.contains("shrub")) return "#3c4b3a";
            if (bn.contains("red") || bn.contains("ferric")) return "#633834";
            if (bn.contains("shale") || bn.contains("basalt") || bn.contains("dark")) return "#2b323e";
            if (bn.contains("salt")) return "#8b8f99";
            if (bn.contains("beryllic")) return "#39594f";
            return "#434c5c"; // crisp raised rock wall
        }
        if (t.floor() == null) return "#161c26";
        String fn = t.floor().name != null ? t.floor().name : "";
        if (fn.contains("deep-water") || fn.contains("deepwater")) return "#163252";
        if (fn.contains("tainted-water")) return "#2b4248";
        if (fn.contains("water") || fn.contains("arkycite")) return "#1e446b";
        if (fn.contains("slag") || fn.contains("magma") || fn.contains("hotrock")) return "#8c351e";
        if (fn.contains("tar") || fn.contains("oil")) return "#16141a";
        if (fn.contains("cryo")) return "#2c5f78";
        if (fn.contains("snow") || fn.contains("ice")) return "#384659";
        if (fn.contains("salt")) return "#4b515c";
        if (fn.contains("sand") || fn.contains("dune")) return "#3d3528";
        if (fn.contains("moss") || fn.contains("grass") || fn.contains("spore")) return "#1e2e24";
        if (fn.contains("mud")) return "#2c241d";
        if (fn.contains("metal") || fn.contains("dark-panel")) return "#242b38";
        if (fn.contains("basalt") || fn.contains("shale") || fn.contains("charr") || fn.contains("carbon")) return "#171c24";
        if (fn.contains("red") || fn.contains("ferric")) return "#2f2020";
        if (fn.contains("dacite") || fn.contains("stone") || fn.contains("crater")) return "#222936";
        return "#1c2330";
    }

    private void handleHealth(HttpExchange ex) throws IOException {
        sendJson(ex, 200, "{\"ok\":true}");
    }

    private static HashMap<String, String> parseQuery(String query) {
        HashMap<String, String> map = new HashMap<>();
        if (query == null || query.isEmpty()) return map;
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0) {
                map.put(pair.substring(0, eq), pair.substring(eq + 1));
            }
        }
        return map;
    }

    private static int parseIntParam(HashMap<String, String> q, String key, int def) {
        String v = q.get(key);
        if (v == null || v.isEmpty()) return def;
        try { return Integer.parseInt(v); } catch (Exception e) { return def; }
    }

    private void handleScan(HttpExchange ex) throws IOException {
        try {
            HashMap<String, String> q = parseQuery(ex.getRequestURI().getRawQuery());
            String json = onMainThread(() -> {
                if (Vars.world == null || Vars.world.width() == 0) return "{\"ready\":false}";
                CoreBlock.CoreBuild core = Team.sharded.core();
                int w = Vars.world.width();
                int h = Vars.world.height();
                int defX = core != null ? core.tileX() : w / 2;
                int defY = core != null ? core.tileY() : h / 2;
                int cx = Math.max(0, Math.min(w - 1, parseIntParam(q, "cx", defX)));
                int cy = Math.max(0, Math.min(h - 1, parseIntParam(q, "cy", defY)));
                int gr = Math.max(6, Math.min(22, parseIntParam(q, "r", 16)));
                int minX = Math.max(0, cx - gr);
                int maxX = Math.min(w - 1, cx + gr);
                int minY = Math.max(0, cy - gr);
                int maxY = Math.min(h - 1, cy + gr);

                // Overlay enemies & player drone onto a lookup map for the scanned window
                HashMap<Long, Character> unitOverlay = new HashMap<>();
                StringBuilder enemiesInView = new StringBuilder("[");
                boolean firstE = true;
                for (Unit u : Groups.unit) {
                    if (u == null || u.dead()) continue;
                    int ux = Math.round(u.x / 8f);
                    int uy = Math.round(u.y / 8f);
                    if (ux < minX || ux > maxX || uy < minY || uy > maxY) continue;
                    long key = (((long) ux) << 32) | (uy & 0xFFFFFFFFL);
                    if (u.team != Team.sharded) {
                        unitOverlay.put(key, 'E');
                        if (!firstE) enemiesInView.append(',');
                        firstE = false;
                        enemiesInView.append("{\"type\":\"").append(esc(u.type != null ? u.type.name : "unit"))
                            .append("\",\"x\":").append(ux).append(",\"y\":").append(uy)
                            .append(",\"hp\":").append(Math.round(u.health)).append('}');
                    } else if (aiDrone != null && u.id == aiDrone.id) {
                        unitOverlay.putIfAbsent(key, 'A');
                    }
                }
                enemiesInView.append(']');

                StringBuilder grid = new StringBuilder();
                for (int y = maxY; y >= minY; y--) {
                    grid.append(String.format("y=%3d ", y));
                    for (int x = minX; x <= maxX; x++) {
                        long key = (((long) x) << 32) | (y & 0xFFFFFFFFL);
                        Character uChar = unitOverlay.get(key);
                        if (uChar != null) {
                            grid.append(uChar.charValue());
                            continue;
                        }
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
                                case "thorium" -> 'h';
                                case "scrap" -> 'r';
                                default -> 'o';
                            };
                        }
                        grid.append(ch);
                    }
                    grid.append('\n');
                }

                StringBuilder sb = new StringBuilder(4096);
                sb.append("{\"ready\":true,\"center\":{\"x\":").append(cx).append(",\"y\":").append(cy)
                  .append("},\"bounds\":{\"minX\":").append(minX).append(",\"maxX\":").append(maxX)
                  .append(",\"minY\":").append(minY).append(",\"maxY\":").append(maxY)
                  .append("},\"mapSize\":{\"width\":").append(w).append(",\"height\":").append(h)
                  .append("},\"enemiesInView\":").append(enemiesInView)
                  .append(",\"ascii\":\"").append(esc(grid.toString())).append("\"}");
                return sb.toString();
            });
            sendJson(ex, 200, json);
        } catch (Exception e) {
            sendJson(ex, 500, "{\"error\":\"" + esc(e.toString()) + "\"}");
        }
    }

    private void handleOres(HttpExchange ex) throws IOException {
        try {
            HashMap<String, String> q = parseQuery(ex.getRequestURI().getRawQuery());
            String oreFilter = q.getOrDefault("ore", "").trim().toLowerCase();
            String json = onMainThread(() -> {
                if (Vars.world == null || Vars.world.width() == 0) return "{\"ready\":false}";
                CoreBlock.CoreBuild core = Team.sharded.core();
                int w = Vars.world.width();
                int h = Vars.world.height();
                int cx = Math.max(0, Math.min(w - 1, parseIntParam(q, "cx", core != null ? core.tileX() : w / 2)));
                int cy = Math.max(0, Math.min(h - 1, parseIntParam(q, "cy", core != null ? core.tileY() : h / 2)));
                int searchR = Math.max(8, Math.min(90, parseIntParam(q, "r", 55)));
                int limit = Math.max(1, Math.min(12, parseIntParam(q, "limit", 6)));
                Block mechDrill = Vars.content.block("mechanical-drill");

                String[] oreTypes = oreFilter.isEmpty()
                    ? new String[]{"copper", "lead", "coal", "sand", "titanium", "thorium", "scrap"}
                    : new String[]{oreFilter};
                HashMap<String, List<int[]>> drillSites = new HashMap<>();
                for (String ore : oreTypes) drillSites.put(ore, new ArrayList<>());

                for (int r = 2; r <= searchR; r++) {
                    for (int dy = -r; dy <= r; dy++) {
                        for (int dx = -r; dx <= r; dx++) {
                            if (Math.max(Math.abs(dx), Math.abs(dy)) != r) continue;
                            int tx = cx + dx;
                            int ty = cy + dy;
                            if (tx < 2 || ty < 2 || tx >= w - 2 || ty >= h - 2) continue;
                            if (mechDrill == null || !Build.validPlace(mechDrill, Team.sharded, tx, ty, 0)) continue;
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
                                if (list != null && list.size() < limit) {
                                    boolean tooClose = false;
                                    for (int[] prev : list) {
                                        if (Math.abs(prev[0] - tx) < 2 && Math.abs(prev[1] - ty) < 2) {
                                            tooClose = true;
                                            break;
                                        }
                                    }
                                    if (!tooClose) list.add(new int[]{tx, ty, entry.getValue(), r});
                                }
                            }
                        }
                    }
                }

                StringBuilder sb = new StringBuilder(2048);
                sb.append("{\"ready\":true,\"center\":{\"x\":").append(cx).append(",\"y\":").append(cy).append("},\"drillSites\":{");
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
                          .append(",\"tiles\":").append(pts.get(i)[2])
                          .append(",\"dist\":").append(pts.get(i)[3]).append('}');
                    }
                    sb.append(']');
                }
                sb.append("}}");
                return sb.toString();
            });
            sendJson(ex, 200, json);
        } catch (Exception e) {
            sendJson(ex, 500, "{\"error\":\"" + esc(e.toString()) + "\"}");
        }
    }

    private void handleCatalog(HttpExchange ex) throws IOException {
        try {
            HashMap<String, String> q = parseQuery(ex.getRequestURI().getRawQuery());
            String catFilter = q.getOrDefault("category", "").trim().toLowerCase();
            String nameFilter = q.getOrDefault("name", "").trim().toLowerCase();
            String json = onMainThread(() -> {
                StringBuilder sb = new StringBuilder(8192);
                sb.append("{\"blocks\":[");
                boolean first = true;
                for (Block b : Vars.content.blocks()) {
                    if (b == null || b.name == null || b.requirements == null || b.requirements.length == 0) continue;
                    if (b.buildVisibility == BuildVisibility.hidden || b.buildVisibility == BuildVisibility.sandboxOnly || b.buildVisibility == BuildVisibility.editorOnly) continue;
                    String cat = b.category != null ? b.category.name().toLowerCase() : "other";
                    if (!catFilter.isEmpty() && !cat.equals(catFilter)) continue;
                    if (!nameFilter.isEmpty() && !b.name.toLowerCase().contains(nameFilter)) continue;
                    if (!first) sb.append(',');
                    first = false;
                    sb.append("{\"name\":\"").append(esc(b.name))
                      .append("\",\"category\":\"").append(esc(cat))
                      .append("\",\"size\":").append(b.size)
                      .append(",\"hp\":").append(b.health)
                      .append(",\"costs\":{");
                    for (int i = 0; i < b.requirements.length; i++) {
                        ItemStack s = b.requirements[i];
                        if (i > 0) sb.append(',');
                        sb.append('"').append(esc(s.item.name)).append("\":").append(s.amount);
                    }
                    sb.append('}');
                    if (b instanceof BaseTurret bt) {
                        sb.append(",\"range\":").append(Math.round(bt.range / 8f));
                    }
                    if (b instanceof Turret t) {
                        sb.append(",\"targetAir\":").append(t.targetAir)
                          .append(",\"targetGround\":").append(t.targetGround);
                    }
                    if (b instanceof ItemTurret it && it.ammoTypes != null) {
                        sb.append(",\"ammo\":[");
                        boolean fa = true;
                        for (Item am : it.ammoTypes.keys()) {
                            if (!fa) sb.append(',');
                            fa = false;
                            sb.append('"').append(esc(am.name)).append('"');
                        }
                        sb.append(']');
                    }
                    if (b instanceof Drill d) {
                        sb.append(",\"tier\":").append(d.tier)
                          .append(",\"drillTime\":").append(Math.round(d.drillTime));
                    }
                    sb.append('}');
                }
                sb.append("]}");
                return sb.toString();
            });
            sendJson(ex, 200, json);
        } catch (Exception e) {
            sendJson(ex, 500, "{\"error\":\"" + esc(e.toString()) + "\"}");
        }
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
                HashMap<String, Integer> nameIdx = new HashMap<>();
                List<String> tileNames = new ArrayList<>();
                int[] cells = new int[w * h];
                int[] nameCells = new int[w * h];
                StringBuilder ores = new StringBuilder("[");
                boolean firstOre = true;

                for (int y = 0; y < h; y++) {
                    for (int x = 0; x < w; x++) {
                        Tile t = Vars.world.tile(x, y);
                        String col = biomeColor(t);
                        String tname = "stone";
                        if (t != null) {
                            Block b = t.block();
                            if (b != null && b.solid && t.build == null && b.name != null) {
                                tname = "W:" + b.name;
                            } else if (t.floor() != null && t.floor().name != null) {
                                tname = t.floor().name;
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

                        Integer nIdx = nameIdx.get(tname);
                        if (nIdx == null) {
                            nIdx = tileNames.size();
                            tileNames.add(tname);
                            nameIdx.put(tname, nIdx);
                        }
                        nameCells[y * w + x] = nIdx;
                    }
                }
                ores.append(']');

                StringBuilder sb = new StringBuilder(w * h * 4 + 4096);
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

                // RLE encoded color cells: [colorIdx, count, ...]
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

                // Exact Mindustry floor/wall tile names + RLE for authentic sprite rendering
                sb.append(",\"tileNames\":[");
                for (int j = 0; j < tileNames.size(); j++) {
                    if (j > 0) sb.append(',');
                    sb.append('"').append(esc(tileNames.get(j))).append('"');
                }
                sb.append(']');

                sb.append(",\"tileRle\":[");
                int k = 0;
                boolean firstNRun = true;
                while (k < nameCells.length) {
                    int val = nameCells[k];
                    int run = 1;
                    while (k + run < nameCells.length && nameCells[k + run] == val) run++;
                    if (!firstNRun) sb.append(',');
                    firstNRun = false;
                    sb.append(val).append(',').append(run);
                    k += run;
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
                  .append(",\"paused\":").append(Vars.state.isPaused())
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
                    sb.append("},\"flowRates\":{");
                    boolean firstFlow = true;
                    for (Item item : Vars.content.items()) {
                        float rate = core.items.getFlowRate(item);
                        if (rate > 0.05f) {
                            if (!firstFlow) sb.append(',');
                            firstFlow = false;
                            sb.append('"').append(esc(item.name)).append("\":").append(Math.round(rate * 10f) / 10f);
                        }
                    }
                    sb.append('}');
                } else {
                    sb.append(",\"core\":null,\"items\":{},\"flowRates\":{}");
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

                // Buildings + power links + live conveyor items
                float powerProd = 0f;
                float powerCons = 0f;
                StringBuilder powerLinks = new StringBuilder("[");
                boolean firstLink = true;
                HashSet<Long> seenLinks = new HashSet<>();
                StringBuilder convItems = new StringBuilder("[");
                boolean firstConv = true;
                int convCount = 0;

                sb.append(",\"buildings\":[");
                boolean firstB = true;
                // Walk the tile grid instead of Groups.build: idle conveyors sleep() themselves out of
                // that group, which made belts flicker in and out of the stream.
                int worldW = Vars.world.width();
                int worldH = Vars.world.height();
                for (int tileIdx = 0; tileIdx < worldW * worldH; tileIdx++) {
                    Tile originTile = Vars.world.tile(tileIdx % worldW, tileIdx / worldW);
                    if (originTile == null || originTile.build == null || originTile.build.tile != originTile) continue;
                    Building b = originTile.build;
                    if (b.block == null) continue;
                    if (!firstB) sb.append(',');
                    firstB = false;
                    int ammo = 0;
                    int aimRot = b.rotation * 90;
                    if (b instanceof Turret.TurretBuild tb) {
                        ammo = tb.totalAmmo;
                        aimRot = Math.round(tb.rotation);
                    } else if (b instanceof BaseTurret.BaseTurretBuild bt) {
                        aimRot = Math.round(bt.rotation);
                    }
                    if (b.team == Team.sharded && b.power != null) {
                        if (b.power.graph != null) {
                            powerProd = Math.max(powerProd, b.power.graph.getPowerProduced() * 60f);
                            powerCons = Math.max(powerCons, b.power.graph.getPowerNeeded() * 60f);
                        }
                        if (b.power.links != null && b.power.links.size > 0) {
                            int ax = b.tileX(), ay = b.tileY();
                            int aPos = Point2.pack(ax, ay);
                            for (int li = 0; li < b.power.links.size; li++) {
                                int pos = b.power.links.get(li);
                                int tx = Point2.x(pos);
                                int ty = Point2.y(pos);
                                long lo = Math.min(aPos, pos) & 0xFFFFFFFFL;
                                long hi = Math.max(aPos, pos) & 0xFFFFFFFFL;
                                long edgeKey = (lo << 32) | hi;
                                if (seenLinks.add(edgeKey)) {
                                    if (!firstLink) powerLinks.append(',');
                                    firstLink = false;
                                    powerLinks.append('[').append(ax).append(',').append(ay)
                                              .append(',').append(tx).append(',').append(ty).append(']');
                                }
                            }
                        }
                    }
                    if (convCount < 350 && b instanceof Conveyor.ConveyorBuild cb && cb.len > 0 && cb.ids != null) {
                        int dx = cb.rotation == 0 ? 1 : cb.rotation == 2 ? -1 : 0;
                        int dy = cb.rotation == 1 ? 1 : cb.rotation == 3 ? -1 : 0;
                        for (int ci = 0; ci < cb.len && convCount < 350; ci++) {
                            Item it = cb.ids[ci];
                            if (it == null) continue;
                            float prog = cb.ys[ci] - 0.5f;
                            float ix = cb.tileX() + 0.5f + dx * prog;
                            float iy = cb.tileY() + 0.5f + dy * prog;
                            if (!firstConv) convItems.append(',');
                            firstConv = false;
                            convCount++;
                            convItems.append('[').append(Math.round(ix * 10f) / 10f).append(',')
                                     .append(Math.round(iy * 10f) / 10f).append(",\"")
                                     .append(esc(it.name)).append("\"]");
                        }
                    }
                    sb.append("{\"x\":").append(b.tileX())
                      .append(",\"y\":").append(b.tileY())
                      .append(",\"block\":\"").append(esc(b.block.name))
                      .append("\",\"size\":").append(b.block.size)
                      .append(",\"rot\":").append(b.rotation)
                      .append(",\"aimRot\":").append(aimRot)
                      .append(",\"hp\":").append(Math.round(b.health))
                      .append(",\"maxHp\":").append(Math.round(b.maxHealth))
                      .append(",\"team\":\"").append(esc(b.team.name))
                      .append("\",\"ammo\":").append(ammo).append('}');
                }
                sb.append(']');
                powerLinks.append(']');
                convItems.append(']');
                sb.append(",\"powerLinks\":").append(powerLinks);
                sb.append(",\"conveyorItems\":").append(convItems);
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
                      .append("\",\"flying\":").append(u.type != null && u.type.flying)
                      .append(",\"team\":\"").append(esc(u.team.name))
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

                // Player builder drone (real Sharded alpha/beta/gamma unit flying to build sites)
                if (aiDrone != null && !aiDrone.dead() && aiDrone.isAdded()) {
                    sb.append(",\"playerDrone\":{\"id\":").append(aiDrone.id)
                      .append(",\"type\":\"").append(esc(aiDrone.type != null ? aiDrone.type.name : "alpha"))
                      .append("\",\"x\":").append(Math.round(aiDrone.x / 8f * 10f) / 10f)
                      .append(",\"y\":").append(Math.round(aiDrone.y / 8f * 10f) / 10f)
                      .append(",\"hp\":").append(Math.round(aiDrone.health))
                      .append(",\"maxHp\":").append(Math.round(aiDrone.maxHealth))
                      .append(",\"rot\":").append(Math.round(aiDrone.rotation));
                    if (System.currentTimeMillis() <= buildBeamUntil && buildBeamX >= 0) {
                        sb.append(",\"buildTarget\":{\"x\":").append(buildBeamX)
                          .append(",\"y\":").append(buildBeamY)
                          .append(",\"block\":\"").append(esc(buildBeamBlock)).append("\"}");
                    } else {
                        sb.append(",\"buildTarget\":null");
                    }
                    sb.append('}');
                } else {
                    sb.append(",\"playerDrone\":null");
                }

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
        if (tile.build != null) {
            // Trigger Mindustry's normal post-placement hook (auto-links power nodes and nearby consumers).
            tile.build.placed();
        }
        // Direct the AI builder drone to this build site with an active build beam
        droneTargetX = x * 8f;
        droneTargetY = y * 8f;
        buildBeamX = x;
        buildBeamY = y;
        buildBeamBlock = blockName;
        buildBeamUntil = System.currentTimeMillis() + 3200L;
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
                    case "route_belt" -> {
                        String blockName = req.getString("block", "conveyor");
                        int x1 = req.getInt("x1", -1);
                        int y1 = req.getInt("y1", -1);
                        int x2 = req.getInt("x2", -1);
                        int y2 = req.getInt("y2", -1);
                        int maxLen = Math.max(2, Math.min(80, req.getInt("maxLen", 50)));
                        boolean dryRun = req.getBoolean("dryRun", false);

                        Block block = Vars.content.block(blockName);
                        if (block == null || block.size != 1 || block.requirements == null || block.requirements.length == 0) {
                            return "{\"ok\":false,\"error\":\"route_belt requires a 1x1 buildable block\"}";
                        }
                        int w = Vars.world.width();
                        int h = Vars.world.height();
                        if (x1 < 0 || y1 < 0 || x1 >= w || y1 >= h || x2 < 0 || y2 < 0 || x2 >= w || y2 >= h) {
                            return "{\"ok\":false,\"error\":\"coordinates out of bounds\"}";
                        }

                        // BFS shortest obstacle-avoiding path; target tile (x2,y2) may be an existing building (e.g. core/router/turret)
                        // in which case we stop at the adjacent buildable tile facing into (x2,y2).
                        boolean endIsBuilding = Vars.world.tile(x2, y2) != null && Vars.world.tile(x2, y2).build != null;
                        int[] dxs = {1, 0, -1, 0};
                        int[] dys = {0, 1, 0, -1};
                        HashMap<Integer, Integer> parent = new HashMap<>();
                        ArrayDeque<Integer> queue = new ArrayDeque<>();

                        // Start from (x1,y1) if buildable, else its buildable neighbors (e.g. if user passed a drill's tile)
                        if (Build.validPlace(block, Team.sharded, x1, y1, 0)) {
                            int sk = y1 * w + x1;
                            parent.put(sk, -1);
                            queue.add(sk);
                        } else {
                            for (int d = 0; d < 4; d++) {
                                int nx = x1 + dxs[d], ny = y1 + dys[d];
                                if (nx >= 0 && ny >= 0 && nx < w && ny < h && Build.validPlace(block, Team.sharded, nx, ny, 0)) {
                                    int sk = ny * w + nx;
                                    if (!parent.containsKey(sk)) {
                                        parent.put(sk, -1);
                                        queue.add(sk);
                                    }
                                }
                            }
                        }

                        int foundKey = -1;
                        int visitedCap = 3500;
                        int visited = 0;
                        while (!queue.isEmpty() && visited++ < visitedCap) {
                            int cur = queue.poll();
                            int cx = cur % w, cy = cur / w;
                            if (cx == x2 && cy == y2) {
                                foundKey = cur;
                                break;
                            }
                            if (endIsBuilding && Math.abs(cx - x2) + Math.abs(cy - y2) == 1) {
                                foundKey = cur;
                                break;
                            }
                            for (int d = 0; d < 4; d++) {
                                int nx = cx + dxs[d], ny = cy + dys[d];
                                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                                int nk = ny * w + nx;
                                if (parent.containsKey(nk)) continue;
                                if (!Build.validPlace(block, Team.sharded, nx, ny, 0)) continue;
                                // Bounding box sanity so BFS stays local
                                if (Math.abs(nx - x1) + Math.abs(ny - y1) > maxLen + 12) continue;
                                parent.put(nk, cur);
                                queue.add(nk);
                            }
                        }

                        if (foundKey == -1) {
                            return "{\"ok\":false,\"error\":\"no unobstructed belt path from (" + x1 + "," + y1 + ") to (" + x2 + "," + y2 + ")\"}";
                        }

                        List<int[]> path = new ArrayList<>();
                        int k = foundKey;
                        while (k != -1) {
                            path.add(new int[]{k % w, k / w, 0});
                            k = parent.getOrDefault(k, -1);
                        }
                        Collections.reverse(path);
                        if (path.size() > maxLen) {
                            return "{\"ok\":false,\"error\":\"path length " + path.size() + " exceeds maxLen " + maxLen + "\"}";
                        }
                        for (int idx = 0; idx < path.size(); idx++) {
                            int px = path.get(idx)[0], py = path.get(idx)[1];
                            int tx = (idx + 1 < path.size()) ? path.get(idx + 1)[0] : x2;
                            int ty = (idx + 1 < path.size()) ? path.get(idx + 1)[1] : y2;
                            int dx = tx - px, dy = ty - py;
                            int rot = 0;
                            if (dx > 0) rot = 0;
                            else if (dy > 0) rot = 1;
                            else if (dx < 0) rot = 2;
                            else if (dy < 0) rot = 3;
                            else if (idx > 0) rot = path.get(idx - 1)[2];
                            path.get(idx)[2] = rot;
                        }

                        if (dryRun) {
                            StringBuilder psb = new StringBuilder("{\"ok\":true,\"dryRun\":true,\"length\":" + path.size() + ",\"path\":[");
                            for (int idx = 0; idx < path.size(); idx++) {
                                if (idx > 0) psb.append(',');
                                psb.append('[').append(path.get(idx)[0]).append(',').append(path.get(idx)[1]).append(',').append(path.get(idx)[2]).append(']');
                            }
                            psb.append("]}");
                            return psb.toString();
                        }

                        int built = 0;
                        String lastErr = null;
                        for (int[] step : path) {
                            String err = buildOne(blockName, step[0], step[1], step[2]);
                            if (err == null) built++;
                            else {
                                lastErr = err;
                                if (err.startsWith("insufficient resources")) break;
                            }
                        }
                        if (built == 0) {
                            return "{\"ok\":false,\"built\":0,\"error\":\"" + esc(lastErr != null ? lastErr : "nothing built") + "\"}";
                        }
                        int[] lastStep = path.get(path.size() - 1);
                        return "{\"ok\":true,\"built\":" + built + ",\"length\":" + path.size()
                            + ",\"end\":{\"x\":" + lastStep[0] + ",\"y\":" + lastStep[1] + "}}";
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
                    case "relink_power" -> {
                        int linked = 0;
                        int w = Vars.world.width();
                        int h = Vars.world.height();
                        for (int idx = 0; idx < w * h; idx++) {
                            Tile t = Vars.world.tile(idx % w, idx / w);
                            if (t == null || t.build == null || t.build.tile != t) continue;
                            if (t.build.team == Team.sharded && t.build instanceof PowerNode.PowerNodeBuild) {
                                t.build.placed();
                                linked++;
                            }
                        }
                        return "{\"ok\":true,\"nodes\":" + linked + "}";
                    }
                    case "set_paused" -> {
                        boolean wantPaused = req.getBoolean("paused", false);
                        if (Vars.state != null && Vars.state.isGame()) {
                            Vars.state.set(wantPaused ? GameState.State.paused : GameState.State.playing);
                        }
                        return "{\"ok\":true,\"paused\":" + (Vars.state != null && Vars.state.isPaused()) + "}";
                    }
                    case "new_game" -> {
                        String mapName = req.getString("map", "").trim();
                        if (Vars.state != null && Vars.state.isPaused()) {
                            Vars.state.set(GameState.State.playing);
                        }
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
