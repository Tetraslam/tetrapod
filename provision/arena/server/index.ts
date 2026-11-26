import { Database } from "bun:sqlite";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ServerWebSocket } from "bun";
import { factorioRcon } from "./rcon";

const PORT = Number(process.env.ARENA_PORT || "6570");
const MINDUSTRY_URL = (process.env.MINDUSTRY_URL || "http://127.0.0.1:6568").replace(/\/+$/, "");
const OPENCODE_URL = (process.env.OPENCODE_URL || "http://127.0.0.1:4096").replace(/\/+$/, "");
const DATA_DIR = process.env.ARENA_DATA_DIR || "/opt/tetrapod/arena";
const WEB_DIR = process.env.ARENA_WEB_DIR || join(import.meta.dir, "../web");
const TURN_INTERVAL_MS = Number(process.env.ARENA_TURN_MS || "14000");

const ROSTER = [
  { id: "claude-agent/sonnet", label: "Claude Sonnet", color: "#f59e0b" },
  { id: "claude-agent/opus[1m]", label: "Claude Opus 1M", color: "#fb7185" },
  { id: "openrouter/google/gemini-4-neon", label: "Gemini 4 Neon", color: "#38bdf8" },
  { id: "claude-agent/haiku", label: "Claude Haiku", color: "#34d399" },
];

const MAP_ROTATION = [
  "Ancient Caldera",
  "Fortress",
  "Labyrinth",
  "Glacier",
  "Maze",
  "Triad",
  "Islands",
  "Mud Flats",
];

await mkdir(DATA_DIR, { recursive: true });
const db = new Database(join(DATA_DIR, "arena.db"), { create: true });
db.exec(`
  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game TEXT NOT NULL DEFAULT 'mindustry',
    model TEXT NOT NULL,
    model_label TEXT NOT NULL,
    map TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    peak_wave INTEGER NOT NULL DEFAULT 1,
    blocks_built INTEGER NOT NULL DEFAULT 0,
    actions_ok INTEGER NOT NULL DEFAULT 0,
    actions_fail INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'playing',
    last_thought TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS feed_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER,
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL,
    model TEXT,
    text TEXT NOT NULL,
    actions_json TEXT
  );
`);

type TerrainPayload = {
  ready: boolean;
  map: string;
  width: number;
  height: number;
  spawns: Array<{ x: number; y: number }>;
  core: { x: number; y: number } | null;
  palette: string[];
  rle: number[];
  ores: Array<[number, number, string]>;
};

type StatePayload = {
  ready: boolean;
  map: string;
  width: number;
  height: number;
  wave: number;
  waveTime: number;
  enemies: number;
  gameOver: boolean;
  playing: boolean;
  core: { x: number; y: number; hp: number; maxHp: number; block: string } | null;
  items: Record<string, number>;
  spawns: Array<{ x: number; y: number }>;
  buildings: Array<{
    x: number;
    y: number;
    block: string;
    size: number;
    rot: number;
    hp: number;
    maxHp: number;
    team: string;
    ammo: number;
  }>;
  power: { produced: number; consumed: number };
  units: Array<{
    id: number;
    type: string;
    team: string;
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    rot: number;
  }>;
  bullets: Array<{ x: number; y: number; team: string; dmg: number }>;
};

type FeedItem = {
  id: number;
  ts: number;
  kind: "thought" | "system" | "milestone" | "error";
  model?: string;
  text: string;
  actions?: Array<{ label: string; ok: boolean; error?: string }>;
};

type FactorioTelemetry = {
  online: boolean;
  tick: number;
  playtimeSec: number;
  playersOnline: number;
  evolution: number;
  surface: string;
  entitiesNearSpawn: number;
  daytime: number;
  updatedAt: number;
  error?: string;
};

let cachedTerrain: TerrainPayload | null = null;
let latestState: StatePayload | null = null;
let factorioState: FactorioTelemetry = {
  online: false,
  tick: 0,
  playtimeSec: 0,
  playersOnline: 0,
  evolution: 0,
  surface: "nauvis",
  entitiesNearSpawn: 0,
  daytime: 0,
  updatedAt: 0,
};

let rosterIdx = 0;
let mapIdx = 0;
let activeContender = ROSTER[0];
let activeMatchId: number | null = null;
let aiPaused = false;
let aiBusy = false;
let lastTurnAt = 0;
let lastGameOverAt = 0;
let matchBlocksBuilt = 0;
let matchActionsOk = 0;
let matchActionsFail = 0;
let matchPeakWave = 1;
let recentActionFeedback: string[] = [];
let recentFeed: FeedItem[] = [];
const wsClients = new Set<ServerWebSocket<unknown>>();

