package arena;

import arc.Core;
import arc.Events;
import arc.graphics.Color;
import arc.math.Angles;
import arc.math.Mathf;
import arc.math.geom.Point2;
import arc.math.geom.Vec2;
import arc.struct.Seq;
import arc.util.Log;
import arc.util.serialization.JsonReader;
import arc.util.serialization.JsonValue;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import mindustry.Vars;
import mindustry.ai.UnitCommand;
import mindustry.ai.types.CommandAI;
import mindustry.ai.types.FlyingAI;
import mindustry.ai.types.MinerAI;
import mindustry.content.UnitTypes;
import mindustry.core.GameState;
import mindustry.entities.bullet.BasicBulletType;
import mindustry.entities.bullet.BulletType;
import mindustry.entities.bullet.ContinuousLaserBulletType;
import mindustry.entities.bullet.LaserBulletType;
import mindustry.entities.bullet.LightningBulletType;
import mindustry.entities.bullet.RailBulletType;
import mindustry.entities.bullet.ShrapnelBulletType;
import mindustry.entities.units.UnitController;
import mindustry.game.EventType;
import mindustry.game.Team;
import mindustry.gen.Building;
import mindustry.gen.Bullet;
import mindustry.gen.Call;
import mindustry.gen.Groups;
import mindustry.gen.Teamc;
import mindustry.gen.Unit;
import mindustry.maps.Map;
import mindustry.mod.Plugin;
import mindustry.server.ServerControl;
import mindustry.type.Item;
import mindustry.type.ItemStack;
import mindustry.type.Liquid;
import mindustry.type.UnitType;
import mindustry.world.Block;
import mindustry.world.Build;
import mindustry.world.Tile;
import mindustry.world.blocks.defense.turrets.BaseTurret;
import mindustry.world.blocks.defense.turrets.ItemTurret;
import mindustry.world.blocks.defense.turrets.Turret;
import mindustry.world.blocks.distribution.Conveyor;
import mindustry.world.blocks.distribution.ItemBridge;
import mindustry.world.blocks.distribution.MassDriver;
import mindustry.world.blocks.liquid.Conduit;
import mindustry.world.blocks.liquid.LiquidBlock;
import mindustry.world.blocks.logic.LogicBlock;
import mindustry.world.blocks.logic.MessageBlock;
import mindustry.world.blocks.logic.SwitchBlock;
import mindustry.world.blocks.power.PowerNode;
import mindustry.world.blocks.production.Drill;
import mindustry.world.blocks.production.Pump;
import mindustry.world.blocks.storage.CoreBlock;
import mindustry.world.blocks.units.Reconstructor;
import mindustry.world.blocks.units.UnitFactory;
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
import java.util.Iterator;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public class ArenaBridgePlugin extends Plugin {
    private static class PassiveController implements UnitController {
        private Unit unit;
        @Override public void unit(Unit u) { this.unit = u; }
        @Override public Unit unit() { return unit; }
        @Override public void updateUnit() {
            if (unit != null) {
                unit.controlWeapons(false);
                unit.mineTile = null;
            }
        }
    }

    private HttpServer server;
    private Unit aiDrone;
    private float droneTargetX = -1f;
    private float droneTargetY = -1f;
    private int buildBeamX = -1;
    private int buildBeamY = -1;
    private String buildBeamBlock = "";
    private long buildBeamUntil = 0L;
    private float patrolAngle = 0f;
    private String shipMode = "idle"; // idle | move | defend | mine
    private float shipGoalX = -1f;
    private float shipGoalY = -1f;
    private String shipMineOre = "";

    // 20 Hz live frame stream state (captured on main thread, served lock-free from ring buffer)
    private static class BuildingSnap {
        int x, y, size, rot, aimRot, hp, maxHp, ammo;
        String block, team;
    }

    private static class FrameEntry {
        long seq;
        long t;
        String map;
        String bAddJson;
        String bDelJson;
        String bUpdJson;
        boolean hasLinks;
        String powerLinksJson;
        String beamsJson;
        String dynamicJson;
    }

    private static final int FRAME_RING_CAP = 64;
    private final Object frameLock = new Object();
    private final FrameEntry[] frameRing = new FrameEntry[FRAME_RING_CAP];
    private long latestFrameSeq = 0L;
    private int frameRingCount = 0;

    private final HashMap<Integer, Building> trackedBuildings = new HashMap<>();
    private final HashSet<Conveyor.ConveyorBuild> trackedConveyors = new HashSet<>();
    private final HashMap<Integer, BuildingSnap> prevBuildingSnaps = new HashMap<>();
    private final HashSet<Integer> seenBeamIds = new HashSet<>();
    private final ArrayList<String> pendingBeams = new ArrayList<>();
    private boolean needsBuildingScan = true;
    private boolean powerLinksDirty = true;
    private int liveTickCounter = 0;
    private int rescanCounter = 0;
    private String lastFrameMap = "";

    @Override
    public void init() {
        Events.run(EventType.Trigger.update, () -> {
            updateAiDrone();
            captureLiveTick();
        });
        Events.on(EventType.WorldLoadEvent.class, e -> {
            aiDrone = null;
            droneTargetX = -1f;
            droneTargetY = -1f;
            buildBeamUntil = 0L;
            shipMode = "idle";
            shipGoalX = -1f;
            shipGoalY = -1f;
            shipMineOre = "";
            trackedBuildings.clear();
            trackedConveyors.clear();
            prevBuildingSnaps.clear();
            seenBeamIds.clear();
            pendingBeams.clear();
            needsBuildingScan = true;
            powerLinksDirty = true;
            rescanCounter = 0;
            lastFrameMap = "";
            synchronized (frameLock) {
                frameRingCount = 0;
            }
        });
        Events.on(EventType.TileChangeEvent.class, e -> {
            if (e != null && e.tile != null) {
                Building b = e.tile.build;
                if (b != null && b.block != null && b.tile != null) {
                    trackedBuildings.put(b.pos(), b);
                    if (b instanceof Conveyor.ConveyorBuild cb) trackedConveyors.add(cb);
                    if (b.power != null) powerLinksDirty = true;
                } else {
                    powerLinksDirty = true;
                }
            }
        });
        try {
            int port = Integer.parseInt(System.getenv().getOrDefault("ARENA_BRIDGE_PORT", "6568"));
            server = HttpServer.create(new InetSocketAddress("0.0.0.0", port), 0);
            server.createContext("/health", this::handleHealth);
            server.createContext("/state", this::handleState);
            server.createContext("/frame", this::handleFrame);
            server.createContext("/terrain", this::handleTerrain);
            server.createContext("/tactical", this::handleTactical);
            server.createContext("/scan", this::handleScan);
            server.createContext("/inspect", this::handleInspect);
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

    private void applyShipController() {
        if (aiDrone == null || aiDrone.dead()) return;
        switch (shipMode) {
            case "mine" -> {
                MinerAI miner = new MinerAI();
                Item target = Vars.content.item(shipMineOre);
                if (target != null) miner.targetItem = target;
                aiDrone.controller(miner);
            }
            case "defend" -> aiDrone.controller(new FlyingAI());
            default -> aiDrone.controller(new PassiveController());
        }
    }

    private void updateAiDrone() {
        if (Vars.state == null || !Vars.state.isPlaying() || Vars.state.gameOver) return;
        CoreBlock.CoreBuild core = Team.sharded.core();
        if (core == null) return;

        if (aiDrone == null || aiDrone.dead() || !aiDrone.isAdded()) {
            aiDrone = null;
            // Adopt an existing Sharded core ship (e.g. after save/load) before spawning a new one
            for (Unit u : Groups.unit) {
                if (u == null || u.dead() || u.team != Team.sharded || u.type == null) continue;
                String un = u.type.name;
                if ("alpha".equals(un) || "beta".equals(un) || "gamma".equals(un)) {
                    aiDrone = u;
                    break;
                }
            }
            if (aiDrone == null) {
                UnitType shipType = UnitTypes.alpha;
                if (core.block != null && core.block.name != null) {
                    if (core.block.name.contains("nucleus")) shipType = UnitTypes.gamma;
                    else if (core.block.name.contains("foundation")) shipType = UnitTypes.beta;
                }
                aiDrone = shipType.spawn(Team.sharded, core.x, core.y);
            }
            droneTargetX = core.x;
            droneTargetY = core.y;
            applyShipController();
        }

        long now = System.currentTimeMillis();
        boolean buildingNow = now <= buildBeamUntil && droneTargetX >= 0f;

        // In mine mode, let Mindustry's native MinerAI fly & deposit unless actively welding a new block
        if ("mine".equals(shipMode) && !buildingNow) {
            if (!(aiDrone.controller() instanceof MinerAI)) applyShipController();
            return;
        }

        float tx;
        float ty;
        if (buildingNow) {
            tx = droneTargetX;
            ty = droneTargetY;
        } else if ("move".equals(shipMode) && shipGoalX >= 0f) {
            tx = shipGoalX;
            ty = shipGoalY;
        } else if ("defend".equals(shipMode)) {
            float anchorX = shipGoalX >= 0f ? shipGoalX : core.x;
            float anchorY = shipGoalY >= 0f ? shipGoalY : core.y;
            Unit nearestEnemy = null;
            float bestDist = 280f * 280f;
            for (Unit u : Groups.unit) {
                if (u == null || u.dead() || u.team == Team.sharded) continue;
                float d2 = Mathf.dst2(anchorX, anchorY, u.x, u.y);
                if (d2 < bestDist) {
                    bestDist = d2;
                    nearestEnemy = u;
                }
            }
            if (nearestEnemy != null) {
                // Safe weapon-range standoff (~15 tiles) instead of face-tanking at 7 tiles
                float ang = Angles.angle(nearestEnemy.x, nearestEnemy.y, anchorX, anchorY);
                tx = nearestEnemy.x + Angles.trnsx(ang, 120f);
                ty = nearestEnemy.y + Angles.trnsy(ang, 120f);
            } else {
                patrolAngle = (patrolAngle + 0.5f) % 360f;
                tx = anchorX + Angles.trnsx(patrolAngle, 48f);
                ty = anchorY + Angles.trnsy(patrolAngle, 48f);
            }
        } else {
            // Passive default ("idle"): gently orbit safely around the core
            patrolAngle = (patrolAngle + 0.55f) % 360f;
            tx = core.x + Angles.trnsx(patrolAngle, 52f);
            ty = core.y + Angles.trnsy(patrolAngle, 52f);
        }

        float dx = tx - aiDrone.x;
        float dy = ty - aiDrone.y;
        float dist = Mathf.len(dx, dy);
        if (dist > 6f) {
            float speed = Math.min(3.8f, dist * 0.08f);
            float vx = (dx / dist) * speed;
            float vy = (dy / dist) * speed;
            aiDrone.vel.lerp(vx, vy, 0.22f);
            if (!"defend".equals(shipMode)) {
                aiDrone.rotation = Angles.moveToward(aiDrone.rotation, Angles.angle(dx, dy), 9f);
            }
        } else {
            aiDrone.vel.scl(0.85f);
            if (buildingNow && buildBeamX >= 0) {
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

    private static String formatLogicLinks(Seq<LogicBlock.LogicLink> links) {
        StringBuilder sb = new StringBuilder("[");
        if (links != null) {
            boolean first = true;
            for (int i = 0; i < links.size; i++) {
                LogicBlock.LogicLink lk = links.get(i);
                if (lk == null) continue;
                if (!first) sb.append(',');
                first = false;
                sb.append("{\"name\":\"").append(esc(lk.name))
                  .append("\",\"x\":").append(lk.x)
                  .append(",\"y\":").append(lk.y)
                  .append(",\"valid\":").append(lk.valid).append('}');
            }
        }
        sb.append(']');
        return sb.toString();
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

    private static float r2(float v) {
        return Math.round(v * 100f) / 100f;
    }

    private static String hexColor(Color c, String fallback) {
        if (c == null) return fallback;
        int rgb = c.rgb888() & 0xFFFFFF;
        char[] hex = {'0','1','2','3','4','5','6','7','8','9','a','b','c','d','e','f'};
        return new String(new char[]{
            '#',
            hex[(rgb >> 20) & 0xF], hex[(rgb >> 16) & 0xF],
            hex[(rgb >> 12) & 0xF], hex[(rgb >> 8) & 0xF],
            hex[(rgb >> 4) & 0xF], hex[rgb & 0xF]
        });
    }

    private static void classifyBullet(Bullet bul, int[] outKind, float[] outLenSize, String[] outColor) {
        BulletType bt = bul.type;
        String defCol = (bul.team == Team.sharded) ? "#ffe2a0" : "#ff7a66";
        int kind = 0; // 0=projectile, 1=laser/shrapnel, 2=lightning, 3=rail
        float len = 0f;
        float size = bt != null ? Math.max(0.08f, bt.hitSize / 16f) : 0.14f;
        String col = defCol;

        if (bt instanceof ContinuousLaserBulletType cl) {
            kind = 1;
            len = cl.length / 8f;
            size = Math.max(0.22f, cl.width / 8f);
            col = (cl.colors != null && cl.colors.length > 0) ? hexColor(cl.colors[cl.colors.length - 1], defCol) : defCol;
        } else if (bt instanceof LaserBulletType lb) {
            kind = 1;
            len = lb.length / 8f;
            size = Math.max(0.18f, lb.width / 10f);
            col = (lb.colors != null && lb.colors.length > 0) ? hexColor(lb.colors[0], defCol) : defCol;
        } else if (bt instanceof ShrapnelBulletType sb) {
            kind = 1;
            len = sb.length / 8f;
            size = Math.max(0.16f, sb.width / 10f);
            col = hexColor(sb.fromColor, defCol);
        } else if (bt instanceof RailBulletType rb) {
            kind = 3;
            len = rb.length / 8f;
            size = 0.24f;
            col = hexColor(bt.lightColor, "#fff3b8");
        } else if (bt instanceof LightningBulletType) {
            kind = 2;
            len = 8f;
            size = 0.16f;
            col = hexColor(bt.lightColor, "#a9d8ff");
        } else if (bt instanceof BasicBulletType bb) {
            size = Math.max(0.09f, Math.min(0.75f, Math.max(bb.width, bb.height) / 16f));
            col = hexColor(bb.frontColor != null ? bb.frontColor : bb.backColor, defCol);
        } else if (bt != null) {
            col = hexColor(bt.trailColor != null ? bt.trailColor : bt.lightColor, defCol);
        }

        outKind[0] = kind;
        outLenSize[0] = len;
        outLenSize[1] = size;
        outColor[0] = col;
    }

    private void rescanTrackedBuildings() {
        trackedBuildings.clear();
        trackedConveyors.clear();
        if (Vars.world == null) return;
        int w = Vars.world.width();
        int h = Vars.world.height();
        for (int idx = 0; idx < w * h; idx++) {
            Tile t = Vars.world.tile(idx % w, idx / w);
            if (t == null || t.build == null || t.build.tile != t || t.build.block == null) continue;
            Building b = t.build;
            trackedBuildings.put(b.pos(), b);
            if (b instanceof Conveyor.ConveyorBuild cb) trackedConveyors.add(cb);
        }
        needsBuildingScan = false;
        rescanCounter = 0;
        powerLinksDirty = true;
    }

    private void captureLiveTick() {
        if (Vars.world == null || Vars.world.width() == 0 || Vars.state == null) return;
        String mapName = Vars.state.map != null ? Vars.state.map.plainName() : "unknown";
        if (!mapName.equals(lastFrameMap)) {
            lastFrameMap = mapName;
            needsBuildingScan = true;
            prevBuildingSnaps.clear();
            seenBeamIds.clear();
            pendingBeams.clear();
        }

        // Capture instant/short-lived beams & lightning at full 60 Hz so no shot is skipped between 20 Hz frames
        int[] kOut = new int[1];
        float[] lsOut = new float[2];
        String[] cOut = new String[1];
        for (Bullet bul : Groups.bullet) {
            if (bul == null || bul.type == null) continue;
            BulletType bt = bul.type;
            boolean isBeam = bt instanceof LaserBulletType || bt instanceof ContinuousLaserBulletType
                || bt instanceof ShrapnelBulletType || bt instanceof RailBulletType
                || bt instanceof LightningBulletType;
            if (!isBeam) continue;
            if (seenBeamIds.add(bul.id)) {
                classifyBullet(bul, kOut, lsOut, cOut);
                if (pendingBeams.size() < 80) {
                    StringBuilder bsb = new StringBuilder(96);
                    bsb.append('[').append(bul.id)
                       .append(',').append(r2(bul.x / 8f))
                       .append(',').append(r2(bul.y / 8f))
                       .append(',').append(Math.round(bul.rotation()))
                       .append(',').append(r2(lsOut[0]))
                       .append(',').append(r2(lsOut[1]))
                       .append(",\"").append(cOut[0])
                       .append("\",").append(kOut[0])
                       .append(",\"").append(esc(bul.team != null ? bul.team.name : "none")).append("\"]");
                    pendingBeams.add(bsb.toString());
                }
            }
        }
        if (seenBeamIds.size() > 2048) seenBeamIds.clear();

        // Emit full dynamic + building-diff frame every 3rd tick (~20 Hz = 50ms)
        liveTickCounter++;
        int stride = Vars.state.isPaused() ? 15 : 3;
        if (liveTickCounter % stride != 0) return;

        if (needsBuildingScan || ++rescanCounter >= 200) {
            rescanTrackedBuildings();
        }

        // Prune removed buildings & catch any newly spawned buildings in Groups.build
        Iterator<java.util.Map.Entry<Integer, Building>> it = trackedBuildings.entrySet().iterator();
        while (it.hasNext()) {
            Building b = it.next().getValue();
            if (b == null || !b.isAdded() || b.tile == null || b.tile.build != b || b.block == null) {
                it.remove();
                if (b instanceof Conveyor.ConveyorBuild cb) trackedConveyors.remove(cb);
                powerLinksDirty = true;
            }
        }
        for (Building b : Groups.build) {
            if (b == null || b.tile == null || b.tile.build != b || b.block == null) continue;
            int pos = b.pos();
            if (!trackedBuildings.containsKey(pos)) {
                trackedBuildings.put(pos, b);
                if (b instanceof Conveyor.ConveyorBuild cb) trackedConveyors.add(cb);
                if (b.power != null) powerLinksDirty = true;
            }
        }

        // Diff buildings against prevBuildingSnaps
        float powerProd = 0f;
        float powerCons = 0f;
        StringBuilder bAdd = new StringBuilder();
        StringBuilder bUpd = new StringBuilder();
        StringBuilder bDel = new StringBuilder();
        boolean hasAdd = false, hasUpd = false, hasDel = false;

        for (java.util.Map.Entry<Integer, Building> entry : trackedBuildings.entrySet()) {
            int pos = entry.getKey();
            Building b = entry.getValue();
            int ammo = 0;
            int aimRot = b.rotation * 90;
            if (b instanceof Turret.TurretBuild tb) {
                ammo = tb.totalAmmo;
                aimRot = Math.round(tb.rotation);
            } else if (b instanceof BaseTurret.BaseTurretBuild bt) {
                aimRot = Math.round(bt.rotation);
            }
            int hp = Math.round(b.health);
            int maxHp = Math.round(b.maxHealth);
            if (b.team == Team.sharded && b.power != null && b.power.graph != null) {
                powerProd = Math.max(powerProd, b.power.graph.getPowerProduced() * 60f);
                powerCons = Math.max(powerCons, b.power.graph.getPowerNeeded() * 60f);
            }

            BuildingSnap prev = prevBuildingSnaps.get(pos);
            if (prev == null || !prev.block.equals(b.block.name) || prev.rot != b.rotation || !prev.team.equals(b.team.name)) {
                BuildingSnap sn = new BuildingSnap();
                sn.x = b.tileX();
                sn.y = b.tileY();
                sn.size = b.block.size;
                sn.rot = b.rotation;
                sn.aimRot = aimRot;
                sn.hp = hp;
                sn.maxHp = maxHp;
                sn.ammo = ammo;
                sn.block = b.block.name;
                sn.team = b.team.name;
                prevBuildingSnaps.put(pos, sn);
                if (hasAdd) bAdd.append(',');
                hasAdd = true;
                bAdd.append("{\"x\":").append(sn.x)
                    .append(",\"y\":").append(sn.y)
                    .append(",\"block\":\"").append(esc(sn.block))
                    .append("\",\"size\":").append(sn.size)
                    .append(",\"rot\":").append(sn.rot)
                    .append(",\"aimRot\":").append(sn.aimRot)
                    .append(",\"hp\":").append(sn.hp)
                    .append(",\"maxHp\":").append(sn.maxHp)
                    .append(",\"team\":\"").append(esc(sn.team))
                    .append("\",\"ammo\":").append(sn.ammo).append('}');
                powerLinksDirty = true;
            } else if (prev.aimRot != aimRot || prev.hp != hp || prev.ammo != ammo) {
                prev.aimRot = aimRot;
                prev.hp = hp;
                prev.ammo = ammo;
                if (hasUpd) bUpd.append(',');
                hasUpd = true;
                bUpd.append('[').append(prev.x).append(',').append(prev.y)
                    .append(',').append(aimRot).append(',').append(hp).append(',').append(ammo).append(']');
            }
        }

        Iterator<java.util.Map.Entry<Integer, BuildingSnap>> pit = prevBuildingSnaps.entrySet().iterator();
        while (pit.hasNext()) {
            java.util.Map.Entry<Integer, BuildingSnap> pe = pit.next();
            if (!trackedBuildings.containsKey(pe.getKey())) {
                BuildingSnap removed = pe.getValue();
                pit.remove();
                if (hasDel) bDel.append(',');
                hasDel = true;
                bDel.append('[').append(removed.x).append(',').append(removed.y).append(']');
                powerLinksDirty = true;
            }
        }

        String powerLinksJson = null;
        boolean emitLinks = powerLinksDirty;
        if (emitLinks) {
            powerLinksDirty = false;
            StringBuilder pl = new StringBuilder("[");
            boolean firstLink = true;
            HashSet<Long> seenLinks = new HashSet<>();
            for (Building b : trackedBuildings.values()) {
                if (b.team != Team.sharded || b.power == null || b.power.links == null || b.power.links.size == 0) continue;
                int ax = b.tileX(), ay = b.tileY();
                int aPos = Point2.pack(ax, ay);
                for (int li = 0; li < b.power.links.size; li++) {
                    int pos = b.power.links.get(li);
                    long lo = Math.min(aPos, pos) & 0xFFFFFFFFL;
                    long hi = Math.max(aPos, pos) & 0xFFFFFFFFL;
                    long edgeKey = (lo << 32) | hi;
                    if (seenLinks.add(edgeKey)) {
                        if (!firstLink) pl.append(',');
                        firstLink = false;
                        pl.append('[').append(ax).append(',').append(ay)
                          .append(',').append(Point2.x(pos)).append(',').append(Point2.y(pos)).append(']');
                    }
                }
            }
            pl.append(']');
            powerLinksJson = pl.toString();
        }

        // Dynamic body: scalar HUD fields + units + bullets + uncapped conveyor items
        StringBuilder dyn = new StringBuilder(8192);
        dyn.append("\"map\":\"").append(esc(mapName))
           .append("\",\"wave\":").append(Vars.state.wave)
           .append(",\"waveTime\":").append(Math.round(Vars.state.wavetime / 60f * 10f) / 10f)
           .append(",\"enemies\":").append(Vars.state.enemies)
           .append(",\"gameOver\":").append(Vars.state.gameOver)
           .append(",\"paused\":").append(Vars.state.isPaused())
           .append(",\"playing\":").append(Vars.state.isPlaying());

        CoreBlock.CoreBuild core = Team.sharded.core();
        if (core != null) {
            dyn.append(",\"core\":{\"x\":").append(core.tileX())
               .append(",\"y\":").append(core.tileY())
               .append(",\"hp\":").append(Math.round(core.health))
               .append(",\"maxHp\":").append(Math.round(core.maxHealth))
               .append(",\"block\":\"").append(esc(core.block.name)).append("\"}");
            dyn.append(",\"items\":{");
            boolean fi = true;
            for (Item item : Vars.content.items()) {
                int amt = core.items.get(item);
                if (amt > 0) {
                    if (!fi) dyn.append(',');
                    fi = false;
                    dyn.append('"').append(esc(item.name)).append("\":").append(amt);
                }
            }
            dyn.append("},\"flowRates\":{");
            boolean ff = true;
            for (Item item : Vars.content.items()) {
                float rate = core.items.getFlowRate(item);
                if (rate > 0.05f) {
                    if (!ff) dyn.append(',');
                    ff = false;
                    dyn.append('"').append(esc(item.name)).append("\":").append(Math.round(rate * 10f) / 10f);
                }
            }
            dyn.append('}');
        } else {
            dyn.append(",\"core\":null,\"items\":{},\"flowRates\":{}");
        }
        dyn.append(",\"power\":{\"produced\":").append(Math.round(powerProd))
           .append(",\"consumed\":").append(Math.round(powerCons)).append('}');

        // Units tuple: [id, type, team, x, y, vx, vy, rot, hp, maxHp, shield]
        dyn.append(",\"units\":[");
        boolean firstU = true;
        for (Unit u : Groups.unit) {
            if (u == null || u.dead()) continue;
            if (!firstU) dyn.append(',');
            firstU = false;
            dyn.append('[').append(u.id)
               .append(",\"").append(esc(u.type != null ? u.type.name : "unit"))
               .append("\",\"").append(esc(u.team.name))
               .append("\",").append(r2(u.x / 8f))
               .append(',').append(r2(u.y / 8f))
               .append(',').append(r2(u.vel.x * 7.5f))
               .append(',').append(r2(u.vel.y * 7.5f))
               .append(',').append(Math.round(u.rotation))
               .append(',').append(Math.round(u.health))
               .append(',').append(Math.round(u.maxHealth))
               .append(',').append(Math.round(u.shield)).append(']');
        }
        dyn.append(']');

        // Real bullets tuple: [id, x, y, vx, vy, rot, team, dmg, size, color, kind, len]
        dyn.append(",\"bullets\":[");
        boolean firstBul = true;
        int bCount = 0;
        for (Bullet bul : Groups.bullet) {
            if (bul == null || bCount >= 600) break;
            classifyBullet(bul, kOut, lsOut, cOut);
            if (!firstBul) dyn.append(',');
            firstBul = false;
            bCount++;
            dyn.append('[').append(bul.id)
               .append(',').append(r2(bul.x / 8f))
               .append(',').append(r2(bul.y / 8f))
               .append(',').append(r2(bul.vel.x * 7.5f))
               .append(',').append(r2(bul.vel.y * 7.5f))
               .append(',').append(Math.round(bul.rotation()))
               .append(",\"").append(esc(bul.team != null ? bul.team.name : "none"))
               .append("\",").append(Math.round(bul.damage))
               .append(',').append(r2(lsOut[1]))
               .append(",\"").append(cOut[0])
               .append("\",").append(kOut[0])
               .append(',').append(r2(lsOut[0])).append(']');
        }
        dyn.append(']');

        // Uncapped conveyor items (up to 2500) with lateral xs + longitudinal ys in a flat stride-4 array
        HashMap<String, Integer> iPalMap = new HashMap<>();
        ArrayList<String> iPal = new ArrayList<>();
        StringBuilder ci = new StringBuilder("[");
        boolean firstCi = true;
        int ciCount = 0;
        for (Conveyor.ConveyorBuild cb : trackedConveyors) {
            if (cb == null || !cb.isAdded() || cb.len <= 0 || cb.ids == null) continue;
            int rot = cb.rotation & 3;
            int dx = rot == 0 ? 1 : rot == 2 ? -1 : 0;
            int dy = rot == 1 ? 1 : rot == 3 ? -1 : 0;
            int px = -dy;
            int py = dx;
            for (int idx = 0; idx < cb.len && ciCount < 2500; idx++) {
                Item item = cb.ids[idx];
                if (item == null) continue;
                Integer pIdx = iPalMap.get(item.name);
                if (pIdx == null) {
                    pIdx = iPal.size();
                    iPal.add(item.name);
                    iPalMap.put(item.name, pIdx);
                }
                float prog = cb.ys[idx] - 0.5f;
                float lat = (cb.xs != null ? cb.xs[idx] : 0f) * 0.25f;
                float ix = cb.tileX() + 0.5f + dx * prog + px * lat;
                float iy = cb.tileY() + 0.5f + dy * prog + py * lat;
                if (!firstCi) ci.append(',');
                firstCi = false;
                ciCount++;
                ci.append(r2(ix)).append(',').append(r2(iy)).append(',').append(pIdx).append(',').append(rot);
            }
        }
        ci.append(']');
        dyn.append(",\"iPal\":[");
        for (int i = 0; i < iPal.size(); i++) {
            if (i > 0) dyn.append(',');
            dyn.append('"').append(esc(iPal.get(i))).append('"');
        }
        dyn.append("],\"ci\":").append(ci);

        // Player drone
        if (aiDrone != null && !aiDrone.dead() && aiDrone.isAdded()) {
            dyn.append(",\"playerDrone\":{\"id\":").append(aiDrone.id)
               .append(",\"type\":\"").append(esc(aiDrone.type != null ? aiDrone.type.name : "alpha"))
               .append("\",\"mode\":\"").append(esc(shipMode))
               .append("\",\"x\":").append(r2(aiDrone.x / 8f))
               .append(",\"y\":").append(r2(aiDrone.y / 8f))
               .append(",\"hp\":").append(Math.round(aiDrone.health))
               .append(",\"maxHp\":").append(Math.round(aiDrone.maxHealth))
               .append(",\"rot\":").append(Math.round(aiDrone.rotation));
            if (System.currentTimeMillis() <= buildBeamUntil && buildBeamX >= 0) {
                dyn.append(",\"buildTarget\":{\"x\":").append(buildBeamX)
                   .append(",\"y\":").append(buildBeamY)
                   .append(",\"block\":\"").append(esc(buildBeamBlock)).append("\"}");
            } else {
                dyn.append(",\"buildTarget\":null");
            }
            dyn.append('}');
        } else {
            dyn.append(",\"playerDrone\":null");
        }

        // Drain 60 Hz captured beams
        StringBuilder beamsSb = new StringBuilder();
        for (int bi = 0; bi < pendingBeams.size(); bi++) {
            if (bi > 0) beamsSb.append(',');
            beamsSb.append(pendingBeams.get(bi));
        }
        pendingBeams.clear();

        FrameEntry fe = new FrameEntry();
        fe.t = System.currentTimeMillis();
        fe.map = mapName;
        fe.bAddJson = bAdd.toString();
        fe.bDelJson = bDel.toString();
        fe.bUpdJson = bUpd.toString();
        fe.hasLinks = emitLinks;
        fe.powerLinksJson = powerLinksJson;
        fe.beamsJson = beamsSb.toString();
        fe.dynamicJson = dyn.toString();

        synchronized (frameLock) {
            latestFrameSeq++;
            fe.seq = latestFrameSeq;
            frameRing[(int) (latestFrameSeq % FRAME_RING_CAP)] = fe;
            if (frameRingCount < FRAME_RING_CAP) frameRingCount++;
        }
    }

    private void handleFrame(HttpExchange ex) throws IOException {
        try {
            HashMap<String, String> q = parseQuery(ex.getRequestURI().getRawQuery());
            long since = 0L;
            String sStr = q.get("since");
            if (sStr != null && !sStr.isEmpty()) {
                try { since = Long.parseLong(sStr); } catch (Exception ignored) {}
            }

            String json;
            synchronized (frameLock) {
                if (frameRingCount == 0 || latestFrameSeq == 0L) {
                    json = "{\"ready\":false}";
                } else if (since == latestFrameSeq) {
                    json = "{\"ready\":true,\"unchanged\":true,\"seq\":" + latestFrameSeq + "}";
                } else {
                    long oldestSeq = latestFrameSeq - frameRingCount + 1;
                    FrameEntry latest = frameRing[(int) (latestFrameSeq % FRAME_RING_CAP)];
                    if (since <= 0L || since < oldestSeq - 1 || latest == null) {
                        json = "{\"ready\":true,\"fullRequired\":true,\"seq\":" + latestFrameSeq + "}";
                    } else {
                        StringBuilder bAdd = new StringBuilder();
                        StringBuilder bDel = new StringBuilder();
                        StringBuilder bUpd = new StringBuilder();
                        StringBuilder beams = new StringBuilder();
                        String linksJson = null;
                        boolean mapChanged = false;
                        for (long s = since + 1; s <= latestFrameSeq; s++) {
                            FrameEntry fe = frameRing[(int) (s % FRAME_RING_CAP)];
                            if (fe == null || !fe.map.equals(latest.map)) {
                                mapChanged = true;
                                break;
                            }
                            if (!fe.bAddJson.isEmpty()) {
                                if (bAdd.length() > 0) bAdd.append(',');
                                bAdd.append(fe.bAddJson);
                            }
                            if (!fe.bDelJson.isEmpty()) {
                                if (bDel.length() > 0) bDel.append(',');
                                bDel.append(fe.bDelJson);
                            }
                            if (!fe.bUpdJson.isEmpty()) {
                                if (bUpd.length() > 0) bUpd.append(',');
                                bUpd.append(fe.bUpdJson);
                            }
                            if (!fe.beamsJson.isEmpty()) {
                                if (beams.length() > 0) beams.append(',');
                                beams.append(fe.beamsJson);
                            }
                            if (fe.hasLinks && fe.powerLinksJson != null) {
                                linksJson = fe.powerLinksJson;
                            }
                        }
                        if (mapChanged) {
                            json = "{\"ready\":true,\"fullRequired\":true,\"seq\":" + latestFrameSeq + "}";
                        } else {
                            StringBuilder sb = new StringBuilder(latest.dynamicJson.length() + bAdd.length() + bUpd.length() + 256);
                            sb.append("{\"ready\":true,\"seq\":").append(latest.seq)
                              .append(",\"t\":").append(latest.t)
                              .append(',').append(latest.dynamicJson)
                              .append(",\"bAdd\":[").append(bAdd).append(']')
                              .append(",\"bDel\":[").append(bDel).append(']')
                              .append(",\"bUpd\":[").append(bUpd).append(']')
                              .append(",\"beams\":[").append(beams).append(']');
                            if (linksJson != null) {
                                sb.append(",\"powerLinks\":").append(linksJson);
                            }
                            sb.append('}');
                            json = sb.toString();
                        }
                    }
                }
            }
            sendJson(ex, 200, json);
        } catch (Exception e) {
            sendJson(ex, 500, "{\"ready\":false,\"error\":\"" + esc(e.toString()) + "\"}");
        }
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
                            else if (bn.contains("conduit") || t.build instanceof Conduit.ConduitBuild) ch = '=';
                            else if (t.build instanceof Pump.PumpBuild || bn.contains("pump") || bn.contains("water-extractor") || bn.contains("oil-extractor") || bn.contains("liquid-") || t.build instanceof LiquidBlock.LiquidBuild) ch = 'L';
                            else if (bn.contains("conveyor")) ch = switch (t.build.rotation) {
                                case 0 -> '>';
                                case 1 -> '^';
                                case 2 -> '<';
                                default -> 'v';
                            };
                            else if (bn.contains("router") || bn.contains("junction") || bn.contains("distributor") || bn.contains("sorter") || bn.contains("gate")) ch = '+';
                            else if (bn.contains("power") || bn.contains("generator") || bn.contains("battery") || bn.contains("solar") || bn.contains("reactor")) ch = 'P';
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

    private void handleInspect(HttpExchange ex) throws IOException {
        try {
            HashMap<String, String> q = parseQuery(ex.getRequestURI().getRawQuery());
            int qx = parseIntParam(q, "x", -1);
            int qy = parseIntParam(q, "y", -1);
            String json = onMainThread(() -> {
                if (Vars.world == null || Vars.world.width() == 0) return "{\"ready\":false}";
                Tile t = Vars.world.tile(qx, qy);
                if (t == null) {
                    return "{\"ok\":false,\"error\":\"out of bounds (" + qx + "," + qy + ")\"}";
                }
                StringBuilder sb = new StringBuilder(1024);
                sb.append("{\"ok\":true,\"x\":").append(qx).append(",\"y\":").append(qy);
                sb.append(",\"floor\":\"").append(esc(t.floor() != null ? t.floor().name : "none")).append('"');
                if (t.floor() != null && t.floor().liquidDrop != null) {
                    sb.append(",\"floorLiquid\":\"").append(esc(t.floor().liquidDrop.name)).append('"');
                }
                if (t.overlay() != null && t.overlay().itemDrop != null) {
                    sb.append(",\"ore\":\"").append(esc(t.overlay().itemDrop.name)).append('"');
                }
                if (t.build == null && t.block() != null && t.block().solid) {
                    sb.append(",\"solidWall\":true,\"wallBlock\":\"").append(esc(t.block().name)).append('"');
                }

                Building b = t.build;
                if (b == null || b.block == null) {
                    sb.append(",\"building\":null}");
                    return sb.toString();
                }

                sb.append(",\"building\":{");
                sb.append("\"block\":\"").append(esc(b.block.name)).append('"');
                sb.append(",\"team\":\"").append(esc(b.team != null ? b.team.name : "none")).append('"');
                sb.append(",\"origin\":{\"x\":").append(b.tileX()).append(",\"y\":").append(b.tileY()).append('}');
                sb.append(",\"size\":").append(b.block.size);
                sb.append(",\"rot\":").append(b.rotation);
                sb.append(",\"hp\":").append(Math.round(b.health));
                sb.append(",\"maxHp\":").append(Math.round(b.maxHealth));
                sb.append(",\"enabled\":").append(b.enabled);
                sb.append(",\"efficiency\":").append(Math.round(b.efficiency * 100f) / 100f);
                sb.append(",\"configurable\":").append(b.block.configurable);

                if (b.items != null) {
                    sb.append(",\"itemCapacity\":").append(b.block.itemCapacity);
                    sb.append(",\"items\":{");
                    boolean firstIt = true;
                    for (Item item : Vars.content.items()) {
                        int amt = b.items.get(item);
                        if (amt > 0) {
                            if (!firstIt) sb.append(',');
                            firstIt = false;
                            sb.append('"').append(esc(item.name)).append("\":").append(amt);
                        }
                    }
                    sb.append('}');
                }

                if (b.liquids != null) {
                    sb.append(",\"liquidCapacity\":").append(Math.round(b.block.liquidCapacity * 10f) / 10f);
                    sb.append(",\"liquids\":{");
                    boolean firstLiq = true;
                    for (Liquid liq : Vars.content.liquids()) {
                        float amt = b.liquids.get(liq);
                        if (amt > 0.01f) {
                            if (!firstLiq) sb.append(',');
                            firstLiq = false;
                            sb.append('"').append(esc(liq.name)).append("\":").append(Math.round(amt * 10f) / 10f);
                        }
                    }
                    sb.append('}');
                }

                if (b.power != null) {
                    sb.append(",\"power\":{");
                    if (b.power.graph != null) {
                        sb.append("\"satisfaction\":").append(Math.round(b.power.graph.getSatisfaction() * 100f) / 100f)
                          .append(",\"produced\":").append(Math.round(b.power.graph.getPowerProduced() * 60f))
                          .append(",\"consumed\":").append(Math.round(b.power.graph.getPowerNeeded() * 60f))
                          .append(",\"batteryStored\":").append(Math.round(b.power.graph.getBatteryStored()))
                          .append(",\"batteryCapacity\":").append(Math.round(b.power.graph.getTotalBatteryCapacity()));
                    } else {
                        sb.append("\"satisfaction\":0");
                    }
                    if (b.power.links != null && b.power.links.size > 0) {
                        sb.append(",\"links\":[");
                        for (int li = 0; li < b.power.links.size; li++) {
                            if (li > 0) sb.append(',');
                            int pos = b.power.links.get(li);
                            sb.append('[').append(Point2.x(pos)).append(',').append(Point2.y(pos)).append(']');
                        }
                        sb.append(']');
                    }
                    sb.append('}');
                }

                if (b instanceof Turret.TurretBuild tb) {
                    sb.append(",\"ammo\":").append(tb.totalAmmo);
                }

                if (b instanceof UnitFactory.UnitFactoryBuild uf && b.block instanceof UnitFactory ufb) {
                    sb.append(",\"availableUnits\":[");
                    for (int pi = 0; pi < ufb.plans.size; pi++) {
                        if (pi > 0) sb.append(',');
                        sb.append('"').append(esc(ufb.plans.get(pi).unit.name)).append('"');
                    }
                    sb.append(']');
                    if (uf.commandPos != null) {
                        sb.append(",\"rally\":{\"x\":").append(Math.round(uf.commandPos.x / 8f))
                          .append(",\"y\":").append(Math.round(uf.commandPos.y / 8f)).append('}');
                    }
                    if (uf.command != null) {
                        sb.append(",\"command\":\"").append(esc(uf.command.name)).append('"');
                    }
                } else if (b instanceof Reconstructor.ReconstructorBuild rb) {
                    if (rb.commandPos != null) {
                        sb.append(",\"rally\":{\"x\":").append(Math.round(rb.commandPos.x / 8f))
                          .append(",\"y\":").append(Math.round(rb.commandPos.y / 8f)).append('}');
                    }
                    if (rb.command != null) {
                        sb.append(",\"command\":\"").append(esc(rb.command.name)).append('"');
                    }
                } else if (b instanceof LogicBlock.LogicBuild lb) {
                    sb.append(",\"logicRange\":").append(Math.round(((LogicBlock) b.block).range / 8f));
                    sb.append(",\"links\":").append(formatLogicLinks(lb.links));
                    String code = lb.code != null ? lb.code : "";
                    if (code.length() > 4000) code = code.substring(0, 4000);
                    sb.append(",\"code\":\"").append(esc(code)).append('"');
                }

                // Current block configuration
                sb.append(",\"config\":");
                if (b instanceof ItemBridge.ItemBridgeBuild ib) {
                    if (ib.link == -1) sb.append("null");
                    else sb.append("{\"target\":{\"x\":").append(Point2.x(ib.link)).append(",\"y\":").append(Point2.y(ib.link)).append("}}");
                } else if (b instanceof MassDriver.MassDriverBuild md) {
                    if (md.link == -1) sb.append("null");
                    else sb.append("{\"target\":{\"x\":").append(Point2.x(md.link)).append(",\"y\":").append(Point2.y(md.link)).append("}}");
                } else if (b instanceof LogicBlock.LogicBuild lb) {
                    int codeLen = lb.code != null ? lb.code.length() : 0;
                    int linkCount = lb.links != null ? lb.links.size : 0;
                    sb.append("{\"codeChars\":").append(codeLen).append(",\"links\":").append(linkCount).append('}');
                } else if (b instanceof MessageBlock.MessageBuild mb) {
                    sb.append("{\"text\":\"").append(esc(mb.message != null ? mb.message.toString() : "")).append("\"}");
                } else if (b instanceof SwitchBlock.SwitchBuild sw) {
                    sb.append("{\"enabled\":").append(sw.enabled).append('}');
                } else if (b instanceof UnitFactory.UnitFactoryBuild uf && b.block instanceof UnitFactory ufb) {
                    if (uf.currentPlan >= 0 && uf.currentPlan < ufb.plans.size) {
                        sb.append("{\"unit\":\"").append(esc(ufb.plans.get(uf.currentPlan).unit.name)).append("\"}");
                    } else {
                        sb.append("null");
                    }
                } else {
                    Object cfg = b.config();
                    if (cfg == null) {
                        sb.append("null");
                    } else if (cfg instanceof Item it) {
                        sb.append("{\"item\":\"").append(esc(it.name)).append("\"}");
                    } else if (cfg instanceof Liquid liq) {
                        sb.append("{\"liquid\":\"").append(esc(liq.name)).append("\"}");
                    } else if (cfg instanceof UnitType ut) {
                        sb.append("{\"unit\":\"").append(esc(ut.name)).append("\"}");
                    } else if (cfg instanceof Point2 p) {
                        sb.append("{\"target\":{\"x\":").append(b.tileX() + p.x).append(",\"y\":").append(b.tileY() + p.y).append("}}");
                    } else if (cfg instanceof Point2[] pts) {
                        sb.append("{\"links\":[");
                        for (int pi = 0; pi < pts.length; pi++) {
                            if (pi > 0) sb.append(',');
                            sb.append('[').append(b.tileX() + pts[pi].x).append(',').append(b.tileY() + pts[pi].y).append(']');
                        }
                        sb.append("]}");
                    } else {
                        sb.append('"').append(esc(cfg.toString())).append('"');
                    }
                }

                sb.append("}}");
                return sb.toString();
            });
            sendJson(ex, 200, json);
        } catch (Exception e) {
            sendJson(ex, 500, "{\"ok\":false,\"error\":\"" + esc(e.toString()) + "\"}");
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
                    if (b.configurable) {
                        sb.append(",\"configurable\":true");
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
                            else if (bn.contains("conduit") || t.build instanceof Conduit.ConduitBuild) ch = '=';
                            else if (t.build instanceof Pump.PumpBuild || bn.contains("pump") || bn.contains("water-extractor") || bn.contains("oil-extractor") || bn.contains("liquid-") || t.build instanceof LiquidBlock.LiquidBuild) ch = 'L';
                            else if (bn.contains("conveyor")) ch = switch (t.build.rotation) {
                                case 0 -> '>';
                                case 1 -> '^';
                                case 2 -> '<';
                                default -> 'v';
                            };
                            else if (bn.contains("router") || bn.contains("junction") || bn.contains("distributor") || bn.contains("sorter") || bn.contains("gate")) ch = '+';
                            else if (bn.contains("power") || bn.contains("generator") || bn.contains("battery") || bn.contains("solar") || bn.contains("reactor")) ch = 'P';
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
                long curSeq;
                synchronized (frameLock) { curSeq = latestFrameSeq; }
                StringBuilder sb = new StringBuilder(16384);
                sb.append("{\"ready\":true,\"seq\":").append(curSeq)
                  .append(",\"t\":").append(System.currentTimeMillis())
                  .append(",\"map\":\"").append(esc(mapName))
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
                    if (convCount < 2500 && b instanceof Conveyor.ConveyorBuild cb && cb.len > 0 && cb.ids != null) {
                        int rot = cb.rotation & 3;
                        int dx = rot == 0 ? 1 : rot == 2 ? -1 : 0;
                        int dy = rot == 1 ? 1 : rot == 3 ? -1 : 0;
                        int px = -dy;
                        int py = dx;
                        for (int ci = 0; ci < cb.len && convCount < 2500; ci++) {
                            Item it = cb.ids[ci];
                            if (it == null) continue;
                            float prog = cb.ys[ci] - 0.5f;
                            float lat = (cb.xs != null ? cb.xs[ci] : 0f) * 0.25f;
                            float ix = cb.tileX() + 0.5f + dx * prog + px * lat;
                            float iy = cb.tileY() + 0.5f + dy * prog + py * lat;
                            if (!firstConv) convItems.append(',');
                            firstConv = false;
                            convCount++;
                            convItems.append('[').append(r2(ix)).append(',')
                                     .append(r2(iy)).append(",\"")
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
                      .append("\",\"x\":").append(r2(u.x / 8f))
                      .append(",\"y\":").append(r2(u.y / 8f))
                      .append(",\"vx\":").append(r2(u.vel.x * 7.5f))
                      .append(",\"vy\":").append(r2(u.vel.y * 7.5f))
                      .append(",\"hp\":").append(Math.round(u.health))
                      .append(",\"maxHp\":").append(Math.round(u.maxHealth))
                      .append(",\"shield\":").append(Math.round(u.shield))
                      .append(",\"rot\":").append(Math.round(u.rotation)).append('}');
                }
                sb.append(']');

                // Bullets (up to 600, full real velocity + visual metadata)
                sb.append(",\"bullets\":[");
                boolean firstBul = true;
                int bCount = 0;
                int[] kOut = new int[1];
                float[] lsOut = new float[2];
                String[] cOut = new String[1];
                for (Bullet bul : Groups.bullet) {
                    if (bul == null || bCount >= 600) break;
                    classifyBullet(bul, kOut, lsOut, cOut);
                    if (!firstBul) sb.append(',');
                    firstBul = false;
                    bCount++;
                    sb.append("{\"id\":").append(bul.id)
                      .append(",\"x\":").append(r2(bul.x / 8f))
                      .append(",\"y\":").append(r2(bul.y / 8f))
                      .append(",\"vx\":").append(r2(bul.vel.x * 7.5f))
                      .append(",\"vy\":").append(r2(bul.vel.y * 7.5f))
                      .append(",\"rot\":").append(Math.round(bul.rotation()))
                      .append(",\"team\":\"").append(esc(bul.team != null ? bul.team.name : "none"))
                      .append("\",\"dmg\":").append(Math.round(bul.damage))
                      .append(",\"size\":").append(r2(lsOut[1]))
                      .append(",\"color\":\"").append(cOut[0])
                      .append("\",\"kind\":").append(kOut[0])
                      .append(",\"len\":").append(r2(lsOut[0])).append('}');
                }
                sb.append(']');

                // Player builder drone (real Sharded alpha/beta/gamma unit flying to build sites)
                if (aiDrone != null && !aiDrone.dead() && aiDrone.isAdded()) {
                    sb.append(",\"playerDrone\":{\"id\":").append(aiDrone.id)
                      .append(",\"type\":\"").append(esc(aiDrone.type != null ? aiDrone.type.name : "alpha"))
                      .append("\",\"mode\":\"").append(esc(shipMode))
                      .append("\",\"x\":").append(r2(aiDrone.x / 8f))
                      .append(",\"y\":").append(r2(aiDrone.y / 8f))
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
            trackedBuildings.put(tile.build.pos(), tile.build);
            if (tile.build instanceof Conveyor.ConveyorBuild cb) trackedConveyors.add(cb);
            if (tile.build.power != null) powerLinksDirty = true;
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
                    case "configure" -> {
                        int x = req.getInt("x", -1);
                        int y = req.getInt("y", -1);
                        Tile t = Vars.world.tile(x, y);
                        if (t == null || t.build == null || t.build.team != Team.sharded) {
                            return "{\"ok\":false,\"error\":\"no friendly building at (" + x + "," + y + ")\"}";
                        }
                        Building b = t.build;
                        if (!b.block.configurable && !(b instanceof Reconstructor.ReconstructorBuild) && !(b instanceof UnitFactory.UnitFactoryBuild)) {
                            return "{\"ok\":false,\"error\":\"" + esc(b.block.name) + " is not configurable\"}";
                        }
                        boolean clear = req.getBoolean("clear", false);
                        if (clear) {
                            if (b instanceof ItemBridge.ItemBridgeBuild || b instanceof MassDriver.MassDriverBuild) {
                                b.configureAny(-1);
                            } else if (b instanceof PowerNode.PowerNodeBuild) {
                                b.configureAny(new Point2[0]);
                            } else if (b instanceof LogicBlock.LogicBuild) {
                                b.configureAny(LogicBlock.compress("", new Seq<>()));
                            } else if (b instanceof UnitFactory.UnitFactoryBuild uf) {
                                uf.commandPos = null;
                                b.configureAny(null);
                            } else if (b instanceof Reconstructor.ReconstructorBuild rb) {
                                rb.commandPos = null;
                            } else {
                                b.configureAny(null);
                            }
                            return "{\"ok\":true,\"block\":\"" + esc(b.block.name) + "\",\"cleared\":true}";
                        }

                        String itemName = req.has("item") && !req.get("item").isNull() ? req.getString("item", "").trim().toLowerCase() : "";
                        String liquidName = req.has("liquid") && !req.get("liquid").isNull() ? req.getString("liquid", "").trim().toLowerCase() : "";
                        String unitName = req.has("unit") && !req.get("unit").isNull() ? req.getString("unit", "").trim().toLowerCase() : "";
                        boolean hasCode = req.has("code") && !req.get("code").isNull();
                        boolean hasText = req.has("text") && !req.get("text").isNull();
                        boolean hasEnabled = req.has("enabled") && !req.get("enabled").isNull();
                        String cmdName = req.has("command") && !req.get("command").isNull() ? req.getString("command", "").trim().toLowerCase() : "";
                        boolean hasTarget = req.has("targetX") && req.has("targetY") && !req.get("targetX").isNull() && !req.get("targetY").isNull();

                        if (hasCode) {
                            if (!(b instanceof LogicBlock.LogicBuild lb)) {
                                return "{\"ok\":false,\"error\":\"" + esc(b.block.name) + " is not a logic processor\"}";
                            }
                            String code = req.getString("code", "");
                            if (code.length() > 8000) {
                                return "{\"ok\":false,\"error\":\"MLOG code exceeds 8000 char limit\"}";
                            }
                            b.configureAny(LogicBlock.compress(code, lb.links));
                            int lines = code.isEmpty() ? 0 : code.split("\\r?\\n").length;
                            return "{\"ok\":true,\"block\":\"" + esc(b.block.name) + "\",\"codeLines\":" + lines + ",\"links\":" + formatLogicLinks(lb.links) + "}";
                        }

                        if (hasText) {
                            if (!(b instanceof MessageBlock.MessageBuild)) {
                                return "{\"ok\":false,\"error\":\"" + esc(b.block.name) + " is not a message block\"}";
                            }
                            String text = req.getString("text", "");
                            if (text.length() > 220) text = text.substring(0, 220);
                            b.configureAny(text);
                            return "{\"ok\":true,\"block\":\"" + esc(b.block.name) + "\",\"text\":\"" + esc(text) + "\"}";
                        }

                        if (hasEnabled) {
                            if (!(b instanceof SwitchBlock.SwitchBuild)) {
                                return "{\"ok\":false,\"error\":\"" + esc(b.block.name) + " is not a switch block\"}";
                            }
                            boolean en = req.getBoolean("enabled", false);
                            b.configureAny(en);
                            return "{\"ok\":true,\"block\":\"" + esc(b.block.name) + "\",\"enabled\":" + en + "}";
                        }

                        if (!cmdName.isEmpty()) {
                            UnitCommand uc = Vars.content.unitCommand(cmdName);
                            if (uc == null) {
                                return "{\"ok\":false,\"error\":\"unknown unit command: " + esc(cmdName) + " (try move, repair, rebuild, assist, mine)\"}";
                            }
                            if (!b.block.configurations.containsKey(UnitCommand.class)) {
                                return "{\"ok\":false,\"error\":\"" + esc(b.block.name) + " does not accept a unit command\"}";
                            }
                            b.configureAny(uc);
                            return "{\"ok\":true,\"block\":\"" + esc(b.block.name) + "\",\"command\":\"" + esc(uc.name) + "\"}";
                        }

                        if (!itemName.isEmpty()) {
                            Item it = Vars.content.item(itemName);
                            if (it == null) return "{\"ok\":false,\"error\":\"unknown item: " + esc(itemName) + "\"}";
                            if (!b.block.configurations.containsKey(Item.class)) {
                                return "{\"ok\":false,\"error\":\"" + esc(b.block.name) + " does not accept an item configuration\"}";
                            }
                            b.configureAny(it);
                            return "{\"ok\":true,\"block\":\"" + esc(b.block.name) + "\",\"item\":\"" + esc(it.name) + "\"}";
                        }

                        if (!liquidName.isEmpty()) {
                            Liquid liq = Vars.content.liquid(liquidName);
                            if (liq == null) return "{\"ok\":false,\"error\":\"unknown liquid: " + esc(liquidName) + "\"}";
                            if (!b.block.configurations.containsKey(Liquid.class)) {
                                return "{\"ok\":false,\"error\":\"" + esc(b.block.name) + " does not accept a liquid configuration\"}";
                            }
                            b.configureAny(liq);
                            return "{\"ok\":true,\"block\":\"" + esc(b.block.name) + "\",\"liquid\":\"" + esc(liq.name) + "\"}";
                        }

                        if (!unitName.isEmpty()) {
                            UnitType ut = Vars.content.unit(unitName);
                            if (ut == null) return "{\"ok\":false,\"error\":\"unknown unit: " + esc(unitName) + "\"}";
                            if (b instanceof UnitFactory.UnitFactoryBuild && b.block instanceof UnitFactory uf) {
                                boolean found = false;
                                StringBuilder avail = new StringBuilder();
                                for (int pi = 0; pi < uf.plans.size; pi++) {
                                    UnitType pu = uf.plans.get(pi).unit;
                                    if (pi > 0) avail.append(", ");
                                    avail.append(pu.name);
                                    if (pu == ut) found = true;
                                }
                                if (!found) {
                                    return "{\"ok\":false,\"error\":\"" + esc(b.block.name) + " cannot build " + esc(ut.name) + " (available: " + esc(avail.toString()) + ")\"}";
                                }
                                b.configureAny(ut);
                                return "{\"ok\":true,\"block\":\"" + esc(b.block.name) + "\",\"unit\":\"" + esc(ut.name) + "\"}";
                            }
                            if (!b.block.configurations.containsKey(UnitType.class)) {
                                return "{\"ok\":false,\"error\":\"" + esc(b.block.name) + " does not accept a unit configuration\"}";
                            }
                            b.configureAny(ut);
                            return "{\"ok\":true,\"block\":\"" + esc(b.block.name) + "\",\"unit\":\"" + esc(ut.name) + "\"}";
                        }

                        if (hasTarget) {
                            int tx = req.getInt("targetX", -1);
                            int ty = req.getInt("targetY", -1);
                            Tile targetTile = Vars.world.tile(tx, ty);
                            if (targetTile == null) return "{\"ok\":false,\"error\":\"target out of bounds\"}";
                            if (b instanceof ItemBridge.ItemBridgeBuild && b.block instanceof ItemBridge ib) {
                                Tile originTarget = targetTile.build != null ? targetTile.build.tile : targetTile;
                                if (!ib.linkValid(b.tile, originTarget)) {
                                    return "{\"ok\":false,\"error\":\"cannot link " + esc(b.block.name) + " at (" + b.tileX() + "," + b.tileY() + ") to (" + tx + "," + ty + "): target must be a matching bridge within range " + ib.range + " tiles\"}";
                                }
                                b.configureAny(originTarget.pos());
                                return "{\"ok\":true,\"block\":\"" + esc(b.block.name) + "\",\"target\":{\"x\":" + originTarget.x + ",\"y\":" + originTarget.y + "}}";
                            }
                            if (b instanceof MassDriver.MassDriverBuild && b.block instanceof MassDriver md) {
                                if (targetTile.build == null || !(targetTile.build instanceof MassDriver.MassDriverBuild) || targetTile.build.team != Team.sharded) {
                                    return "{\"ok\":false,\"error\":\"target must be a friendly mass-driver\"}";
                                }
                                if (Mathf.dst(b.x, b.y, targetTile.build.x, targetTile.build.y) > md.range) {
                                    return "{\"ok\":false,\"error\":\"target mass-driver out of range (" + Math.round(md.range / 8f) + " tiles)\"}";
                                }
                                b.configureAny(targetTile.build.tile.pos());
                                return "{\"ok\":true,\"block\":\"" + esc(b.block.name) + "\",\"target\":{\"x\":" + targetTile.build.tileX() + ",\"y\":" + targetTile.build.tileY() + "}}";
                            }
                            if (b instanceof PowerNode.PowerNodeBuild && b.block instanceof PowerNode pn) {
                                if (targetTile.build == null || targetTile.build.power == null || targetTile.build.team != Team.sharded) {
                                    return "{\"ok\":false,\"error\":\"target must be a friendly powered building\"}";
                                }
                                Building tb = targetTile.build;
                                boolean alreadyLinked = b.power != null && b.power.links != null && b.power.links.contains(tb.pos());
                                if (!alreadyLinked && (!pn.linkValid(b, tb) || (b.power != null && b.power.links != null && b.power.links.size >= pn.maxNodes))) {
                                    return "{\"ok\":false,\"error\":\"cannot link " + esc(b.block.name) + " to (" + tb.tileX() + "," + tb.tileY() + "): out of range (" + Math.round(pn.laserRange) + " tiles) or maxNodes (" + pn.maxNodes + ") reached\"}";
                                }
                                b.configureAny(tb.pos());
                                powerLinksDirty = true;
                                return "{\"ok\":true,\"block\":\"" + esc(b.block.name) + "\",\"linked\":" + (!alreadyLinked) + ",\"target\":{\"x\":" + tb.tileX() + ",\"y\":" + tb.tileY() + "}}";
                            }
                            if (b instanceof LogicBlock.LogicBuild lb) {
                                if (targetTile.build == null || !lb.validLink(targetTile.build)) {
                                    int rng = Math.round(((LogicBlock) b.block).range / 8f);
                                    return "{\"ok\":false,\"error\":\"cannot link " + esc(b.block.name) + " to (" + tx + "," + ty + "): target must be a friendly building within range " + rng + " tiles\"}";
                                }
                                b.configureAny(targetTile.build.pos());
                                return "{\"ok\":true,\"block\":\"" + esc(b.block.name) + "\",\"links\":" + formatLogicLinks(lb.links) + "}";
                            }
                            if (b instanceof UnitFactory.UnitFactoryBuild || b instanceof Reconstructor.ReconstructorBuild) {
                                b.onCommand(new Vec2(tx * 8f, ty * 8f));
                                return "{\"ok\":true,\"block\":\"" + esc(b.block.name) + "\",\"rally\":{\"x\":" + tx + ",\"y\":" + ty + "}}";
                            }
                            if (b.block.configurations.containsKey(Point2.class)) {
                                b.configureAny(new Point2(tx - b.tileX(), ty - b.tileY()));
                                return "{\"ok\":true,\"block\":\"" + esc(b.block.name) + "\",\"target\":{\"x\":" + tx + ",\"y\":" + ty + "}}";
                            }
                            return "{\"ok\":false,\"error\":\"" + esc(b.block.name) + " does not accept a target tile link\"}";
                        }

                        return "{\"ok\":false,\"error\":\"provide one of: item, liquid, unit, code, text, enabled, command, target_x+target_y, or clear=true\"}";
                    }
                    case "command_units" -> {
                        String unitType = req.has("unitType") && !req.get("unitType").isNull() ? req.getString("unitType", "").trim().toLowerCase() : "all";
                        if (unitType.isEmpty()) unitType = "all";
                        String cmdName = req.has("command") && !req.get("command").isNull() ? req.getString("command", "").trim().toLowerCase() : "";
                        boolean hasPos = req.has("x") && req.has("y") && !req.get("x").isNull() && !req.get("y").isNull();
                        boolean attack = req.getBoolean("attack", false);

                        if (cmdName.isEmpty() && !hasPos) {
                            return "{\"ok\":false,\"error\":\"provide x+y target coordinates and/or command (move, repair, rebuild, assist, mine)\"}";
                        }

                        UnitCommand uc = null;
                        if (!cmdName.isEmpty()) {
                            uc = Vars.content.unitCommand(cmdName);
                            if (uc == null) {
                                return "{\"ok\":false,\"error\":\"unknown unit command: " + esc(cmdName) + " (try move, repair, rebuild, assist, mine)\"}";
                            }
                        }

                        int tx = hasPos ? req.getInt("x", -1) : -1;
                        int ty = hasPos ? req.getInt("y", -1) : -1;
                        if (hasPos && (tx < 0 || ty < 0 || tx >= Vars.world.width() || ty >= Vars.world.height())) {
                            return "{\"ok\":false,\"error\":\"target coordinates out of bounds\"}";
                        }
                        float wx = tx * 8f;
                        float wy = ty * 8f;

                        // Optional focus-fire target near (tx, ty) when attack=true
                        Teamc attackTarget = null;
                        if (hasPos && attack) {
                            float bestD2 = 40f * 40f;
                            for (Unit eu : Groups.unit) {
                                if (eu == null || eu.dead() || eu.team == Team.sharded) continue;
                                float d2 = Mathf.dst2(wx, wy, eu.x, eu.y);
                                if (d2 < bestD2) {
                                    bestD2 = d2;
                                    attackTarget = eu;
                                }
                            }
                            if (attackTarget == null) {
                                Tile tt = Vars.world.tile(tx, ty);
                                if (tt != null && tt.build != null && tt.build.team != Team.sharded) {
                                    attackTarget = tt.build;
                                }
                            }
                        }

                        int commanded = 0;
                        HashMap<String, Integer> availFriendly = new HashMap<>();
                        for (Unit u : Groups.unit) {
                            if (u == null || u.dead() || u.team != Team.sharded) continue;
                            if (aiDrone != null && u.id == aiDrone.id) continue;
                            String un = u.type != null ? u.type.name : "unit";
                            if (u.isCommandable()) {
                                availFriendly.put(un, availFriendly.getOrDefault(un, 0) + 1);
                            }
                            if (!u.isCommandable()) continue;
                            if (!"all".equals(unitType) && !un.equalsIgnoreCase(unitType)) continue;
                            CommandAI cai = u.command();
                            if (cai == null) continue;
                            if (uc != null && u.type != null && u.type.allowCommand(u, uc)) {
                                cai.command(uc);
                            }
                            if (hasPos) {
                                if (attackTarget != null) {
                                    cai.commandTarget(attackTarget);
                                } else {
                                    cai.commandPosition(new Vec2(wx, wy));
                                }
                            }
                            commanded++;
                        }

                        if (commanded == 0) {
                            StringBuilder sb = new StringBuilder("{\"ok\":false,\"commanded\":0,\"error\":\"no matching friendly commandable units\",\"friendlyUnits\":{");
                            boolean first = true;
                            for (var e : availFriendly.entrySet()) {
                                if (!first) sb.append(',');
                                first = false;
                                sb.append('"').append(esc(e.getKey())).append("\":").append(e.getValue());
                            }
                            sb.append("}}");
                            return sb.toString();
                        }

                        StringBuilder sb = new StringBuilder("{\"ok\":true,\"commanded\":").append(commanded)
                            .append(",\"unitType\":\"").append(esc(unitType)).append('"');
                        if (uc != null) sb.append(",\"command\":\"").append(esc(uc.name)).append('"');
                        if (hasPos) sb.append(",\"target\":{\"x\":").append(tx).append(",\"y\":").append(ty).append('}');
                        if (attackTarget != null) sb.append(",\"focusTarget\":true");
                        sb.append('}');
                        return sb.toString();
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
                    case "ship" -> {
                        String mode = req.getString("mode", "idle").trim().toLowerCase();
                        if (!mode.equals("idle") && !mode.equals("move") && !mode.equals("defend") && !mode.equals("mine")) {
                            return "{\"ok\":false,\"error\":\"invalid ship mode (use idle, move, defend, or mine)\"}";
                        }
                        if (mode.equals("move")) {
                            int x = req.getInt("x", -1);
                            int y = req.getInt("y", -1);
                            if (x < 0 || y < 0 || x >= Vars.world.width() || y >= Vars.world.height()) {
                                return "{\"ok\":false,\"error\":\"move requires valid x and y\"}";
                            }
                            shipGoalX = x * 8f;
                            shipGoalY = y * 8f;
                        } else if (mode.equals("defend")) {
                            int x = req.getInt("x", -1);
                            int y = req.getInt("y", -1);
                            if (x >= 0 && y >= 0 && x < Vars.world.width() && y < Vars.world.height()) {
                                shipGoalX = x * 8f;
                                shipGoalY = y * 8f;
                            } else {
                                shipGoalX = -1f;
                                shipGoalY = -1f;
                            }
                        } else if (mode.equals("mine")) {
                            String ore = req.getString("ore", "copper").trim().toLowerCase();
                            Item item = Vars.content.item(ore);
                            if (item == null) {
                                return "{\"ok\":false,\"error\":\"unknown ore: " + esc(ore) + "\"}";
                            }
                            shipMineOre = ore;
                        } else {
                            shipGoalX = -1f;
                            shipGoalY = -1f;
                            shipMineOre = "";
                        }
                        shipMode = mode;
                        applyShipController();
                        return "{\"ok\":true,\"mode\":\"" + esc(shipMode) + "\"}";
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
                        powerLinksDirty = true;
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
