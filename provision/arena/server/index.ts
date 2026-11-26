import { Database } from "bun:sqlite";
import { mkdir, readFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import type { ServerWebSocket } from "bun";
import { factorioRcon } from "./rcon";

const PORT = Number(process.env.ARENA_PORT || "6570");
const MINDUSTRY_URL = (process.env.MINDUSTRY_URL || "http://127.0.0.1:6568").replace(/\/+$/, "");
const OPENCODE_URL = (process.env.OPENCODE_URL || "http://127.0.0.1:4096").replace(/\/+$/, "");
const DATA_DIR = process.env.ARENA_DATA_DIR || "/opt/tetrapod/arena";
const WEB_DIR = process.env.ARENA_WEB_DIR || join(import.meta.dir, "../web");
const SPRITES_DIR = process.env.ARENA_SPRITES_DIR || join(DATA_DIR, "sprites");
const DEFAULT_TURN_MS = Number(process.env.ARENA_TURN_MS || "13000");

type RunnerMode = "paused" | "single" | "pinned" | "rotation";
type MatchState = "live" | "paused" | "idle";

type Contender = {
  id: string;
  provider: string;
  ticker: string;
  label: string;
  color: string;
};

// Strictly subscription-backed models (ChatGPT OAuth + personal Claude Agent).
const CANDIDATE_ROSTER: Contender[] = [
  { id: "openai/gpt-6.2-astra", provider: "openai", ticker: "gpt-6.2-astra", label: "openai/gpt-6.2-astra", color: "#38bdf8" },
  { id: "openai/gpt-6.1-terra", provider: "openai", ticker: "gpt-6.1-terra", label: "openai/gpt-6.1-terra", color: "#34d399" },
  { id: "openai/gpt-6.2-sol", provider: "openai", ticker: "gpt-6.2-sol", label: "openai/gpt-6.2-sol", color: "#a78bfa" },
  { id: "openai/gpt-6-luna", provider: "openai", ticker: "gpt-6-luna", label: "openai/gpt-6-luna", color: "#2dd4bf" },
  { id: "claude-agent/sonnet", provider: "claude-agent", ticker: "claude-sonnet-5.5", label: "claude-agent/sonnet", color: "#f59e0b" },
  { id: "claude-agent/opus", provider: "claude-agent", ticker: "claude-opus-5.5", label: "claude-agent/opus", color: "#fb7185" },
  { id: "claude-agent/fable", provider: "claude-agent", ticker: "claude-fable-5.2", label: "claude-agent/fable", color: "#f472b6" },
  { id: "claude-agent/haiku", provider: "claude-agent", ticker: "claude-haiku-5.5", label: "claude-agent/haiku", color: "#fbbf24" },
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
  "Shattered",
  "Wasteland",
  "Fork",
  "Tendrils",
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
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS match_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model TEXT NOT NULL,
    map TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS map_terrains (
    map TEXT PRIMARY KEY,
    terrain_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS match_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL,
    wave INTEGER NOT NULL,
    enemies INTEGER NOT NULL,
    core_hp INTEGER NOT NULL,
    core_max_hp INTEGER NOT NULL,
    items_json TEXT NOT NULL,
    power_json TEXT NOT NULL,
    buildings_json TEXT NOT NULL,
    units_json TEXT NOT NULL,
    player_drone_json TEXT,
    thought TEXT,
    actions_json TEXT,
    prompt_chars INTEGER DEFAULT 0,
    output_chars INTEGER DEFAULT 0,
    latency_ms INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_snapshots_match_seq ON match_snapshots(match_id, seq);
`);

// Safe migrations for existing DBs
for (const col of [
  "ALTER TABLE matches ADD COLUMN turns INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE matches ADD COLUMN avg_latency_ms INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE matches ADD COLUMN prompt_chars INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE matches ADD COLUMN output_chars INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE matches ADD COLUMN end_reason TEXT DEFAULT ''",
]) {
  try {
    db.exec(col);
  } catch {
    // column already exists
  }
}

type ArenaConfig = {
  mode: RunnerMode;
  turnIntervalMs: number;
  autoPauseEmpty: boolean;
  pinnedModel: string;
  enabledModels: string[];
};

function loadConfig(): ArenaConfig {
  const get = (k: string, fallback: string) => {
    const row = db.query("SELECT value FROM settings WHERE key = ?").get(k) as { value: string } | null;
    return row ? row.value : fallback;
  };
  const modeRaw = get("mode", "rotation");
  const mode: RunnerMode =
    modeRaw === "paused" || modeRaw === "single" || modeRaw === "pinned" || modeRaw === "rotation"
      ? modeRaw
      : "rotation";
  let enabledModels: string[] = CANDIDATE_ROSTER.map((c) => c.id);
  try {
    const parsed = JSON.parse(get("enabled_models", "null"));
    if (Array.isArray(parsed) && parsed.length > 0) enabledModels = parsed.map(String);
  } catch {
    // keep default
  }
  return {
    mode,
    turnIntervalMs: Math.max(5000, Math.min(60000, Number(get("turn_interval_ms", String(DEFAULT_TURN_MS))) || DEFAULT_TURN_MS)),
    autoPauseEmpty: get("auto_pause_empty", "false") === "true",
    pinnedModel: get("pinned_model", "claude-agent/haiku"),
    enabledModels,
  };
}

function saveConfig(cfg: ArenaConfig): void {
  const upsert = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  upsert.run("mode", cfg.mode);
  upsert.run("turn_interval_ms", String(cfg.turnIntervalMs));
  upsert.run("auto_pause_empty", String(cfg.autoPauseEmpty));
  upsert.run("pinned_model", cfg.pinnedModel);
  upsert.run("enabled_models", JSON.stringify(cfg.enabledModels));
}

let config: ArenaConfig = loadConfig();
let availableRoster: Contender[] = CANDIDATE_ROSTER.filter((c) => c.provider === "openai");
let ROSTER: Contender[] = [...availableRoster];

type PlayerDrone = {
  id: number;
  type: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  rot: number;
  buildTarget: { x: number; y: number; block: string } | null;
};

type TerrainPayload = {
  ready: boolean;
  map: string;
  width: number;
  height: number;
  spawns: Array<{ x: number; y: number }>;
  core: { x: number; y: number } | null;
  palette: string[];
  rle: number[];
  tileNames: string[];
  tileRle: number[];
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
  paused?: boolean;
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
    aimRot: number;
    hp: number;
    maxHp: number;
    team: string;
    ammo: number;
  }>;
  powerLinks: Array<[number, number, number, number]>;
  conveyorItems: Array<[number, number, string]>;
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
  playerDrone: PlayerDrone | null;
};

type FeedItem = {
  id: number;
  ts: number;
  kind: "thought" | "system" | "milestone" | "error";
  model?: string;
  text: string;
  actions?: Array<{ label: string; ok: boolean; error?: string }>;
  latencyMs?: number;
  seq?: number;
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
  version?: string;
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
let activeContender: Contender = ROSTER[0];
let activeMatchId: number | null = null;
let arenaIdle = config.mode === "paused";
let aiPaused = config.mode === "paused";
let aiBusy = false;
let lastTurnAt = 0;
let lastGameOverAt = 0;
let lastPauseSyncAt = 0;
let lastSpectatorSeenAt = Date.now();
let matchBlocksBuilt = 0;
let matchActionsOk = 0;
let matchActionsFail = 0;
let matchPeakWave = 1;
let matchTurns = 0;
let matchTotalLatencyMs = 0;
let matchPromptChars = 0;
let matchOutputChars = 0;
let matchSnapshotSeq = 0;
let recentActionFeedback: string[] = [];
let recentFeed: FeedItem[] = [];
const wsClients = new Set<ServerWebSocket<unknown>>();

function getQueue(): Array<{ id: number; model: string; map: string; created_at: number }> {
  return db.query("SELECT id, model, map, created_at FROM match_queue ORDER BY id ASC").all() as any[];
}

function getMetaPayload() {
  const emptyPaused =
    !arenaIdle && config.autoPauseEmpty && wsClients.size === 0 && Date.now() - lastSpectatorSeenAt > 10 * 60_000;
  const matchState: MatchState = arenaIdle ? "idle" : aiPaused || emptyPaused ? "paused" : "live";
  const lastCompleted = db
    .query("SELECT id, model, map, peak_wave, ended_at FROM matches WHERE status = 'completed' ORDER BY id DESC LIMIT 1")
    .get() as any;
  return {
    contender: activeContender,
    matchId: arenaIdle ? null : activeMatchId,
    matchState,
    arenaIdle,
    mode: config.mode,
    turnIntervalMs: config.turnIntervalMs,
    autoPauseEmpty: config.autoPauseEmpty,
    emptyPaused,
    aiPaused,
    aiBusy,
    blocksBuilt: matchBlocksBuilt,
    actionsOk: matchActionsOk,
    actionsFail: matchActionsFail,
    turns: matchTurns,
    avgLatencyMs: matchTurns > 0 ? Math.round(matchTotalLatencyMs / matchTurns) : 0,
    spectators: wsClients.size,
    queueLength: getQueue().length,
    lastCompleted: lastCompleted || null,
  };
}

function pushFeed(
  kind: FeedItem["kind"],
  text: string,
  actions?: FeedItem["actions"],
  model?: string,
  extra?: { latencyMs?: number; seq?: number }
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
    latencyMs: extra?.latencyMs,
    seq: extra?.seq,
  };
  recentFeed.push(item);
  if (recentFeed.length > 50) recentFeed = recentFeed.slice(-50);
  broadcast({ type: "feed", item });
}

function recordSnapshot(
  st: StatePayload,
  kind: string,
  extra?: {
    thought?: string;
    actions?: FeedItem["actions"];
    promptChars?: number;
    outputChars?: number;
    latencyMs?: number;
  }
): number | undefined {
  if (activeMatchId === null) return undefined;
  matchSnapshotSeq++;
  const seq = matchSnapshotSeq;
  db.prepare(
    `INSERT INTO match_snapshots
      (match_id, seq, ts, kind, wave, enemies, core_hp, core_max_hp, items_json, power_json, buildings_json, units_json, player_drone_json, thought, actions_json, prompt_chars, output_chars, latency_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    activeMatchId,
    seq,
    Date.now(),
    kind,
    st.wave,
    st.enemies,
    st.core?.hp ?? 0,
    st.core?.maxHp ?? 0,
    JSON.stringify(st.items || {}),
    JSON.stringify(st.power || { produced: 0, consumed: 0 }),
    JSON.stringify(st.buildings || []),
    JSON.stringify(st.units || []),
    st.playerDrone ? JSON.stringify(st.playerDrone) : null,
    extra?.thought ?? null,
    extra?.actions ? JSON.stringify(extra.actions) : null,
    extra?.promptChars ?? 0,
    extra?.outputChars ?? 0,
    extra?.latencyMs ?? 0
  );
  return seq;
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

function makeContender(modelId: string): Contender {
  const existing = CANDIDATE_ROSTER.find((c) => c.id === modelId);
  if (existing) return existing;
  const idx = modelId.indexOf("/");
  const provider = idx > 0 ? modelId.slice(0, idx) : "unknown";
  const ticker = idx > 0 ? modelId.slice(idx + 1) : modelId;
  return { id: modelId, provider, ticker, label: modelId, color: "#a78bfa" };
}

function recomputeEnabledRoster(): void {
  const enabled = new Set(config.enabledModels);
  const filtered = availableRoster.filter((c) => enabled.has(c.id));
  ROSTER = filtered.length > 0 ? filtered : [...availableRoster];
  if (!ROSTER.some((c) => c.id === activeContender.id) && config.mode === "rotation") {
    rosterIdx = 0;
    activeContender = ROSTER[0];
  }
}

async function refreshActiveRoster(): Promise<void> {
  try {
    const auth = await getOcAuthHeader();
    const headers: Record<string, string> = {};
    if (auth) headers.authorization = auth;
    const resp = await fetch(`${OPENCODE_URL}/api/credential`, { headers, signal: AbortSignal.timeout(4000) });
    if (!resp.ok) return;
    const raw = (await resp.json()) as any;
    const creds: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
    const activeProviders = new Set(
      creds
        .filter((c) => c?.active && (c?.integrationID === "openai" || c?.integrationID === "claude-agent"))
        .map((c) => String(c.integrationID))
    );
    const next = CANDIDATE_ROSTER.filter((c) => activeProviders.has(c.provider));
    if (next.length > 0) {
      availableRoster = next;
      recomputeEnabledRoster();
    }
  } catch {
    // keep current roster
  }
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

function startNewMatchRecord(mapName: string, st?: StatePayload): void {
  const now = Date.now();
  if (activeMatchId !== null) {
    db.prepare(
      "UPDATE matches SET ended_at = ?, peak_wave = ?, blocks_built = ?, actions_ok = ?, actions_fail = ?, turns = ?, avg_latency_ms = ?, prompt_chars = ?, output_chars = ?, status = 'completed', end_reason = 'superseded' WHERE id = ?"
    ).run(
      now,
      matchPeakWave,
      matchBlocksBuilt,
      matchActionsOk,
      matchActionsFail,
      matchTurns,
      matchTurns > 0 ? Math.round(matchTotalLatencyMs / matchTurns) : 0,
      matchPromptChars,
      matchOutputChars,
      activeMatchId
    );
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
  matchTurns = 0;
  matchTotalLatencyMs = 0;
  matchPromptChars = 0;
  matchOutputChars = 0;
  matchSnapshotSeq = 0;
  recentActionFeedback = [];
  if (st && st.ready) {
    recordSnapshot(st, "start", { thought: `${activeContender.id} deployed onto ${mapName}` });
  }
  pushFeed("milestone", `${activeContender.label} dropped onto ${mapName} (match #${activeMatchId})`, undefined, "ARENA");
}

function finishMatchRecord(reason: string, st?: StatePayload): void {
  if (activeMatchId === null) return;
  if (st && st.ready) {
    recordSnapshot(st, "end", { thought: `match ended: ${reason}` });
  }
  const now = Date.now();
  db.prepare(
    "UPDATE matches SET ended_at = ?, peak_wave = ?, blocks_built = ?, actions_ok = ?, actions_fail = ?, turns = ?, avg_latency_ms = ?, prompt_chars = ?, output_chars = ?, status = 'completed', end_reason = ? WHERE id = ?"
  ).run(
    now,
    matchPeakWave,
    matchBlocksBuilt,
    matchActionsOk,
    matchActionsFail,
    matchTurns,
    matchTurns > 0 ? Math.round(matchTotalLatencyMs / matchTurns) : 0,
    matchPromptChars,
    matchOutputChars,
    reason,
    activeMatchId
  );
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
        SUM(actions_fail) as actions_fail,
        SUM(turns) as total_turns
      FROM matches
      GROUP BY model
      ORDER BY best_wave DESC, avg_wave DESC, total_blocks DESC`
    )
    .all();

  const recentMatches = db
    .query(
      `SELECT m.id, m.model, m.model_label as label, m.map, m.started_at, m.ended_at,
              m.peak_wave, m.blocks_built, m.actions_ok, m.actions_fail, m.turns,
              m.avg_latency_ms, m.status, m.end_reason,
              (SELECT COUNT(*) FROM match_snapshots s WHERE s.match_id = m.id) as snapshot_count
       FROM matches m
       ORDER BY m.id DESC
       LIMIT 40`
    )
    .all();

  return {
    models,
    recentMatches,
    roster: ROSTER,
    availableRoster,
    maps: MAP_ROTATION,
    queue: getQueue(),
  };
}

function getMatchDetail(matchId: number) {
  const match = db
    .query(
      `SELECT id, game, model, model_label as label, map, started_at, ended_at,
              peak_wave, blocks_built, actions_ok, actions_fail, turns,
              avg_latency_ms, prompt_chars, output_chars, status, end_reason, last_thought
       FROM matches WHERE id = ?`
    )
    .get(matchId) as any;
  if (!match) return null;

  const rawSnaps = db
    .query(
      `SELECT id, seq, ts, kind, wave, enemies, core_hp, core_max_hp,
              items_json, power_json, buildings_json, units_json, player_drone_json,
              thought, actions_json, prompt_chars, output_chars, latency_ms
       FROM match_snapshots
       WHERE match_id = ?
       ORDER BY seq ASC`
    )
    .all(matchId) as any[];

  const snapshots = rawSnaps.map((s) => {
    const items = JSON.parse(s.items_json || "{}");
    const power = JSON.parse(s.power_json || "{}");
    const buildings = JSON.parse(s.buildings_json || "[]");
    const units = JSON.parse(s.units_json || "[]");
    const playerDrone = s.player_drone_json ? JSON.parse(s.player_drone_json) : null;
    const actions = s.actions_json ? JSON.parse(s.actions_json) : [];
    return {
      id: s.id,
      seq: s.seq,
      ts: s.ts,
      kind: s.kind,
      wave: s.wave,
      enemies: s.enemies,
      coreHp: s.core_hp,
      coreMaxHp: s.core_max_hp,
      items,
      power,
      buildings,
      units,
      playerDrone,
      thought: s.thought,
      actions,
      promptChars: s.prompt_chars,
      outputChars: s.output_chars,
      latencyMs: s.latency_ms,
    };
  });

  // Compact LoL-style economy & threat curve for charts
  const timeline = snapshots.map((s) => {
    const friendly = s.buildings.filter((b: any) => b.team === "sharded");
    const turrets = friendly.filter((b: any) =>
      ["duo", "scatter", "scorch", "hail", "arc", "lancer", "salvo"].includes(b.block)
    );
    const armedTurrets = turrets.filter((b: any) => (b.ammo || 0) > 0);
    const drills = friendly.filter((b: any) => String(b.block || "").includes("drill"));
    return {
      seq: s.seq,
      ts: s.ts,
      wave: s.wave,
      enemies: s.enemies,
      coreHp: s.coreHp,
      coreMaxHp: s.coreMaxHp,
      copper: s.items.copper || 0,
      lead: s.items.lead || 0,
      graphite: s.items.graphite || 0,
      buildings: friendly.length,
      drills: drills.length,
      turrets: turrets.length,
      armedTurrets: armedTurrets.length,
      powerNet: (s.power?.produced || 0) - (s.power?.consumed || 0),
      latencyMs: s.latencyMs,
    };
  });

  const terrainRow = db.query("SELECT terrain_json FROM map_terrains WHERE map = ?").get(match.map) as { terrain_json: string } | null;

  return {
    match,
    hasTerrain: Boolean(terrainRow),
    snapshots,
    timeline,
  };
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
5. ONLY use these action types: "build", "build_line", "demolish" ({"type":"demolish","x":120,"y":40} refunds 50% items), or "send_wave". Do NOT invent actions like "mine", "deconstruct", or "break".

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

async function runAiTurn(force = false): Promise<void> {
  if ((!force && aiPaused) || aiBusy || !latestState || !latestState.ready || latestState.gameOver || !latestState.core) {
    return;
  }
  aiBusy = true;
  lastTurnAt = Date.now();
  const t0 = Date.now();
  try {
    const tactical = await mindustryJson("/tactical");
    const prompt = buildTacticalPrompt(latestState, tactical);
    const raw = await callOpenCodeGenerate(activeContender.id, prompt);
    const latencyMs = Date.now() - t0;
    const decision = extractJsonObject(raw);

    const thought = String(decision.thought || "thinking...").slice(0, 320);
    const actions: any[] = Array.isArray(decision.actions) ? decision.actions.slice(0, 8) : [];
    const results: FeedItem["actions"] = [];

    if (decision.chat && typeof decision.chat === "string") {
      await mindustryJson("/action", { type: "say", text: decision.chat.slice(0, 100) }).catch(() => {});
    }

    for (const act of actions) {
      if (!act || typeof act !== "object" || !act.type) continue;
      if (act.type === "new_game") continue;
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

    matchTurns++;
    matchTotalLatencyMs += latencyMs;
    matchPromptChars += prompt.length;
    matchOutputChars += raw.length;
    if (recentActionFeedback.length > 16) recentActionFeedback = recentActionFeedback.slice(-16);

    // Fetch fresh post-action state for snapshot accuracy
    const postState = await mindustryJson<StatePayload>("/state").catch(() => latestState!);
    if (postState && postState.ready) latestState = postState;

    const seq = recordSnapshot(latestState, "turn", {
      thought,
      actions: results,
      promptChars: prompt.length,
      outputChars: raw.length,
      latencyMs,
    });
    pushFeed("thought", thought, results, activeContender.label, { latencyMs, seq });

    if (activeMatchId !== null) {
      db.prepare(
        "UPDATE matches SET peak_wave = ?, blocks_built = ?, actions_ok = ?, actions_fail = ?, turns = ?, avg_latency_ms = ?, prompt_chars = ?, output_chars = ?, last_thought = ? WHERE id = ?"
      ).run(
        matchPeakWave,
        matchBlocksBuilt,
        matchActionsOk,
        matchActionsFail,
        matchTurns,
        Math.round(matchTotalLatencyMs / matchTurns),
        matchPromptChars,
        matchOutputChars,
        thought,
        activeMatchId
      );
    }
  } catch (err: any) {
    console.error("arena AI turn error:", err);
    pushFeed("error", `${activeContender.label} turn failed: ${String(err?.message || err).slice(0, 180)}`, undefined, "ARENA");
  } finally {
    aiBusy = false;
  }
}

async function advanceAfterMatchEnd(): Promise<void> {
  // 1. Check queued tournament matches first
  const nextQueued = db.query("SELECT id, model, map FROM match_queue ORDER BY id ASC LIMIT 1").get() as
    | { id: number; model: string; map: string }
    | null;
  if (nextQueued) {
    db.prepare("DELETE FROM match_queue WHERE id = ?").run(nextQueued.id);
    activeContender = makeContender(nextQueued.model);
    arenaIdle = false;
    aiPaused = false;
    pushFeed("system", `launching queued match: ${activeContender.id} on ${nextQueued.map}`, undefined, "ARENA");
    await mindustryJson("/action", { type: "new_game", map: nextQueued.map }).catch(() => {});
    broadcast({ type: "config", config, meta: getMetaPayload(), leaderboard: getLeaderboard() });
    return;
  }

  // 2. Otherwise follow configured after-match policy
  if (config.mode === "single" || config.mode === "paused") {
    arenaIdle = true;
    aiPaused = true;
    pushFeed("system", "arena off-air — no active match", undefined, "ARENA");
  } else if (config.mode === "pinned") {
    arenaIdle = false;
    activeContender = makeContender(config.pinnedModel);
  } else {
    arenaIdle = false;
    rosterIdx = (rosterIdx + 1) % ROSTER.length;
    activeContender = ROSTER[rosterIdx];
  }
  broadcast({ type: "config", config, meta: getMetaPayload(), leaderboard: getLeaderboard() });
}

async function pollMindustry(): Promise<void> {
  try {
    const st = await mindustryJson<StatePayload>("/state");
    if (!st.ready) return;

    const prevMap = latestState?.map;
    const prevGameOver = latestState?.gameOver ?? false;
    latestState = st;

    if (wsClients.size > 0) {
      lastSpectatorSeenAt = Date.now();
    }

    if (!cachedTerrain || cachedTerrain.map !== st.map) {
      cachedTerrain = await mindustryJson<TerrainPayload>("/terrain");
      db.prepare(
        "INSERT INTO map_terrains (map, terrain_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(map) DO UPDATE SET terrain_json = excluded.terrain_json, updated_at = excluded.updated_at"
      ).run(cachedTerrain.map, JSON.stringify(cachedTerrain), Date.now());
      broadcast({ type: "terrain", terrain: cachedTerrain });
      if (!arenaIdle && (activeMatchId === null || (prevMap && prevMap !== st.map))) {
        startNewMatchRecord(st.map, st);
      }
    } else if (!arenaIdle && activeMatchId === null && !st.gameOver) {
      startNewMatchRecord(st.map, st);
    }

    if (!arenaIdle && st.wave > matchPeakWave) {
      matchPeakWave = st.wave;
      if (st.wave > 1) {
        const seq = recordSnapshot(st, "wave", { thought: `wave ${st.wave} arrived (${st.enemies} enemies)` });
        pushFeed("milestone", `wave ${st.wave} incoming (${st.enemies} enemies, core ${st.core?.hp ?? 0} hp)`, undefined, "ARENA", { seq });
      }
    }

    if (!arenaIdle && st.gameOver && !prevGameOver) {
      lastGameOverAt = Date.now();
      finishMatchRecord("core destroyed", st);
      await advanceAfterMatchEnd();
    }

    const emptyPaused =
      !arenaIdle && config.autoPauseEmpty && wsClients.size === 0 && Date.now() - lastSpectatorSeenAt > 10 * 60_000;
    const desiredPaused = arenaIdle || aiPaused || emptyPaused;

    // Keep Mindustry simulation strictly synchronized with runner pause state
    if (!st.gameOver && typeof st.paused === "boolean" && st.paused !== desiredPaused && Date.now() - lastPauseSyncAt > 800) {
      lastPauseSyncAt = Date.now();
      await mindustryJson("/action", { type: "set_paused", paused: desiredPaused }).catch(() => {});
      st.paused = desiredPaused;
    }

    broadcast({
      type: "state",
      state: st,
      meta: getMetaPayload(),
    });

    if (
      !desiredPaused &&
      !aiBusy &&
      !st.gameOver &&
      Date.now() - lastTurnAt >= config.turnIntervalMs &&
      Date.now() - lastGameOverAt > 8000
    ) {
      void runAiTurn();
    }
  } catch {
    // Mindustry temporarily restarting
  }
}

async function pollFactorio(): Promise<void> {
  try {
    const lua = `/sc local s=game.surfaces[1]; local f=game.forces.enemy; local ok,evo=pcall(function() return f.get_evolution_factor(s) end); if not ok then evo=f.evolution_factor end; rcon.print(game.tick.."|"..#game.connected_players.."|"..string.format("%.4f",evo).."|"..s.name.."|"..s.count_entities_filtered{area={{-128,-128},{128,128}}}.."|"..string.format("%.2f",s.daytime).."|"..script.active_mods.base)`;
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
        version: parts[6] || undefined,
        updatedAt: Date.now(),
      };
    } else {
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

void refreshActiveRoster();
setInterval(() => void refreshActiveRoster(), 60_000);
setInterval(() => void pollMindustry(), 300);
setInterval(() => void pollFactorio(), 10_000);
void pollMindustry();
void pollFactorio();

async function serveWeb(pathname: string): Promise<Response | null> {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch {
    return null;
  }
  if (rel === "") rel = "index.html";
  if (rel.split("/").some((part) => part === "" || part.startsWith("."))) return null;
  const path = normalize(join(WEB_DIR, rel));
  if (!path.startsWith(normalize(WEB_DIR) + sep)) return null;
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  return new Response(file, {
    headers: {
      "cache-control": rel.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    },
  });
}

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
        mode: config.mode,
        spectators: wsClients.size,
      });
    }

    if (url.pathname === "/api/state") {
      return Response.json({
        state: latestState,
        terrain: cachedTerrain ? { map: cachedTerrain.map, width: cachedTerrain.width, height: cachedTerrain.height } : null,
        meta: getMetaPayload(),
        config,
        feed: recentFeed.slice(-30),
        factorio: factorioState,
      });
    }

    if (url.pathname === "/api/terrain") {
      const requestedMap = url.searchParams.get("map");
      if (requestedMap) {
        if (cachedTerrain && cachedTerrain.map === requestedMap) {
          return Response.json(cachedTerrain);
        }
        const row = db.query("SELECT terrain_json FROM map_terrains WHERE map = ?").get(requestedMap) as { terrain_json: string } | null;
        if (row) {
          return new Response(row.terrain_json, { headers: { "content-type": "application/json" } });
        }
        return Response.json({ ready: false, error: "terrain not cached for map" }, { status: 404 });
      }
      return Response.json(cachedTerrain || { ready: false });
    }

    if (url.pathname.startsWith("/sprites/")) {
      const name = url.pathname.slice("/sprites/".length);
      if (/^[a-zA-Z0-9._-]+$/.test(name)) {
        const file = Bun.file(join(SPRITES_DIR, name));
        if (await file.exists()) {
          return new Response(file, {
            headers: { "cache-control": "public, max-age=86400, immutable" },
          });
        }
      }
      return new Response("Sprite not found", { status: 404 });
    }

    if (url.pathname === "/api/leaderboard") {
      return Response.json(getLeaderboard());
    }

    if (url.pathname === "/api/matches" && req.method === "GET") {
      const rows = db
        .query(
          `SELECT m.id, m.model, m.model_label as label, m.map, m.started_at, m.ended_at,
                  m.peak_wave, m.blocks_built, m.actions_ok, m.actions_fail, m.turns,
                  m.avg_latency_ms, m.status, m.end_reason, m.last_thought,
                  (SELECT COUNT(*) FROM match_snapshots s WHERE s.match_id = m.id) as snapshot_count
           FROM matches m
           ORDER BY m.id DESC
           LIMIT 100`
        )
        .all();
      return Response.json({ matches: rows, queue: getQueue() });
    }

    const matchDetailMatch = url.pathname.match(/^\/api\/matches\/(\d+)$/);
    if (matchDetailMatch && req.method === "GET") {
      const detail = getMatchDetail(Number(matchDetailMatch[1]));
      if (!detail) return Response.json({ error: "Match not found" }, { status: 404 });
      return Response.json(detail);
    }

    // ---- Authelia-protected Admin API (/api/admin/* + /api/control) ----
    if (url.pathname === "/api/admin/me" && req.method === "GET") {
      const user = req.headers.get("remote-user") || "local-admin";
      return Response.json({ admin: true, user });
    }

    if (url.pathname === "/api/admin/config" && req.method === "GET") {
      const usage = db
        .query(
          `SELECT COUNT(*) as total_matches,
                  COALESCE(SUM(turns), 0) as total_turns,
                  COALESCE(SUM(blocks_built), 0) as total_blocks,
                  COALESCE(SUM(prompt_chars), 0) as total_prompt_chars,
                  COALESCE(SUM(output_chars), 0) as total_output_chars
           FROM matches`
        )
        .get();
      return Response.json({
        config,
        aiPaused,
        contender: activeContender,
        availableRoster,
        roster: ROSTER,
        maps: MAP_ROTATION,
        queue: getQueue(),
        usage,
      });
    }

    if (url.pathname === "/api/admin/config" && req.method === "PATCH") {
      const body = (await req.json().catch(() => ({}))) as any;
      if (body.mode && ["paused", "single", "pinned", "rotation"].includes(body.mode)) {
        config.mode = body.mode;
      }
      if (typeof body.arenaIdle === "boolean") {
        arenaIdle = body.arenaIdle;
        if (arenaIdle) aiPaused = true;
      }
      if (typeof body.turnIntervalMs === "number") {
        config.turnIntervalMs = Math.max(5000, Math.min(60000, Math.round(body.turnIntervalMs)));
      }
      if (typeof body.autoPauseEmpty === "boolean") {
        config.autoPauseEmpty = body.autoPauseEmpty;
      }
      if (typeof body.pinnedModel === "string" && body.pinnedModel.includes("/")) {
        config.pinnedModel = body.pinnedModel;
        if (config.mode === "pinned") {
          activeContender = makeContender(config.pinnedModel);
        }
      }
      if (Array.isArray(body.enabledModels) && body.enabledModels.length > 0) {
        config.enabledModels = body.enabledModels.map(String);
        recomputeEnabledRoster();
      }
      if (typeof body.aiPaused === "boolean") {
        aiPaused = body.aiPaused;
      }
      saveConfig(config);
      pushFeed("system", `config updated (mode=${config.mode}, cadence=${Math.round(config.turnIntervalMs / 1000)}s, paused=${aiPaused})`, undefined, "ARENA");
      broadcast({ type: "config", config, meta: getMetaPayload(), leaderboard: getLeaderboard() });
      return Response.json({ ok: true, config, aiPaused, contender: activeContender, roster: ROSTER });
    }

    if (url.pathname === "/api/admin/matches" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as any;
      const modelId = String(body.model || activeContender.id);
      const mapName = String(body.map || MAP_ROTATION[(mapIdx = (mapIdx + 1) % MAP_ROTATION.length)]);
      if (body.enqueue) {
        const res = db
          .prepare("INSERT INTO match_queue (model, map, created_at) VALUES (?, ?, ?)")
          .run(modelId, mapName, Date.now());
        pushFeed("system", `queued match: ${modelId} on ${mapName}`, undefined, "ARENA");
        broadcast({ type: "leaderboard", leaderboard: getLeaderboard() });
        return Response.json({ ok: true, queuedId: Number(res.lastInsertRowid), queue: getQueue() });
      }
      if (body.mode && ["single", "pinned", "rotation"].includes(body.mode)) {
        config.mode = body.mode;
        if (body.mode === "pinned") config.pinnedModel = modelId;
        saveConfig(config);
      }
      if (typeof body.turnIntervalMs === "number") {
        config.turnIntervalMs = Math.max(5000, Math.min(60000, Math.round(body.turnIntervalMs)));
        saveConfig(config);
      }
      activeContender = makeContender(modelId);
      arenaIdle = false;
      aiPaused = false;
      finishMatchRecord("admin launch", latestState || undefined);
      await mindustryJson("/action", { type: "new_game", map: mapName });
      broadcast({ type: "config", config, meta: getMetaPayload(), leaderboard: getLeaderboard() });
      return Response.json({ ok: true, contender: activeContender, map: mapName, config, meta: getMetaPayload() });
    }

    const adminDeleteMatch = url.pathname.match(/^\/api\/admin\/matches\/(\d+)$/);
    if (adminDeleteMatch && req.method === "DELETE") {
      const id = Number(adminDeleteMatch[1]);
      if (id === activeMatchId) {
        return Response.json({ ok: false, error: "Cannot delete active match — end it first" }, { status: 400 });
      }
      db.prepare("DELETE FROM match_snapshots WHERE match_id = ?").run(id);
      db.prepare("DELETE FROM feed_events WHERE match_id = ?").run(id);
      db.prepare("DELETE FROM matches WHERE id = ?").run(id);
      broadcast({ type: "leaderboard", leaderboard: getLeaderboard() });
      return Response.json({ ok: true, deleted: id });
    }

    const adminDeleteQueue = url.pathname.match(/^\/api\/admin\/queue\/(\d+)$/);
    if (adminDeleteQueue && req.method === "DELETE") {
      const id = Number(adminDeleteQueue[1]);
      db.prepare("DELETE FROM match_queue WHERE id = ?").run(id);
      broadcast({ type: "leaderboard", leaderboard: getLeaderboard() });
      return Response.json({ ok: true, queue: getQueue() });
    }

    if ((url.pathname === "/api/admin/action" || url.pathname === "/api/control") && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as any;
      if (body.action === "pause") {
        aiPaused = true;
        pushFeed("system", "match paused", undefined, "ARENA");
      } else if (body.action === "resume") {
        arenaIdle = false;
        aiPaused = false;
        if (config.mode === "paused") {
          config.mode = "single";
          saveConfig(config);
        }
        pushFeed("system", "match resumed", undefined, "ARENA");
        void runAiTurn();
      } else if (body.action === "go_idle") {
        finishMatchRecord("off-air", latestState || undefined);
        arenaIdle = true;
        aiPaused = true;
        pushFeed("system", "arena set off-air", undefined, "ARENA");
      } else if (body.action === "step") {
        if (!arenaIdle) void runAiTurn(true);
      } else if ((body.action === "set_model" || body.action === "switch_model") && body.model) {
        activeContender = makeContender(String(body.model));
        pushFeed("system", `switched active contender to ${activeContender.id}`, undefined, "ARENA");
      } else if (body.action === "send_wave") {
        if (!arenaIdle) {
          await mindustryJson("/action", { type: "send_wave" });
          pushFeed("system", "sent next wave early", undefined, "ARENA");
        }
      } else if (body.action === "end_match") {
        finishMatchRecord("ended by admin", latestState || undefined);
        await advanceAfterMatchEnd();
      } else if (body.action === "new_match") {
        if (body.model) {
          activeContender = makeContender(String(body.model));
        } else {
          rosterIdx = (rosterIdx + 1) % ROSTER.length;
          activeContender = ROSTER[rosterIdx];
        }
        const nextMap = body.map || MAP_ROTATION[(mapIdx = (mapIdx + 1) % MAP_ROTATION.length)];
        arenaIdle = false;
        aiPaused = false;
        finishMatchRecord("manual reset", latestState || undefined);
        await mindustryJson("/action", { type: "new_game", map: nextMap });
      }
      broadcast({ type: "config", config, meta: getMetaPayload(), leaderboard: getLeaderboard() });
      return Response.json({ ok: true, aiPaused, arenaIdle, contender: activeContender, config, meta: getMetaPayload() });
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

    if (req.method === "GET" || req.method === "HEAD") {
      const asset = await serveWeb(url.pathname);
      if (asset) return asset;
    }

    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      wsClients.add(ws);
      lastSpectatorSeenAt = Date.now();
      ws.send(
        JSON.stringify({
          type: "init",
          terrain: cachedTerrain,
          state: latestState,
          meta: getMetaPayload(),
          config,
          feed: recentFeed.slice(-35),
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