function pushFeed(
  kind: FeedItem["kind"],
  text: string,
  actions?: FeedItem["actions"],
  model?: string
): void {
  const ts = Date.now();
  const stmt = db.prepare(
    "INSERT INTO feed_events (match_id, ts, kind, model, text, actions_json) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const res = stmt.run(
    activeMatchId,
    ts,
    kind,
    model || activeContender.label,
    text,
    actions ? JSON.stringify(actions) : null
  );
  const item: FeedItem = {
    id: Number(res.lastInsertRowid),
    ts,
    kind,
    model: model || activeContender.label,
    text,
    actions,
  };
  recentFeed.push(item);
  if (recentFeed.length > 40) recentFeed = recentFeed.slice(-40);
  broadcast({ type: "feed", item });
}

function broadcast(msg: unknown): void {
  if (wsClients.size === 0) return;
  const raw = JSON.stringify(msg);
  for (const ws of wsClients) {
    try {
      ws.send(raw);
    } catch {
      wsClients.delete(ws);
    }
  }
}

async function getOcAuthHeader(): Promise<string | undefined> {
  try {
    const home = process.env.HOME || "/home/tetraslam";
    const reg = JSON.parse(await readFile(join(home, ".local/state/opencode/service.json"), "utf8"));
    if (reg?.password) {
      return "Basic " + Buffer.from(`opencode:${reg.password}`).toString("base64");
    }
  } catch {
    // ignore
  }
  return undefined;
}

function parseModelRef(spec: string): { providerID: string; id: string } {
  const idx = spec.indexOf("/");
  return { providerID: spec.slice(0, idx), id: spec.slice(idx + 1) };
}

async function callOpenCodeGenerate(modelSpec: string, prompt: string): Promise<string> {
  const auth = await getOcAuthHeader();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) headers.authorization = auth;
  const resp = await fetch(`${OPENCODE_URL}/api/experimental/generate/text`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: parseModelRef(modelSpec),
      prompt,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`OpenCode generate ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const data = (await resp.json()) as { data?: { text?: string }; text?: string };
  return data?.data?.text ?? data?.text ?? "";
}

async function mindustryJson<T = any>(path: string, body?: unknown): Promise<T> {
  const resp = await fetch(`${MINDUSTRY_URL}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) throw new Error(`Mindustry ${path} HTTP ${resp.status}`);
  return (await resp.json()) as T;
}

function startNewMatchRecord(mapName: string): void {
  const now = Date.now();
  // Close any open playing match first
  if (activeMatchId !== null) {
    db.prepare(
      "UPDATE matches SET ended_at = ?, peak_wave = ?, blocks_built = ?, actions_ok = ?, actions_fail = ?, status = 'completed' WHERE id = ?"
    ).run(now, matchPeakWave, matchBlocksBuilt, matchActionsOk, matchActionsFail, activeMatchId);
  }
  const res = db
    .prepare(
      "INSERT INTO matches (game, model, model_label, map, started_at, peak_wave, status) VALUES ('mindustry', ?, ?, ?, ?, 1, 'playing')"
    )
    .run(activeContender.id, activeContender.label, mapName, now);
  activeMatchId = Number(res.lastInsertRowid);
  matchBlocksBuilt = 0;
  matchActionsOk = 0;
  matchActionsFail = 0;
  matchPeakWave = 1;
  recentActionFeedback = [];
  pushFeed("milestone", `${activeContender.label} dropped onto ${mapName} (match #${activeMatchId})`, undefined, "ARENA");
}

function finishMatchRecord(reason: string): void {
  if (activeMatchId === null) return;
  const now = Date.now();
  db.prepare(
    "UPDATE matches SET ended_at = ?, peak_wave = ?, blocks_built = ?, actions_ok = ?, actions_fail = ?, status = 'completed' WHERE id = ?"
  ).run(now, matchPeakWave, matchBlocksBuilt, matchActionsOk, matchActionsFail, activeMatchId);
  pushFeed(
    "milestone",
    `match #${activeMatchId} ended (${reason}) — ${activeContender.label} reached wave ${matchPeakWave} with ${matchBlocksBuilt} blocks built`,
    undefined,
    "ARENA"
  );
  activeMatchId = null;
}

function getLeaderboard() {
  const models = db
    .query(
      `SELECT
        model,
        model_label as label,
        COUNT(*) as matches,
        MAX(peak_wave) as best_wave,
        ROUND(AVG(peak_wave), 1) as avg_wave,
        SUM(blocks_built) as total_blocks,
        SUM(actions_ok) as actions_ok,
        SUM(actions_fail) as actions_fail
      FROM matches
      GROUP BY model
      ORDER BY best_wave DESC, avg_wave DESC, total_blocks DESC`
    )
    .all();

  const recentMatches = db
    .query(
      `SELECT id, model, model_label as label, map, started_at, ended_at, peak_wave, blocks_built, actions_ok, actions_fail, status
       FROM matches
       ORDER BY id DESC
       LIMIT 25`
    )
    .all();

  return { models, recentMatches, roster: ROSTER, maps: MAP_ROTATION };
}

function compassDirection(fromX: number, fromY: number, toX: number, toY: number): string {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.round(Math.hypot(dx, dy));
  const ns = dy > 8 ? "N" : dy < -8 ? "S" : "";
  const ew = dx > 8 ? "E" : dx < -8 ? "W" : "";
  return `${ns}${ew || (ns ? "" : "HERE")} (${dist} tiles)`;
}

function buildTacticalPrompt(state: StatePayload, tactical: any): string {
  const core = state.core;
  const spawnsDesc = (state.spawns || [])
    .map((s) => `(${s.x},${s.y}) [${core ? compassDirection(core.x, core.y, s.x, s.y) : ""}]`)
    .join(", ");

  const friendly = (state.buildings || []).filter((b) => b.team === "sharded");
  const counts: Record<string, number> = {};
  for (const b of friendly) counts[b.block] = (counts[b.block] || 0) + 1;

  const turrets = friendly.filter((b) =>
    ["duo", "scatter", "scorch", "hail", "arc", "lancer", "salvo"].includes(b.block)
  );
  const dryTurrets = turrets.filter((t) => t.ammo === 0).map((t) => `${t.block}@(${t.x},${t.y})`);
  const armedTurrets = turrets.filter((t) => t.ammo > 0).map((t) => `${t.block}@(${t.x},${t.y})[${t.ammo}]`);

  const drillSites = tactical?.drillSites || {};
  const oreLines = ["copper", "lead", "coal", "sand", "titanium"]
    .filter((o) => (drillSites[o] || []).length > 0)
    .map(
      (o) =>
        `  ${o}: ${(drillSites[o] as Array<{ x: number; y: number; tiles: number }>)
          .slice(0, 5)
          .map((p) => `(${p.x},${p.y})[${p.tiles}t]`)
          .join(" ")}`
    )
    .join("\n");

  const feedbackBlock =
    recentActionFeedback.length > 0
      ? recentActionFeedback.slice(-6).join("\n")
      : "none yet (start of match)";

  return `You are playing a live survival game of Mindustry (Sharded team) streamed to human spectators!
Your goal: survive as many waves as possible by building copper/lead drills routed into your Core and armed Turrets, plus walls facing the enemy spawn.

CURRENT STATE:
- Map: ${state.map} (${state.width}x${state.height}) | Wave: ${state.wave} | Next wave in: ${state.waveTime}s | Active enemies: ${state.enemies}
- Core: ${core ? `(${core.x},${core.y}) HP ${core.hp}/${core.maxHp} [3x3 tiles: x=${core.x - 1}..${core.x + 1}, y=${core.y - 1}..${core.y + 1}]` : "DESTROYED"}
- Enemy spawns: ${spawnsDesc || "unknown"}
- Resources: ${JSON.stringify(state.items)}
- Power: +${state.power.produced} / -${state.power.consumed}
- Existing buildings: ${JSON.stringify(counts)}
- Armed turrets: ${armedTurrets.slice(0, 10).join(", ") || "NONE"}
- UNARMED turrets (need ammo belts!): ${dryTurrets.slice(0, 10).join(", ") || "none"}

GUARANTEED VALID 2x2 DRILL SITES NEAR CORE (tested with Build.validPlace):
${oreLines || "  none found within 34 tiles"}

RECENT ACTION RESULTS:
${feedbackBlock}

LOCAL 33x33 MAP AROUND CORE (x=${tactical?.gridBounds?.minX}..${tactical?.gridBounds?.maxX}, y=${tactical?.gridBounds?.minY}..${tactical?.gridBounds?.maxY}):
Legend: C=core, D=drill, T=turret, W=wall, >^<v=conveyor, +=router/junction, P=power, c=copper, l=lead, k=coal, .=open floor, #=solid wall, ~=liquid
${tactical?.ascii || "(unavailable)"}

BUILD RULES & COSTS:
- mechanical-drill (2x2, 12 copper): mines ore under its 2x2 footprint (x..x+1, y..y+1) and outputs onto any adjacent conveyor or core!
- conveyor (1x1, 1 copper): moves items in direction rot (0=East/+x, 1=North/+y, 2=West/-x, 3=South/-y). Use build_line for instant conveyor paths!
- router (1x1, 3 copper): splits one belt into 3 directions (great right behind a row of Duos to feed all of them!).
- duo (1x1 turret, 35 copper): shoots ground enemies — REQUIRES copper or graphite fed by conveyor/router!
- scatter (2x2 AA turret, 85 copper + 45 lead): shoots air enemies — requires lead/scrap ammo!
- scorch (1x1 flamethrower, 25 copper + 22 graphite): brutal close-range — requires coal!
- copper-wall (1x1, 6 copper) / copper-wall-large (2x2, 24 copper): blocks enemy fire.
- combustion-generator (1x1, 60 copper + 25 lead) + power-node (1x1, 1 copper + 3 lead) + arc (1x1 electric turret, 50 copper + 50 lead): electric defense (needs coal in generator).

CRITICAL TACTICS:
1. Turrets DO NOT FIRE without ammo! Always connect a copper mechanical-drill -> conveyor (via build_line) -> router -> adjacent Duo turrets!
2. Also route at least 1-2 copper drills directly into the Core (x=${core ? core.x - 1 : 0}..${core ? core.x + 1 : 0}, y=${core ? core.y - 1 : 0}..${core ? core.y + 1 : 0}) so you never run out of copper!
3. Build walls and turrets on the side of the core FACING the enemy spawn (${spawnsDesc}).
4. Emit 3 to 6 concrete actions per turn. Coordinates MUST be open floor '.' (or ore for drills).

Respond with ONLY valid JSON (no markdown fences):
{
  "thought": "1-2 punchy sentences of tactical reasoning for spectators (witty, concrete, lowercase)",
  "chat": "optional short 6-word in-game broadcast",
  "actions": [
    {"type": "build", "block": "mechanical-drill", "x": 120, "y": 40, "rot": 0},
    {"type": "build_line", "block": "conveyor", "x1": 122, "y1": 40, "x2": 128, "y2": 40},
    {"type": "build", "block": "router", "x": 128, "y": 41},
    {"type": "build", "block": "duo", "x": 128, "y": 42}
  ]
}`;
}

function extractJsonObject(raw: string): any {
  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model reply");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function runAiTurn(): Promise<void> {
  if (aiPaused || aiBusy || !latestState || !latestState.ready || latestState.gameOver || !latestState.core) {
    return;
  }
  aiBusy = true;
  lastTurnAt = Date.now();
  try {
    const tactical = await mindustryJson("/tactical");
    const prompt = buildTacticalPrompt(latestState, tactical);
    const raw = await callOpenCodeGenerate(activeContender.id, prompt);
    const decision = extractJsonObject(raw);

    const thought = String(decision.thought || "thinking...").slice(0, 320);
    const actions: any[] = Array.isArray(decision.actions) ? decision.actions.slice(0, 8) : [];
    const results: FeedItem["actions"] = [];

    if (decision.chat && typeof decision.chat === "string") {
      await mindustryJson("/action", { type: "say", text: decision.chat.slice(0, 100) }).catch(() => {});
    }

    for (const act of actions) {
      if (!act || typeof act !== "object" || !act.type) continue;
      if (act.type === "new_game") continue; // never let AI self-reset
      try {
        const res = await mindustryJson<{ ok: boolean; built?: number; error?: string }>("/action", act);
        const label =
          act.type === "build"
            ? `${act.block} @(${act.x},${act.y})`
            : act.type === "build_line"
              ? `${act.block} (${act.x1},${act.y1})→(${act.x2},${act.y2})`
              : act.type === "demolish"
                ? `demolish @(${act.x},${act.y})`
                : act.type;
        if (res.ok) {
          matchActionsOk++;
          matchBlocksBuilt += res.built || (act.type === "build" ? 1 : 0);
          results.push({ label, ok: true });
          recentActionFeedback.push(`OK: ${label}`);
        } else {
          matchActionsFail++;
          results.push({ label, ok: false, error: res.error });
          recentActionFeedback.push(`FAIL: ${label} -> ${res.error}`);
        }
      } catch (e: any) {
        matchActionsFail++;
        results.push({ label: String(act.type), ok: false, error: String(e?.message || e) });
      }
    }

    if (recentActionFeedback.length > 16) recentActionFeedback = recentActionFeedback.slice(-16);
    pushFeed("thought", thought, results, activeContender.label);

    if (activeMatchId !== null) {
      db.prepare(
        "UPDATE matches SET peak_wave = ?, blocks_built = ?, actions_ok = ?, actions_fail = ?, last_thought = ? WHERE id = ?"
      ).run(matchPeakWave, matchBlocksBuilt, matchActionsOk, matchActionsFail, thought, activeMatchId);
    }
  } catch (err: any) {
    console.error("arena AI turn error:", err);
    pushFeed("error", `${activeContender.label} turn failed: ${String(err?.message || err).slice(0, 180)}`, undefined, "ARENA");
  } finally {
    aiBusy = false;
  }
}

async function pollMindustry(): Promise<void> {
  try {
    const st = await mindustryJson<StatePayload>("/state");
    if (!st.ready) return;

    const prevMap = latestState?.map;
    const prevGameOver = latestState?.gameOver ?? false;
    latestState = st;

    if (!cachedTerrain || cachedTerrain.map !== st.map) {
      cachedTerrain = await mindustryJson<TerrainPayload>("/terrain");
      broadcast({ type: "terrain", terrain: cachedTerrain });
      if (activeMatchId === null || (prevMap && prevMap !== st.map)) {
        startNewMatchRecord(st.map);
      }
    } else if (activeMatchId === null && !st.gameOver) {
      startNewMatchRecord(st.map);
    }

    if (st.wave > matchPeakWave) {
      matchPeakWave = st.wave;
      if (st.wave > 1) {
        pushFeed("milestone", `wave ${st.wave} incoming! (${st.enemies} enemies, core ${st.core?.hp ?? 0} hp)`, undefined, "ARENA");
      }
    }

    if (st.gameOver && !prevGameOver) {
      lastGameOverAt = Date.now();
      finishMatchRecord("core destroyed");
      // Rotate to next contender for the upcoming map!
      rosterIdx = (rosterIdx + 1) % ROSTER.length;
      activeContender = ROSTER[rosterIdx];
      broadcast({ type: "leaderboard", leaderboard: getLeaderboard() });
    }

    broadcast({
      type: "state",
      state: st,
      meta: {
        contender: activeContender,
        matchId: activeMatchId,
        aiPaused,
        aiBusy,
        blocksBuilt: matchBlocksBuilt,
        actionsOk: matchActionsOk,
        actionsFail: matchActionsFail,
        spectators: wsClients.size,
      },
    });

    // Trigger AI turn on cadence
    if (!aiPaused && !aiBusy && !st.gameOver && Date.now() - lastTurnAt >= TURN_INTERVAL_MS && Date.now() - lastGameOverAt > 8000) {
      void runAiTurn();
    }
  } catch (err) {
    // Mindustry temporarily restarting
  }
}

async function pollFactorio(): Promise<void> {
  try {
    const lua = `/sc local p=#game.players; local s=game.surfaces[1]; local e=s.count_entities_filtered{area={{-128,-128},{128,128}}}; rcon.print(game.tick.."|"..p.."|"..string.format("%.4f",game.forces.enemy.evolution_factor).."|"..s.name.."|"..e.."|"..string.format("%.2f",s.daytime))`;
    let raw = await factorioRcon(lua);
    if (raw.includes("achievements") || !raw.includes("|")) {
      raw = await factorioRcon(lua);
    }
    const parts = raw.trim().split("|");
    if (parts.length >= 6) {
      const tick = Number(parts[0]) || 0;
      factorioState = {
        online: true,
        tick,
        playtimeSec: Math.floor(tick / 60),
        playersOnline: Number(parts[1]) || 0,
        evolution: Number(parts[2]) || 0,
        surface: parts[3] || "nauvis",
        entitiesNearSpawn: Number(parts[4]) || 0,
        daytime: Number(parts[5]) || 0,
        updatedAt: Date.now(),
      };
    } else {
      // Fallback basic check
      const players = await factorioRcon("/players online");
      factorioState = {
        ...factorioState,
        online: true,
        updatedAt: Date.now(),
        error: players,
      };
    }
    broadcast({ type: "factorio", factorio: factorioState });
  } catch (err: any) {
    factorioState = {
      ...factorioState,
      online: false,
      updatedAt: Date.now(),
      error: String(err?.message || err),
    };
  }
}

// Start polling loops
setInterval(() => void pollMindustry(), 300);
setInterval(() => void pollFactorio(), 10_000);
void pollMindustry();
void pollFactorio();

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(req, srv) {
    const url = new URL(req.url);

    if (url.pathname === "/ws") {
      if (srv.upgrade(req)) return;
      return new Response("Upgrade failed", { status: 400 });
    }

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        mindustry: Boolean(latestState?.ready),
        factorio: factorioState.online,
        contender: activeContender.id,
        spectators: wsClients.size,
      });
    }

    if (url.pathname === "/api/state") {
      return Response.json({
        state: latestState,
        terrain: cachedTerrain ? { map: cachedTerrain.map, width: cachedTerrain.width, height: cachedTerrain.height } : null,
        meta: {
          contender: activeContender,
          matchId: activeMatchId,
          aiPaused,
          aiBusy,
          blocksBuilt: matchBlocksBuilt,
          actionsOk: matchActionsOk,
          actionsFail: matchActionsFail,
          spectators: wsClients.size,
        },
        feed: recentFeed.slice(-25),
        factorio: factorioState,
      });
    }

    if (url.pathname === "/api/leaderboard") {
      return Response.json(getLeaderboard());
    }

    if (url.pathname === "/api/control" && req.method === "POST") {
      // Allow control requests from loopback/tailnet or explicit admin UI
      const body = (await req.json().catch(() => ({}))) as any;
      if (body.action === "pause") {
        aiPaused = true;
        pushFeed("system", "AI runner paused", undefined, "ARENA");
      } else if (body.action === "resume") {
        aiPaused = false;
        pushFeed("system", "AI runner resumed", undefined, "ARENA");
        void runAiTurn();
      } else if (body.action === "set_model" && body.model) {
        const found = ROSTER.find((r) => r.id === body.model);
        activeContender = found || { id: body.model, label: body.model, color: "#a78bfa" };
        pushFeed("system", `switched active contender to ${activeContender.label}`, undefined, "ARENA");
      } else if (body.action === "send_wave") {
        await mindustryJson("/action", { type: "send_wave" });
        pushFeed("system", "manually sent next wave!", undefined, "ARENA");
      } else if (body.action === "new_match") {
        if (body.model) {
          const found = ROSTER.find((r) => r.id === body.model);
          activeContender = found || { id: body.model, label: body.model, color: "#a78bfa" };
        } else {
          rosterIdx = (rosterIdx + 1) % ROSTER.length;
          activeContender = ROSTER[rosterIdx];
        }
        const nextMap = body.map || MAP_ROTATION[(mapIdx = (mapIdx + 1) % MAP_ROTATION.length)];
        finishMatchRecord("manual reset");
        await mindustryJson("/action", { type: "new_game", map: nextMap });
      }
      return Response.json({ ok: true, aiPaused, contender: activeContender });
    }

    if (url.pathname === "/api/factorio/rcon" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { command?: string };
      if (!body.command) return Response.json({ ok: false, error: "command required" }, { status: 400 });
      try {
        const out = await factorioRcon(body.command);
        return Response.json({ ok: true, output: out });
      } catch (err: any) {
        return Response.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
      }
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const html = await readFile(join(WEB_DIR, "index.html"), "utf8");
      return new Response(html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-cache",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      wsClients.add(ws);
      ws.send(
        JSON.stringify({
          type: "init",
          terrain: cachedTerrain,
          state: latestState,
          meta: {
            contender: activeContender,
            matchId: activeMatchId,
            aiPaused,
            aiBusy,
            blocksBuilt: matchBlocksBuilt,
            actionsOk: matchActionsOk,
            actionsFail: matchActionsFail,
            spectators: wsClients.size,
          },
          feed: recentFeed.slice(-30),
          leaderboard: getLeaderboard(),
          factorio: factorioState,
        })
      );
    },
    close(ws) {
      wsClients.delete(ws);
    },
    message() {
      // read-only spectator stream
    },
  },
});

console.log(`tetrapod-arena listening on http://127.0.0.1:${server.port}`);
