import { Database } from "bun:sqlite";
import { mkdir, readFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import type { ServerWebSocket } from "bun";
import { createMcpHandler } from "./mcp";
import { factorioRcon } from "./rcon";
import { renderBattlefieldSnapshot } from "./snapshot";

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
  CREATE TABLE IF NOT EXISTS match_interviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    asker TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    latency_ms INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_interviews_match ON match_interviews(match_id, id);
`);

// Safe migrations for existing DBs
for (const col of [
  "ALTER TABLE matches ADD COLUMN turns INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE matches ADD COLUMN avg_latency_ms INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE matches ADD COLUMN prompt_chars INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE matches ADD COLUMN output_chars INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE matches ADD COLUMN end_reason TEXT DEFAULT ''",
  "ALTER TABLE matches ADD COLUMN session_id TEXT DEFAULT ''",
  "ALTER TABLE matches ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE matches ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE matches ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE matches ADD COLUMN cache_write_tokens INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE matches ADD COLUMN compactions INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE matches ADD COLUMN plan_json TEXT DEFAULT '[]'",
  "ALTER TABLE match_snapshots ADD COLUMN plan_json TEXT DEFAULT '[]'",
  "ALTER TABLE match_snapshots ADD COLUMN power_links_json TEXT DEFAULT '[]'",
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
  seq?: number;
  t?: number;
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
  flowRates?: Record<string, number>;
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
    flying?: boolean;
    team: string;
    x: number;
    y: number;
    vx?: number;
    vy?: number;
    hp: number;
    maxHp: number;
    shield?: number;
    rot: number;
  }>;
  bullets: Array<{
    id?: number;
    x: number;
    y: number;
    vx?: number;
    vy?: number;
    rot?: number;
    team: string;
    dmg: number;
    size?: number;
    color?: string;
    kind?: number;
    len?: number;
  }>;
  playerDrone: PlayerDrone | null;
};

type FrameDelta = {
  ready: boolean;
  unchanged?: boolean;
  fullRequired?: boolean;
  seq: number;
  t: number;
  map: string;
  wave: number;
  waveTime: number;
  enemies: number;
  gameOver: boolean;
  paused?: boolean;
  playing: boolean;
  core: { x: number; y: number; hp: number; maxHp: number; block: string } | null;
  items: Record<string, number>;
  flowRates?: Record<string, number>;
  power: { produced: number; consumed: number };
  playerDrone: PlayerDrone | null;
  bAdd: StatePayload["buildings"];
  bDel: Array<[number, number]>;
  bUpd: Array<[number, number, number, number, number]>;
  powerLinks?: Array<[number, number, number, number]>;
  units: Array<[number, string, string, number, number, number, number, number, number, number, number]>;
  bullets: Array<[number, number, number, number, number, number, string, number, number, string, number, number]>;
  beams: Array<[number, number, number, number, number, number, string, number, string]>;
  iPal: string[];
  ci: number[];
};

type PlanGoal = {
  text: string;
  status: "active" | "done" | "blocked";
  x?: number;
  y?: number;
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
let activeSessionId: string | null = null;
let lastSessionDeliveredMsgId: string | null = null;
let currentTurnActions: NonNullable<FeedItem["actions"]> = [];
let currentPlan: PlanGoal[] = [];
let prevTurnItems: Record<string, number> = {};
let prevTurnCoreHp = 0;
let lastSteeredWave = 1;
let lastSteeredCoreHp = 0;
let arenaIdle =
  (db.query("SELECT value FROM settings WHERE key = 'arena_idle'").get() as { value: string } | null)?.value === "true" ||
  config.mode === "paused";
let aiPaused = arenaIdle;

function setArenaIdle(val: boolean): void {
  arenaIdle = val;
  db.prepare("INSERT INTO settings (key, value) VALUES ('arena_idle', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    String(val)
  );
}
let aiBusy = false;
let lastTurnAt = 0;
let lastGameOverAt = 0;
let lastPauseSyncAt = 0;
let pendingNewGame: { seenGameOver: boolean; expiresAt: number } | null = null;
let lastSpectatorSeenAt = Date.now();
let matchBlocksBuilt = 0;
let matchActionsOk = 0;
let matchActionsFail = 0;
let matchPeakWave = 1;
let matchTurns = 0;
let matchTotalLatencyMs = 0;
let matchPromptChars = 0;
let matchOutputChars = 0;
let matchInputTokens = 0;
let matchOutputTokens = 0;
let matchCacheReadTokens = 0;
let matchCacheWriteTokens = 0;
let matchCompactions = 0;
let needsPostCompactionGrounding = false;
let matchSnapshotSeq = 0;
let recentActionFeedback: string[] = [];
let recentFeed: FeedItem[] = [];
const wsClients = new Set<ServerWebSocket<unknown>>();
const interviewLocks = new Set<number>();

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
    tokens: {
      input: matchInputTokens,
      output: matchOutputTokens,
      cacheRead: matchCacheReadTokens,
      cacheWrite: matchCacheWriteTokens,
      cacheHitPct:
        matchInputTokens + matchCacheReadTokens > 0
          ? Math.round((100 * matchCacheReadTokens) / (matchInputTokens + matchCacheReadTokens))
          : 0,
    },
    compactions: matchCompactions,
    plan: currentPlan,
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
      (match_id, seq, ts, kind, wave, enemies, core_hp, core_max_hp, items_json, power_json, buildings_json, units_json, player_drone_json, thought, actions_json, prompt_chars, output_chars, latency_ms, plan_json, power_links_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    extra?.latencyMs ?? 0,
    JSON.stringify(currentPlan),
    JSON.stringify(st.powerLinks || [])
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

async function ocRequest<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const auth = await getOcAuthHeader();
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };
  if (auth) headers.authorization = auth;
  if (init.body && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }
  const resp = await fetch(`${OPENCODE_URL}${path}`, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(90_000),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`OpenCode ${init.method || "GET"} ${path} -> ${resp.status}: ${txt.slice(0, 240)}`);
  }
  const txt = await resp.text();
  return txt ? (JSON.parse(txt) as T) : (undefined as T);
}

async function interruptActiveSession(): Promise<void> {
  if (!activeSessionId) return;
  await ocRequest(`/api/session/${activeSessionId}/interrupt`, {
    method: "POST",
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}

async function ensureMatchSession(mapName: string): Promise<string> {
  if (activeSessionId) {
    try {
      await ocRequest(`/api/session/${activeSessionId}`, { signal: AbortSignal.timeout(5000) });
      return activeSessionId;
    } catch {
      activeSessionId = null;
    }
  }
  const res = await ocRequest<{ data: { id: string } }>("/api/session", {
    method: "POST",
    body: JSON.stringify({
      agent: "arena-player",
      model: parseModelRef(activeContender.id),
      title: `arena #${activeMatchId ?? "?"}: ${activeContender.id} on ${mapName}`,
    }),
  });
  activeSessionId = res.data.id;
  lastSessionDeliveredMsgId = null;
  if (activeMatchId !== null) {
    db.prepare("UPDATE matches SET session_id = ? WHERE id = ?").run(activeSessionId, activeMatchId);
  }
  return activeSessionId;
}

async function switchActiveSessionModel(modelId: string): Promise<void> {
  if (!activeSessionId) return;
  await ocRequest(`/api/session/${activeSessionId}/model`, {
    method: "POST",
    body: JSON.stringify({ model: parseModelRef(modelId) }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}

async function steerActiveSession(text: string): Promise<void> {
  if (!activeSessionId || !aiBusy) return;
  await ocRequest(`/api/session/${activeSessionId}/prompt`, {
    method: "POST",
    body: JSON.stringify({ text, delivery: "steer" }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}

async function getAssistantMessages(sessionID: string): Promise<any[]> {
  const res = await ocRequest<any>(`/api/session/${sessionID}/message`, {
    signal: AbortSignal.timeout(10_000),
  });
  const list: any[] = Array.isArray(res)
    ? res
    : Array.isArray(res?.data)
      ? res.data
      : Array.isArray(res?.messages)
        ? res.messages
        : [];
  return list
    .filter((m) => m?.type === "assistant")
    .sort((a, b) => (a?.time?.created ?? 0) - (b?.time?.created ?? 0));
}

async function readNewAssistantText(sessionID: string): Promise<{ text: string; outputChars: number }> {
  const assistants = await getAssistantMessages(sessionID);

  let start = 0;
  if (lastSessionDeliveredMsgId) {
    const idx = assistants.findIndex((m) => m.id === lastSessionDeliveredMsgId);
    if (idx >= 0) start = idx + 1;
  }
  const fresh = assistants.slice(start);
  const texts: string[] = [];
  let outputChars = 0;
  for (const m of fresh) {
    for (const part of m.content || []) {
      if (part?.type === "text" && part.text) {
        texts.push(String(part.text).trim());
        outputChars += String(part.text).length;
      } else if (part?.type === "tool") {
        outputChars += JSON.stringify(part.input ?? part.args ?? "").length;
      }
    }
    lastSessionDeliveredMsgId = m.id;
  }
  return { text: texts.join(" ").replace(/\s+/g, " ").trim(), outputChars };
}

type InterviewRow = {
  id: number;
  match_id: number;
  ts: number;
  asker: string;
  question: string;
  answer: string;
  latency_ms: number;
};

function getMatchInterviews(matchId: number) {
  const rows = db
    .query(
      "SELECT id, match_id, ts, asker, question, answer, latency_ms FROM match_interviews WHERE match_id = ? ORDER BY id ASC"
    )
    .all(matchId) as InterviewRow[];
  return rows.map((r) => ({
    id: r.id,
    matchId: r.match_id,
    ts: r.ts,
    asker: r.asker,
    question: r.question,
    answer: r.answer,
    latencyMs: r.latency_ms,
  }));
}

async function runMatchInterview(matchId: number, question: string, asker: string) {
  const cleanQ = question.trim().slice(0, 600);
  if (!cleanQ) throw new Error("question is empty");
  if (interviewLocks.has(matchId)) throw new Error("an interview question is already in progress for this match");

  const match = db
    .query("SELECT id, model, map, peak_wave, turns, blocks_built, status, end_reason, session_id FROM matches WHERE id = ?")
    .get(matchId) as any;
  if (!match) throw new Error("match not found");
  if (!match.session_id) throw new Error("this match predates persistent OpenCode sessions and cannot be interviewed");
  if (match.status === "playing" && matchId === activeMatchId) {
    throw new Error("wait until the match finishes before interviewing");
  }

  const sid = String(match.session_id);
  interviewLocks.add(matchId);
  const t0 = Date.now();
  try {
    const before = await getAssistantMessages(sid);
    const prevLastId = before.length > 0 ? before[before.length - 1].id : null;

    const prompt = [
      `[post-match interview — match #${match.id} on ${match.map} has ended at wave ${match.peak_wave} (${match.end_reason || "finished"}). do not call any mindustry tools; the match is over and a different map may be loaded on the server. answer the interviewer directly in your own voice, naturally and concisely in lowercase, no emojis.]`,
      `interviewer (${asker}): ${cleanQ}`,
    ].join("\n\n");

    await ocRequest(`/api/session/${sid}/prompt`, {
      method: "POST",
      body: JSON.stringify({ text: prompt, delivery: "queue" }),
    });
    await ocRequest(`/api/experimental/session/${sid}/wait`, {
      method: "POST",
      signal: AbortSignal.timeout(90_000),
    });

    const after = await getAssistantMessages(sid);
    const startIdx = prevLastId ? after.findIndex((m) => m.id === prevLastId) + 1 : 0;
    const fresh = after.slice(Math.max(0, startIdx));
    const parts: string[] = [];
    for (const m of fresh) {
      for (const p of m.content || []) {
        if (p?.type === "text" && p.text) parts.push(String(p.text).trim());
      }
    }
    const answer = parts.join("\n\n").trim() || "(no reply)";
    const latencyMs = Date.now() - t0;
    const ts = Date.now();
    const res = db
      .prepare(
        "INSERT INTO match_interviews (match_id, ts, asker, question, answer, latency_ms) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(matchId, ts, asker, cleanQ, answer, latencyMs);

    const item = {
      id: Number(res.lastInsertRowid),
      matchId,
      ts,
      asker,
      question: cleanQ,
      answer,
      latencyMs,
    };
    broadcast({ type: "interview", matchId, item });
    return item;
  } finally {
    interviewLocks.delete(matchId);
  }
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
  void interruptActiveSession();
  activeSessionId = null;
  lastSessionDeliveredMsgId = null;
  currentTurnActions = [];
  currentPlan = [];
  broadcast({ type: "plan", plan: currentPlan });
  prevTurnItems = { ...(st?.items || {}) };
  prevTurnCoreHp = st?.core?.hp ?? 0;
  lastSteeredWave = st?.wave ?? 1;
  lastSteeredCoreHp = st?.core?.hp ?? 0;
  matchBlocksBuilt = 0;
  matchActionsOk = 0;
  matchActionsFail = 0;
  matchPeakWave = 1;
  matchTurns = 0;
  matchTotalLatencyMs = 0;
  matchPromptChars = 0;
  matchOutputChars = 0;
  matchInputTokens = 0;
  matchOutputTokens = 0;
  matchCacheReadTokens = 0;
  matchCacheWriteTokens = 0;
  matchCompactions = 0;
  needsPostCompactionGrounding = false;
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
    "UPDATE matches SET ended_at = ?, peak_wave = ?, blocks_built = ?, actions_ok = ?, actions_fail = ?, turns = ?, avg_latency_ms = ?, prompt_chars = ?, output_chars = ?, input_tokens = ?, output_tokens = ?, cache_read_tokens = ?, cache_write_tokens = ?, compactions = ?, status = 'completed', end_reason = ? WHERE id = ?"
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
    matchInputTokens,
    matchOutputTokens,
    matchCacheReadTokens,
    matchCacheWriteTokens,
    matchCompactions,
    reason,
    activeMatchId
  );
  pushFeed(
    "milestone",
    `match #${activeMatchId} ended (${reason}) — ${activeContender.label} reached wave ${matchPeakWave} with ${matchBlocksBuilt} blocks built`,
    undefined,
    "ARENA"
  );
  const endedId = activeMatchId;
  const endedSessionId = activeSessionId;
  const endedTurns = matchTurns;
  const endedWave = matchPeakWave;
  void interruptActiveSession();
  activeSessionId = null;
  lastSessionDeliveredMsgId = null;
  activeMatchId = null;

  // Automatic post-match debrief while the session's prompt cache is still hot
  if (reason === "core destroyed" && endedId !== null && endedSessionId && endedTurns >= 3) {
    setTimeout(() => {
      void runMatchInterview(
        endedId,
        `your run just ended on wave ${endedWave} (core destroyed). quick post-match debrief: how did that feel, what part of the base were you proudest of, and what finally broke through? (3-4 short sentences)`,
        "post-match debrief"
      ).catch((err) => console.error(`auto debrief failed for match #${endedId}:`, err));
    }, 2500);
  }
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
              avg_latency_ms, prompt_chars, output_chars,
              input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, compactions,
              plan_json, session_id, status, end_reason, last_thought
       FROM matches WHERE id = ?`
    )
    .get(matchId) as any;
  if (!match) return null;
  try {
    match.plan = JSON.parse(match.plan_json || "[]");
  } catch {
    match.plan = [];
  }

  const rawSnaps = db
    .query(
      `SELECT id, seq, ts, kind, wave, enemies, core_hp, core_max_hp,
              items_json, power_json, buildings_json, units_json, player_drone_json,
              thought, actions_json, prompt_chars, output_chars, latency_ms, plan_json, power_links_json
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
    const plan = s.plan_json ? JSON.parse(s.plan_json) : [];
    const powerLinks = s.power_links_json ? JSON.parse(s.power_links_json) : [];
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
      plan,
      powerLinks,
      promptChars: s.prompt_chars,
      outputChars: s.output_chars,
      latencyMs: s.latency_ms,
    };
  });

  // Compact LoL-style economy & threat curve for charts
  const timeline = snapshots.map((s) => {
    const friendly = s.buildings.filter((b: any) => b.team === "sharded");
    const turrets = friendly.filter((b: any) => TURRET_BLOCKS.has(b.block));
    const armedTurrets = turrets.filter((b: any) => (b.ammo || 0) > 0 || NON_ITEM_TURRETS.has(b.block));
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
  const interviews = getMatchInterviews(matchId);

  return {
    match,
    hasTerrain: Boolean(terrainRow),
    canInterview: Boolean(match.session_id && match.status === "completed"),
    interviews,
    snapshots,
    timeline,
  };
}

const TURRET_BLOCKS = new Set([
  "duo",
  "scatter",
  "scorch",
  "hail",
  "wave",
  "lancer",
  "arc",
  "parallax",
  "swarmer",
  "salvo",
  "segment",
  "tsunami",
  "fuse",
  "ripple",
  "cyclone",
  "foreshadow",
  "spectre",
  "meltdown",
]);

const NON_ITEM_TURRETS = new Set([
  "arc",
  "lancer",
  "meltdown",
  "parallax",
  "segment",
  "wave",
  "tsunami",
]);

const TRACKED_ITEMS = [
  "copper",
  "lead",
  "metaglass",
  "graphite",
  "coal",
  "titanium",
  "thorium",
  "silicon",
  "plastanium",
  "phase-fabric",
  "surge-alloy",
  "pyratite",
  "blast-compound",
];

function compassDirection(fromX: number, fromY: number, toX: number, toY: number): string {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.round(Math.hypot(dx, dy));
  const ns = dy > 8 ? "N" : dy < -8 ? "S" : "";
  const ew = dx > 8 ? "E" : dx < -8 ? "W" : "";
  return `${ns}${ew || (ns ? "" : "HERE")} (${dist} tiles)`;
}

function buildOverviewPayload(state: StatePayload) {
  const core = state.core;
  const spawns = (state.spawns || []).map((s) => ({
    x: s.x,
    y: s.y,
    fromCore: core ? compassDirection(core.x, core.y, s.x, s.y) : "",
  }));
  const friendly = (state.buildings || []).filter((b) => b.team === "sharded");
  const counts: Record<string, number> = {};
  for (const b of friendly) counts[b.block] = (counts[b.block] || 0) + 1;

  const turrets = friendly.filter((b) => TURRET_BLOCKS.has(b.block));
  const dryTurrets = turrets.filter((t) => t.ammo === 0 && !NON_ITEM_TURRETS.has(t.block)).map((t) => ({
    block: t.block,
    x: t.x,
    y: t.y,
  }));
  const armedTurrets = turrets
    .filter((t) => t.ammo > 0 || NON_ITEM_TURRETS.has(t.block))
    .map((t) => ({ block: t.block, x: t.x, y: t.y, ammo: t.ammo }));

  const enemies = (state.units || [])
    .filter((u) => u.team !== "sharded")
    .slice(0, 20)
    .map((u) => ({ type: u.type, flying: Boolean(u.flying), x: u.x, y: u.y, hp: u.hp, maxHp: u.maxHp }));

  const friendlyUnits: Record<string, number> = {};
  const droneId = state.playerDrone?.id ?? -1;
  for (const u of state.units || []) {
    if (u.team === "sharded" && u.id !== droneId) {
      friendlyUnits[u.type] = (friendlyUnits[u.type] || 0) + 1;
    }
  }

  return {
    map: state.map,
    width: state.width,
    height: state.height,
    wave: state.wave,
    waveTimeSec: state.waveTime,
    enemiesCount: state.enemies,
    enemiesSample: enemies,
    friendlyUnits,
    core: core
      ? {
          x: core.x,
          y: core.y,
          hp: core.hp,
          maxHp: core.maxHp,
          block: core.block,
          footprint: `x=${core.x - 1}..${core.x + 1}, y=${core.y - 1}..${core.y + 1}`,
        }
      : null,
    playerDrone: state.playerDrone,
    spawns,
    items: state.items,
    flowRates: state.flowRates || {},
    power: state.power,
    buildingCounts: counts,
    armedTurrets: armedTurrets.slice(0, 20),
    dryTurrets: dryTurrets.slice(0, 20),
  };
}

function recordMcpAction(label: string, res: { ok: boolean; built?: number; error?: string }, isBuild = false): void {
  if (res.ok) {
    matchActionsOk++;
    matchBlocksBuilt += res.built || (isBuild ? 1 : 0);
    currentTurnActions.push({ label, ok: true });
  } else {
    matchActionsFail++;
    currentTurnActions.push({ label, ok: false, error: res.error });
  }
}

const handleMcp = createMcpHandler([
  {
    name: "overview",
    description:
      "Get current Mindustry match status: map dimensions, wave, countdown, enemies, core HP/coords, resources, power, building counts, armed vs dry turrets, spawns, and builder drone.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => {
      const st = await mindustryJson<StatePayload>("/state");
      if (!st.ready) return { ready: false };
      return buildOverviewPayload(st);
    },
  },
  {
    name: "scan",
    description:
      "Scan ANY region of the map as a coordinate-labeled ASCII grid (radius 6..22, up to 45x45 tiles; C core, D drill, T turret, W wall, >^<v conveyor, = conduit, L pump/liquid block, + router/junction/sorter/gate, P power/generator/reactor, B other building, E enemy, A builder ship, c/l/k/s/t/h/r ores, ~ liquid floor, # rock wall, . open) plus enemies in view.",
    inputSchema: {
      type: "object",
      properties: {
        cx: { type: "integer", description: "Center X tile coordinate (defaults to core X)" },
        cy: { type: "integer", description: "Center Y tile coordinate (defaults to core Y)" },
        radius: { type: "integer", description: "Half-width in tiles (6 to 22, default 16)" },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const qs = new URLSearchParams();
      if (args.cx !== undefined) qs.set("cx", String(Math.round(Number(args.cx))));
      if (args.cy !== undefined) qs.set("cy", String(Math.round(Number(args.cy))));
      if (args.radius !== undefined) qs.set("r", String(Math.round(Number(args.radius))));
      return await mindustryJson(`/scan?${qs.toString()}`);
    },
  },
  {
    name: "inspect",
    description:
      "Inspect a single map tile (x, y) like hovering it in Mindustry: returns floor/liquid/ore terrain info and, if a building occupies that tile, its exact block type, origin, rotation, HP, efficiency, internal item buffer, internal liquid buffer & capacity, power graph satisfaction/balance/links, turret ammo, configurable flag, and current configuration.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "integer", description: "Tile X coordinate" },
        y: { type: "integer", description: "Tile Y coordinate" },
      },
      required: ["x", "y"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const x = Math.round(Number(args.x));
      const y = Math.round(Number(args.y));
      return await mindustryJson(`/inspect?x=${x}&y=${y}`);
    },
  },
  {
    name: "find_ores",
    description:
      "Find guaranteed-valid 2x2 mechanical-drill coordinates for ores (copper, lead, coal, sand, titanium, thorium, scrap) near any (cx, cy) on the map, pre-verified with Build.validPlace.",
    inputSchema: {
      type: "object",
      properties: {
        ore: { type: "string", description: "Optional single ore name (e.g. 'copper', 'lead', 'coal', 'titanium'); omit for all ores" },
        cx: { type: "integer", description: "Search center X (defaults to core X)" },
        cy: { type: "integer", description: "Search center Y (defaults to core Y)" },
        radius: { type: "integer", description: "Search radius in tiles (8..90, default 55)" },
        limit: { type: "integer", description: "Max drill sites per ore (1..12, default 6)" },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const qs = new URLSearchParams();
      if (args.ore) qs.set("ore", String(args.ore));
      if (args.cx !== undefined) qs.set("cx", String(Math.round(Number(args.cx))));
      if (args.cy !== undefined) qs.set("cy", String(Math.round(Number(args.cy))));
      if (args.radius !== undefined) qs.set("r", String(Math.round(Number(args.radius))));
      if (args.limit !== undefined) qs.set("limit", String(Math.round(Number(args.limit))));
      return await mindustryJson(`/ores?${qs.toString()}`);
    },
  },
  {
    name: "build",
    description:
      "Place one block at (x, y) with optional rotation rot (0=East/+x, 1=North/+y, 2=West/-x, 3=South/-y). Deducts real core resources.",
    inputSchema: {
      type: "object",
      properties: {
        block: { type: "string", description: "Exact Mindustry block id (e.g. mechanical-drill, conveyor, router, duo, scatter, scorch, copper-wall, power-node, combustion-generator, arc, graphite-press)" },
        x: { type: "integer" },
        y: { type: "integer" },
        rot: { type: "integer", description: "0=East, 1=North, 2=West, 3=South (default 0)" },
      },
      required: ["block", "x", "y"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const x = Math.round(Number(args.x));
      const y = Math.round(Number(args.y));
      const rot = Math.round(Number(args.rot ?? 0));
      const block = String(args.block || "");
      const res = await mindustryJson<{ ok: boolean; built?: number; error?: string }>("/action", {
        type: "build",
        block,
        x,
        y,
        rot,
      });
      recordMcpAction(`${block} @(${x},${y})`, res, true);
      return res;
    },
  },
  {
    name: "build_line",
    description:
      "Build a straight or L-shaped line of conveyors, walls, or bridges from (x1, y1) to (x2, y2) with automatic conveyor rotation along the path.",
    inputSchema: {
      type: "object",
      properties: {
        block: { type: "string", description: "Block id (default 'conveyor', or 'copper-wall', 'titanium-conveyor', etc.)" },
        x1: { type: "integer" },
        y1: { type: "integer" },
        x2: { type: "integer" },
        y2: { type: "integer" },
      },
      required: ["x1", "y1", "x2", "y2"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const block = String(args.block || "conveyor");
      const x1 = Math.round(Number(args.x1));
      const y1 = Math.round(Number(args.y1));
      const x2 = Math.round(Number(args.x2));
      const y2 = Math.round(Number(args.y2));
      const res = await mindustryJson<{ ok: boolean; built?: number; skipped?: number; error?: string }>("/action", {
        type: "build_line",
        block,
        x1,
        y1,
        x2,
        y2,
      });
      recordMcpAction(`${block} (${x1},${y1})→(${x2},${y2})`, res, false);
      return res;
    },
  },
  {
    name: "catalog",
    description:
      "Query Mindustry's live block registry for exact build costs, sizes, HP, configurable flag, turret range/air-ground targeting/ammo types, and drill tier/speed. Filter by category (turret, production, distribution, liquid, defense, power, crafting, units, effect) or name substring.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Optional category: turret, production, distribution, liquid, defense, power, crafting, units, effect" },
        name: { type: "string", description: "Optional block name substring (e.g. 'scatter', 'graphite', 'arc')" },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const qs = new URLSearchParams();
      if (args.category) qs.set("category", String(args.category));
      if (args.name) qs.set("name", String(args.name));
      return await mindustryJson(`/catalog?${qs.toString()}`);
    },
  },
  {
    name: "route_belt",
    description:
      "Route a 1x1 conveyor (or wall/bridge) around rocks and buildings using shortest-path BFS from (x1, y1) to (x2, y2). Still spends real core resources per tile. Supports dry_run=true to preview the path and length first.",
    inputSchema: {
      type: "object",
      properties: {
        block: { type: "string", description: "1x1 block id (default 'conveyor', or 'titanium-conveyor', 'armored-conveyor')" },
        x1: { type: "integer" },
        y1: { type: "integer" },
        x2: { type: "integer" },
        y2: { type: "integer" },
        max_len: { type: "integer", description: "Max belt tiles allowed (2..80, default 50)" },
        dry_run: { type: "boolean", description: "If true, returns the planned path without spending copper or placing blocks" },
      },
      required: ["x1", "y1", "x2", "y2"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const block = String(args.block || "conveyor");
      const x1 = Math.round(Number(args.x1));
      const y1 = Math.round(Number(args.y1));
      const x2 = Math.round(Number(args.x2));
      const y2 = Math.round(Number(args.y2));
      const maxLen = args.max_len !== undefined ? Math.round(Number(args.max_len)) : 50;
      const dryRun = Boolean(args.dry_run);
      const res = await mindustryJson<{ ok: boolean; built?: number; length?: number; error?: string }>("/action", {
        type: "route_belt",
        block,
        x1,
        y1,
        x2,
        y2,
        maxLen,
        dryRun,
      });
      if (!dryRun) {
        recordMcpAction(`route ${block} (${x1},${y1})→(${x2},${y2})`, res, false);
      }
      return res;
    },
  },
  {
    name: "configure",
    description:
      "Configure a friendly building at (x, y): set an item (unloader/sorter), liquid, unit plan (unit factories), MLOG processor code (micro-processor/logic-processor/hyper-processor), message text, switch enabled state, factory/reconstructor default unit command, link/rally target (bridge, mass-driver, power-node, logic processor building link, or factory/reconstructor rally point) via target_x+target_y, or clear=true.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "integer", description: "Building tile X" },
        y: { type: "integer", description: "Building tile Y" },
        item: { type: "string", description: "Item name for unloaders/sorters (e.g. 'copper', 'graphite', 'titanium', 'silicon')" },
        liquid: { type: "string", description: "Liquid name for liquid-configurable blocks (e.g. 'water', 'cryofluid', 'oil')" },
        unit: { type: "string", description: "Unit type name for unit factories (e.g. 'dagger', 'nova', 'flare', 'mono')" },
        code: { type: "string", description: "MLOG source code for micro-processor, logic-processor, or hyper-processor" },
        text: { type: "string", description: "Text for a message block" },
        enabled: { type: "boolean", description: "On/off state for a switch block" },
        command: { type: "string", description: "Default unit command for a unit factory or reconstructor ('move', 'repair', 'rebuild', 'assist', 'mine')" },
        target_x: { type: "integer", description: "Target tile X for bridge, mass-driver, power-node link toggle, logic processor building link toggle, or factory/reconstructor rally point" },
        target_y: { type: "integer", description: "Target tile Y for bridge, mass-driver, power-node link toggle, logic processor building link toggle, or factory/reconstructor rally point" },
        clear: { type: "boolean", description: "If true, clear/unlink this building's configuration" },
      },
      required: ["x", "y"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const x = Math.round(Number(args.x));
      const y = Math.round(Number(args.y));
      const payload: Record<string, unknown> = { type: "configure", x, y };
      if (args.clear) payload.clear = true;
      if (args.item !== undefined) payload.item = String(args.item);
      if (args.liquid !== undefined) payload.liquid = String(args.liquid);
      if (args.unit !== undefined) payload.unit = String(args.unit);
      if (args.code !== undefined) payload.code = String(args.code);
      if (args.text !== undefined) payload.text = String(args.text);
      if (args.enabled !== undefined) payload.enabled = Boolean(args.enabled);
      if (args.command !== undefined) payload.command = String(args.command);
      if (args.target_x !== undefined && args.target_y !== undefined) {
        payload.targetX = Math.round(Number(args.target_x));
        payload.targetY = Math.round(Number(args.target_y));
      }
      const res = await mindustryJson<{ ok: boolean; block?: string; error?: string }>("/action", payload);
      const val = args.clear
        ? "clear"
        : args.code !== undefined
          ? `mlog(${String(args.code).split(/\r?\n/).length}L)`
          : args.item
            ? String(args.item)
            : args.liquid
              ? String(args.liquid)
              : args.unit
                ? String(args.unit)
                : args.command
                  ? String(args.command)
                  : args.enabled !== undefined
                    ? String(Boolean(args.enabled))
                    : args.text !== undefined
                      ? "text"
                      : args.target_x !== undefined
                        ? `→(${Math.round(Number(args.target_x))},${Math.round(Number(args.target_y))})`
                        : "";
      recordMcpAction(`cfg ${res.block || "block"}@(${x},${y}) ${val}`.trim(), res, false);
      return res;
    },
  },
  {
    name: "command_units",
    description:
      "Issue RTS commands to your built friendly units (excludes your core builder ship, which uses `ship`). Filter by unit_type (e.g. 'dagger', 'flare', 'poly', 'mega', 'zenith', or 'all') and send them to a rally tile (x, y), focus-fire near (x, y) with attack=true, and/or switch their unit command ('move', 'repair', 'rebuild', 'assist', 'mine').",
    inputSchema: {
      type: "object",
      properties: {
        unit_type: { type: "string", description: "Friendly unit type to command (e.g. 'poly', 'flare', 'zenith', or 'all'; default 'all')" },
        x: { type: "integer", description: "Target or rally tile X" },
        y: { type: "integer", description: "Target or rally tile Y" },
        command: { type: "string", description: "Optional unit command/role: 'move', 'repair', 'rebuild', 'assist', 'mine'" },
        attack: { type: "boolean", description: "If true, focus-fire an enemy unit or building near (x, y) instead of moving passively" },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const payload: Record<string, unknown> = { type: "command_units" };
      if (args.unit_type !== undefined) payload.unitType = String(args.unit_type);
      if (args.x !== undefined && args.y !== undefined) {
        payload.x = Math.round(Number(args.x));
        payload.y = Math.round(Number(args.y));
      }
      if (args.command !== undefined) payload.command = String(args.command);
      if (args.attack !== undefined) payload.attack = Boolean(args.attack);
      const res = await mindustryJson<{ ok: boolean; commanded?: number; error?: string }>("/action", payload);
      const ut = args.unit_type ? String(args.unit_type) : "all";
      const target =
        args.x !== undefined && args.y !== undefined
          ? `→(${Math.round(Number(args.x))},${Math.round(Number(args.y))})`
          : "";
      const cmd = args.command ? ` ${args.command}` : "";
      recordMcpAction(`units ${ut}${cmd}${target}`, res, false);
      return res;
    },
  },
  {
    name: "demolish",
    description: "Remove a friendly non-core building at (x, y) and refund 50% of its items.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "integer" },
        y: { type: "integer" },
      },
      required: ["x", "y"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const x = Math.round(Number(args.x));
      const y = Math.round(Number(args.y));
      const res = await mindustryJson<{ ok: boolean; error?: string }>("/action", {
        type: "demolish",
        x,
        y,
      });
      recordMcpAction(`demolish @(${x},${y})`, res, false);
      return res;
    },
  },
  {
    name: "set_plan",
    description:
      "Update your high-level plan board (allows up to 8 short items). Each item has text, optional status ('active' | 'done' | 'blocked'), and optional map tile coordinates (x, y). Persists across turns and survives compaction.",
    inputSchema: {
      type: "object",
      properties: {
        goals: {
          type: "array",
          maxItems: 8,
          items: {
            type: "object",
            properties: {
              text: { type: "string", description: "Short 1-line goal description (<= 120 chars)" },
              status: { type: "string", enum: ["active", "done", "blocked"] },
              x: { type: "integer", description: "Optional map X coordinate associated with this goal" },
              y: { type: "integer", description: "Optional map Y coordinate associated with this goal" },
            },
            required: ["text"],
            additionalProperties: false,
          },
        },
      },
      required: ["goals"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const raw = Array.isArray(args.goals) ? args.goals : [];
      const next: PlanGoal[] = [];
      for (const item of raw.slice(0, 8)) {
        if (!item || typeof item !== "object") continue;
        const text = String(item.text || "").replace(/\s+/g, " ").trim().slice(0, 120);
        if (!text) continue;
        const stRaw = String(item.status || "active");
        const status: PlanGoal["status"] =
          stRaw === "done" || stRaw === "blocked" ? stRaw : "active";
        const goal: PlanGoal = { text, status };
        if (typeof item.x === "number" && Number.isFinite(item.x) && typeof item.y === "number" && Number.isFinite(item.y)) {
          goal.x = Math.round(item.x);
          goal.y = Math.round(item.y);
        }
        next.push(goal);
      }
      currentPlan = next;
      if (activeMatchId !== null) {
        db.prepare("UPDATE matches SET plan_json = ? WHERE id = ?").run(JSON.stringify(currentPlan), activeMatchId);
      }
      broadcast({ type: "plan", plan: currentPlan });
      return { ok: true, count: currentPlan.length, goals: currentPlan };
    },
  },
  {
    name: "snapshot",
    description:
      "Render an on-demand PNG visual image of the battlefield using the real Mindustry sprites, with optional coordinate rulers, turret firing ranges, power beams, ore overlays, labels, and custom framing ('base' | 'whole_map' | 'spawn_to_core' | 'region').",
    inputSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["base", "whole_map", "spawn_to_core", "region"],
          description: "Camera framing: 'base' (auto-fits your buildings), 'whole_map' (entire map), 'spawn_to_core' (core + enemy spawns), or 'region' (custom cx, cy, radius)",
        },
        cx: { type: "integer", description: "Center X tile (used when mode='region', defaults to core X)" },
        cy: { type: "integer", description: "Center Y tile (used when mode='region', defaults to core Y)" },
        radius: { type: "integer", description: "Half-width in tiles for mode='region' (8..90, default 28)" },
        width: { type: "integer", description: "Max output PNG width in pixels (320..1280, default 768)" },
        grid: { type: "boolean", description: "Draw coordinate ruler margins and gridlines (default true)" },
        ranges: { type: "boolean", description: "Draw translucent turret firing range rings (default false)" },
        labels: { type: "boolean", description: "Draw CORE and SPAWN tags (default true)" },
        ores: { type: "boolean", description: "Render ore veins (default true)" },
        power: { type: "boolean", description: "Render power link beams (default true)" },
        enemies: { type: "boolean", description: "Render enemy units (default true)" },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const st = await mindustryJson<StatePayload>("/state");
      if (!st.ready) return { ok: false, error: "game not ready" };
      if (!cachedTerrain || cachedTerrain.map !== st.map) {
        cachedTerrain = await mindustryJson<TerrainPayload>("/terrain");
      }
      const rendered = await renderBattlefieldSnapshot(cachedTerrain, st, SPRITES_DIR, {
        mode: args.mode,
        cx: args.cx,
        cy: args.cy,
        radius: args.radius,
        width: args.width,
        grid: args.grid,
        ranges: args.ranges,
        labels: args.labels,
        ores: args.ores,
        power: args.power,
        enemies: args.enemies,
      });
      return {
        _mcpContent: [
          { type: "image", data: rendered.pngBase64, mimeType: "image/png" },
          { type: "text", text: rendered.summary },
        ],
      };
    },
  },
  {
    name: "ship",
    description:
      "Control your core builder ship (alpha/beta/gamma). Default mode is 'idle' (passive, orbits core safely, does not shoot). Modes: 'idle' (passive), 'move' (fly passively to x,y), 'defend' (enable weapons and guard around x,y or core at standoff range), 'mine' (hand-mine ore such as 'copper' or 'lead' into the core).",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["idle", "move", "defend", "mine"] },
        x: { type: "integer", description: "Target tile X (required for 'move', optional anchor for 'defend')" },
        y: { type: "integer", description: "Target tile Y (required for 'move', optional anchor for 'defend')" },
        ore: { type: "string", description: "Ore name for 'mine' mode (e.g. 'copper' or 'lead', default 'copper')" },
      },
      required: ["mode"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const mode = String(args.mode || "idle");
      const payload: Record<string, unknown> = { type: "ship", mode };
      if (args.x !== undefined) payload.x = Math.round(Number(args.x));
      if (args.y !== undefined) payload.y = Math.round(Number(args.y));
      if (args.ore !== undefined) payload.ore = String(args.ore);
      const res = await mindustryJson<{ ok: boolean; mode?: string; error?: string }>("/action", payload);
      const suffix =
        mode === "mine"
          ? ` ${args.ore || "copper"}`
          : args.x !== undefined && args.y !== undefined
            ? ` @(${Math.round(Number(args.x))},${Math.round(Number(args.y))})`
            : "";
      recordMcpAction(`ship ${mode}${suffix}`, res, false);
      return res;
    },
  },
  {
    name: "send_wave",
    description: "Trigger the next enemy wave immediately.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => {
      const res = await mindustryJson<{ ok: boolean; wave?: number; error?: string }>("/action", {
        type: "send_wave",
      });
      recordMcpAction("send_wave", res, false);
      return res;
    },
  },
]);

async function buildPostCompactionGrounding(st: StatePayload): Promise<string> {
  const core = st.core;
  const spawns = (st.spawns || [])
    .map((s) => `(${s.x},${s.y}) ${core ? compassDirection(core.x, core.y, s.x, s.y) : ""}`)
    .join(", ");
  const friendly = (st.buildings || []).filter((b) => b.team === "sharded");
  const keyBuildings = friendly
    .filter((b) => !b.block.includes("conveyor") && !b.block.includes("wall"))
    .slice(0, 50)
    .map((b) => `${b.block}@(${b.x},${b.y})${b.ammo > 0 ? `[ammo:${b.ammo}]` : ""}`)
    .join(", ");
  const scan = await mindustryJson<any>("/scan?r=16").catch(() => null);
  const planLines =
    currentPlan.length > 0
      ? `your saved plan:\n${currentPlan
          .map((g) => `- [${g.status}] ${g.text}${g.x !== undefined && g.y !== undefined ? ` @(${g.x},${g.y})` : ""}`)
          .join("\n")}`
      : "";
  return [
    `[post-compaction re-grounding] your earlier conversation was compacted. here is the exact live state of your base on ${st.map} (${st.width}x${st.height}):`,
    `core: (${core?.x},${core?.y}) ${core?.hp}/${core?.maxHp} hp | spawns: ${spawns || "unknown"}`,
    `key structures (${friendly.length} total buildings): ${keyBuildings || "core only"}`,
    planLines,
    scan?.ascii
      ? `33x33 scan around core (x=${scan.bounds?.minX}..${scan.bounds?.maxX}, y=${scan.bounds?.minY}..${scan.bounds?.maxY}):\n${scan.ascii}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatDeltaPrompt(st: StatePayload, isFirstTurn: boolean): string {
  const core = st.core;
  const spawns = (st.spawns || [])
    .map((s) => `(${s.x},${s.y}) ${core ? compassDirection(core.x, core.y, s.x, s.y) : ""}`)
    .join(", ");
  const friendly = (st.buildings || []).filter((b) => b.team === "sharded");
  const turrets = friendly.filter((b) => TURRET_BLOCKS.has(b.block));
  const armed = turrets.filter((t) => t.ammo > 0 || NON_ITEM_TURRETS.has(t.block)).length;
  const dry = turrets.length - armed;
  const airEnemies = (st.units || []).filter((u) => u.team !== "sharded" && u.flying).length;

  if (isFirstTurn) {
    return [
      `match #${activeMatchId} started on ${st.map} (${st.width}x${st.height}).`,
      `core: (${core?.x},${core?.y}) ${core?.hp}/${core?.maxHp} hp | spawns: ${spawns || "unknown"} | starting items: ${JSON.stringify(st.items)}.`,
      `scout the map with tools.mindustry.* inside execute, plan your build, and begin defending your core.`,
    ].join("\n");
  }

  const flows = st.flowRates || {};
  const itemDeltas = TRACKED_ITEMS
    .filter((k) => (st.items[k] || 0) > 0 || (prevTurnItems[k] || 0) > 0 || (flows[k] || 0) > 0)
    .map((k) => {
      const cur = st.items[k] || 0;
      const diff = cur - (prevTurnItems[k] || 0);
      const rate = flows[k] ? `, ${flows[k]}/s` : "";
      return `${k}=${cur}${diff !== 0 || rate ? `(${diff >= 0 ? "+" : ""}${diff}${rate})` : ""}`;
    })
    .join(" ");

  const hpDiff = (core?.hp ?? 0) - prevTurnCoreHp;
  const hpNote = hpDiff !== 0 ? ` (${hpDiff > 0 ? "+" : ""}${hpDiff})` : "";
  const airNote = airEnemies > 0 ? ` (${airEnemies} AIR)` : "";

  return `[tick] wave ${st.wave} (next in ${Math.ceil(st.waveTime)}s) | enemies: ${st.enemies}${airNote} | core: ${core?.hp ?? 0}/${core?.maxHp ?? 0}${hpNote} | ${itemDeltas || "items: none"} | power: +${st.power.produced}/-${st.power.consumed} | turrets: ${armed} armed, ${dry} dry. take your next tactical move (or pass briefly if saving resources).`;
}

async function runAiTurn(force = false): Promise<void> {
  if ((!force && (aiPaused || arenaIdle)) || aiBusy || !latestState || !latestState.ready || latestState.gameOver || !latestState.core) {
    return;
  }
  aiBusy = true;
  lastTurnAt = Date.now();
  currentTurnActions = [];
  const t0 = Date.now();
  const isFirstTurn = matchTurns === 0;
  try {
    const sid = await ensureMatchSession(latestState.map);
    if (!lastSessionDeliveredMsgId && matchTurns > 0) {
      await readNewAssistantText(sid).catch(() => {});
    }
    let prompt = formatDeltaPrompt(latestState, isFirstTurn);
    if (!isFirstTurn && needsPostCompactionGrounding) {
      needsPostCompactionGrounding = false;
      const grounding = await buildPostCompactionGrounding(latestState);
      prompt = `${grounding}\n\n${prompt}`;
    }
    prevTurnItems = { ...(latestState.items || {}) };
    prevTurnCoreHp = latestState.core.hp;

    await ocRequest(`/api/session/${sid}/prompt`, {
      method: "POST",
      body: JSON.stringify({ text: prompt, delivery: "queue" }),
    });
    await ocRequest(`/api/experimental/session/${sid}/wait`, {
      method: "POST",
      signal: AbortSignal.timeout(90_000),
    });

    const latencyMs = Date.now() - t0;
    const { text: rawThought, outputChars } = await readNewAssistantText(sid);
    const thought = (rawThought || (currentTurnActions.length > 0 ? "executed build order." : "holding position.")).slice(0, 360);
    const actionsSnapshot = [...currentTurnActions];

    matchTurns++;
    matchTotalLatencyMs += latencyMs;
    matchPromptChars += prompt.length;
    matchOutputChars += outputChars;

    const postState = await mindustryJson<StatePayload>("/state").catch(() => latestState!);
    const snapState = postState && postState.ready ? postState : latestState!;

    const seq = recordSnapshot(snapState, "turn", {
      thought,
      actions: actionsSnapshot,
      promptChars: prompt.length,
      outputChars,
      latencyMs,
    });
    pushFeed("thought", thought, actionsSnapshot, activeContender.label, { latencyMs, seq });

    if (activeMatchId !== null) {
      db.prepare(
        "UPDATE matches SET peak_wave = ?, blocks_built = ?, actions_ok = ?, actions_fail = ?, turns = ?, avg_latency_ms = ?, prompt_chars = ?, output_chars = ?, input_tokens = ?, output_tokens = ?, cache_read_tokens = ?, cache_write_tokens = ?, compactions = ?, last_thought = ? WHERE id = ?"
      ).run(
        matchPeakWave,
        matchBlocksBuilt,
        matchActionsOk,
        matchActionsFail,
        matchTurns,
        Math.round(matchTotalLatencyMs / matchTurns),
        matchPromptChars,
        matchOutputChars,
        matchInputTokens,
        matchOutputTokens,
        matchCacheReadTokens,
        matchCacheWriteTokens,
        matchCompactions,
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
    setArenaIdle(false);
    aiPaused = false;
    pushFeed("system", `launching queued match: ${activeContender.id} on ${nextQueued.map}`, undefined, "ARENA");
    pendingNewGame = { seenGameOver: false, expiresAt: Date.now() + 25_000 };
    await mindustryJson("/action", { type: "new_game", map: nextQueued.map }).catch(() => {});
    broadcast({ type: "config", config, meta: getMetaPayload(), leaderboard: getLeaderboard() });
    return;
  }

  // 2. Otherwise follow configured after-match policy
  if (config.mode === "single" || config.mode === "paused") {
    setArenaIdle(true);
    aiPaused = true;
    pushFeed("system", "arena off-air — no active match", undefined, "ARENA");
  } else if (config.mode === "pinned") {
    setArenaIdle(false);
    activeContender = makeContender(config.pinnedModel);
  } else {
    setArenaIdle(false);
    rosterIdx = (rosterIdx + 1) % ROSTER.length;
    activeContender = ROSTER[rosterIdx];
  }
  broadcast({ type: "config", config, meta: getMetaPayload(), leaderboard: getLeaderboard() });
}

const FLYING_UNIT_TYPES = new Set([
  "flare",
  "horizon",
  "zenith",
  "antumbra",
  "eclipse",
  "mono",
  "poly",
  "mega",
  "quad",
  "oct",
  "alpha",
  "beta",
  "gamma",
]);

let latestBuildingsMap = new Map<string, StatePayload["buildings"][number]>();
let lastFrameSeq = 0;
let lastMetaBroadcastAt = 0;
let pollInFlight = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

function rebuildBuildingsIndex(st: StatePayload): void {
  latestBuildingsMap.clear();
  for (const b of st.buildings || []) {
    latestBuildingsMap.set(`${b.x},${b.y}`, b);
  }
}

function applyFrameToLatestState(st: StatePayload, frame: FrameDelta): void {
  let topologyChanged = false;
  for (const [dx, dy] of frame.bDel || []) {
    if (latestBuildingsMap.delete(`${dx},${dy}`)) topologyChanged = true;
  }
  for (const b of frame.bAdd || []) {
    latestBuildingsMap.set(`${b.x},${b.y}`, b);
    topologyChanged = true;
  }
  for (const [ux, uy, aimRot, hp, ammo] of frame.bUpd || []) {
    const existing = latestBuildingsMap.get(`${ux},${uy}`);
    if (existing) {
      existing.aimRot = aimRot;
      existing.hp = hp;
      existing.ammo = ammo;
    }
  }
  if (topologyChanged) {
    st.buildings = Array.from(latestBuildingsMap.values());
  }
  if (frame.powerLinks) st.powerLinks = frame.powerLinks;
  st.conveyorItems = [];
  st.seq = frame.seq;
  st.t = frame.t;
  st.wave = frame.wave;
  st.waveTime = frame.waveTime;
  st.enemies = frame.enemies;
  st.gameOver = frame.gameOver;
  st.paused = frame.paused;
  st.playing = frame.playing;
  st.core = frame.core;
  st.items = frame.items;
  st.flowRates = frame.flowRates;
  st.power = frame.power;
  st.playerDrone = frame.playerDrone;
  st.units = (frame.units || []).map((u) => ({
    id: u[0],
    type: u[1],
    flying: FLYING_UNIT_TYPES.has(u[1]),
    team: u[2],
    x: u[3],
    y: u[4],
    vx: u[5],
    vy: u[6],
    rot: u[7],
    hp: u[8],
    maxHp: u[9],
    shield: u[10],
  }));
  st.bullets = (frame.bullets || []).map((b) => ({
    id: b[0],
    x: b[1],
    y: b[2],
    vx: b[3],
    vy: b[4],
    rot: b[5],
    team: b[6],
    dmg: b[7],
    size: b[8],
    color: b[9],
    kind: b[10],
    len: b[11],
  }));
}

async function handleGameLifecycle(st: StatePayload, prevMap: string | undefined, prevGameOver: boolean): Promise<boolean> {
  if (wsClients.size > 0) {
    lastSpectatorSeenAt = Date.now();
  }

  if (pendingNewGame) {
    if (st.gameOver) {
      pendingNewGame.seenGameOver = true;
    } else if (pendingNewGame.seenGameOver || Date.now() > pendingNewGame.expiresAt) {
      pendingNewGame = null;
    }
  }

  if (!cachedTerrain || cachedTerrain.map !== st.map) {
    cachedTerrain = await mindustryJson<TerrainPayload>("/terrain");
    db.prepare(
      "INSERT INTO map_terrains (map, terrain_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(map) DO UPDATE SET terrain_json = excluded.terrain_json, updated_at = excluded.updated_at"
    ).run(cachedTerrain.map, JSON.stringify(cachedTerrain), Date.now());
    broadcast({ type: "terrain", terrain: cachedTerrain });
    if (!arenaIdle && !pendingNewGame && (activeMatchId === null || (prevMap && prevMap !== st.map))) {
      startNewMatchRecord(st.map, st);
    }
  } else if (!arenaIdle && !pendingNewGame && activeMatchId === null && !st.gameOver) {
    startNewMatchRecord(st.map, st);
  }

  let metaChanged = false;
  if (!arenaIdle && !pendingNewGame && activeMatchId !== null && st.wave > matchPeakWave) {
    matchPeakWave = st.wave;
    metaChanged = true;
    if (st.wave > 1) {
      const seq = recordSnapshot(st, "wave", { thought: `wave ${st.wave} arrived (${st.enemies} enemies)` });
      pushFeed("milestone", `wave ${st.wave} incoming (${st.enemies} enemies, core ${st.core?.hp ?? 0} hp)`, undefined, "ARENA", { seq });
      if (st.wave > lastSteeredWave) {
        lastSteeredWave = st.wave;
        void steerActiveSession(`[alert] wave ${st.wave} just arrived with ${st.enemies} enemies! core ${st.core?.hp ?? 0}/${st.core?.maxHp ?? 0} hp.`);
      }
    }
  }
  if (!arenaIdle && !pendingNewGame && activeMatchId !== null && st.core && lastSteeredCoreHp - st.core.hp >= 100) {
    const drop = lastSteeredCoreHp - st.core.hp;
    lastSteeredCoreHp = st.core.hp;
    void steerActiveSession(`[alert] core under attack! lost ${drop} hp (now ${st.core.hp}/${st.core.maxHp}), ${st.enemies} enemies active.`);
  }

  if (!arenaIdle && !pendingNewGame && activeMatchId !== null && st.gameOver && !prevGameOver) {
    lastGameOverAt = Date.now();
    finishMatchRecord("core destroyed", st);
    await advanceAfterMatchEnd();
    metaChanged = true;
  }

  const emptyPaused =
    !arenaIdle && config.autoPauseEmpty && wsClients.size === 0 && Date.now() - lastSpectatorSeenAt > 10 * 60_000;
  const desiredPaused = !pendingNewGame && (arenaIdle || aiPaused || emptyPaused);

  // Keep Mindustry simulation strictly synchronized with runner pause state
  if (!st.gameOver && typeof st.paused === "boolean" && st.paused !== desiredPaused && Date.now() - lastPauseSyncAt > 800) {
    lastPauseSyncAt = Date.now();
    await mindustryJson("/action", { type: "set_paused", paused: desiredPaused }).catch(() => {});
    st.paused = desiredPaused;
    metaChanged = true;
  }

  if (
    !desiredPaused &&
    !pendingNewGame &&
    !aiBusy &&
    !st.gameOver &&
    Date.now() - lastTurnAt >= config.turnIntervalMs &&
    Date.now() - lastGameOverAt > 8000
  ) {
    void runAiTurn();
  }

  return metaChanged;
}

async function pollMindustry(): Promise<void> {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    // Fast 20 Hz delta path when we already hold a synced baseline
    if (lastFrameSeq > 0 && latestState?.ready) {
      const frame = await mindustryJson<FrameDelta>(`/frame?since=${lastFrameSeq}`);
      if (!frame.ready) return;
      if (frame.unchanged) {
        if (latestState) {
          await handleGameLifecycle(latestState, latestState.map, latestState.gameOver);
        }
        return;
      }
      if (!frame.fullRequired && frame.map === latestState.map) {
        const prevMap = latestState.map;
        const prevGameOver = latestState.gameOver;
        lastFrameSeq = frame.seq;
        applyFrameToLatestState(latestState, frame);
        const metaChanged = await handleGameLifecycle(latestState, prevMap, prevGameOver);
        const now = Date.now();
        const sendMeta = metaChanged || now - lastMetaBroadcastAt >= 450;
        if (sendMeta) lastMetaBroadcastAt = now;
        if (wsClients.size > 0) {
          broadcast(
            sendMeta
              ? { type: "frame", frame, meta: getMetaPayload() }
              : { type: "frame", frame }
          );
        }
        return;
      }
    }

    // Full baseline sync (startup, map change, or ring buffer overflow)
    const st = await mindustryJson<StatePayload>("/state");
    if (!st.ready) return;

    const prevMap = latestState?.map;
    const prevGameOver = latestState?.gameOver ?? false;
    latestState = st;
    rebuildBuildingsIndex(st);
    lastFrameSeq = st.seq || 0;

    await handleGameLifecycle(st, prevMap, prevGameOver);
    lastMetaBroadcastAt = Date.now();
    broadcast({
      type: "state",
      state: st,
      meta: getMetaPayload(),
    });
  } catch {
    // Mindustry temporarily restarting
  } finally {
    pollInFlight = false;
  }
}

function schedulePollMindustry(delayMs?: number): void {
  if (pollTimer) clearTimeout(pollTimer);
  const wait = delayMs ?? (wsClients.size > 0 ? 50 : 500);
  pollTimer = setTimeout(async () => {
    pollTimer = null;
    await pollMindustry();
    schedulePollMindustry();
  }, wait);
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

async function startOpencodeEventListener(): Promise<void> {
  while (true) {
    try {
      const auth = await getOcAuthHeader();
      const headers: Record<string, string> = { accept: "text/event-stream" };
      if (auth) headers.authorization = auth;
      const resp = await fetch(`${OPENCODE_URL}/api/event`, { headers });
      if (!resp.ok || !resp.body) throw new Error(`SSE HTTP ${resp.status}`);
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const dataLines = frame
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim());
          if (dataLines.length === 0) continue;
          try {
            const evt = JSON.parse(dataLines.join("\n"));
            const evType = String(evt?.type || "");
            const data = evt?.data || evt?.properties || evt;
            const sid = data?.sessionID;
            if (!sid || sid !== activeSessionId) continue;

            if (evType === "session.compaction.ended") {
              matchCompactions++;
              needsPostCompactionGrounding = true;
              pushFeed("system", "session compacted — full map orientation queued for next turn", undefined, "ARENA");
            } else if (evType === "session.usage.updated" || evType === "session.usage.recorded") {
              const t = data?.tokens;
              if (t && typeof t === "object") {
                if (evType === "session.usage.updated") {
                  // Cumulative session token usage snapshot
                  matchInputTokens = Math.max(matchInputTokens, Number(t.input || 0));
                  matchOutputTokens = Math.max(matchOutputTokens, Number(t.output || 0));
                  matchCacheReadTokens = Math.max(matchCacheReadTokens, Number(t.cache?.read || 0));
                  matchCacheWriteTokens = Math.max(matchCacheWriteTokens, Number(t.cache?.write || 0));
                } else {
                  matchInputTokens += Number(t.input || 0);
                  matchOutputTokens += Number(t.output || 0);
                  matchCacheReadTokens += Number(t.cache?.read || 0);
                  matchCacheWriteTokens += Number(t.cache?.write || 0);
                }
              }
            }
          } catch {
            // ignore keepalives
          }
        }
      }
    } catch {
      await Bun.sleep(4000);
    }
  }
}

function tryRestorePlayingMatch(): void {
  const row = db
    .query(
      `SELECT id, model, map, peak_wave, blocks_built, actions_ok, actions_fail, turns,
              avg_latency_ms, prompt_chars, output_chars, input_tokens, output_tokens,
              cache_read_tokens, cache_write_tokens, compactions, plan_json, session_id
       FROM matches WHERE status = 'playing' ORDER BY id DESC LIMIT 1`
    )
    .get() as any;
  if (!row) return;
  activeMatchId = Number(row.id);
  activeContender = makeContender(String(row.model));
  activeSessionId = row.session_id ? String(row.session_id) : null;
  matchPeakWave = Number(row.peak_wave || 1);
  matchBlocksBuilt = Number(row.blocks_built || 0);
  matchActionsOk = Number(row.actions_ok || 0);
  matchActionsFail = Number(row.actions_fail || 0);
  matchTurns = Number(row.turns || 0);
  matchTotalLatencyMs = Number(row.avg_latency_ms || 0) * matchTurns;
  matchPromptChars = Number(row.prompt_chars || 0);
  matchOutputChars = Number(row.output_chars || 0);
  matchInputTokens = Number(row.input_tokens || 0);
  matchOutputTokens = Number(row.output_tokens || 0);
  matchCacheReadTokens = Number(row.cache_read_tokens || 0);
  matchCacheWriteTokens = Number(row.cache_write_tokens || 0);
  matchCompactions = Number(row.compactions || 0);
  try {
    currentPlan = JSON.parse(row.plan_json || "[]");
  } catch {
    currentPlan = [];
  }
  const snapRow = db.query("SELECT COALESCE(MAX(seq), 0) as s FROM match_snapshots WHERE match_id = ?").get(activeMatchId) as any;
  matchSnapshotSeq = Number(snapRow?.s || 0);
  const feedRows = db
    .query("SELECT id, ts, kind, model, text, actions_json FROM feed_events WHERE match_id = ? ORDER BY id DESC LIMIT 35")
    .all(activeMatchId) as any[];
  recentFeed = feedRows.reverse().map((r) => ({
    id: Number(r.id),
    ts: Number(r.ts),
    kind: r.kind,
    model: r.model || undefined,
    text: String(r.text || ""),
    actions: r.actions_json ? JSON.parse(r.actions_json) : undefined,
  }));
  setArenaIdle(false);
  console.log(`restored in-progress match #${activeMatchId} (${activeContender.id} on ${row.map}, session=${activeSessionId})`);
}

if (!arenaIdle) tryRestorePlayingMatch();
void startOpencodeEventListener();
void refreshActiveRoster();
setInterval(() => void refreshActiveRoster(), 60_000);
setInterval(() => void pollFactorio(), 10_000);
schedulePollMindustry(10);
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

    if (url.pathname === "/mcp") {
      return await handleMcp(req);
    }

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
                  COALESCE(SUM(output_chars), 0) as total_output_chars,
                  COALESCE(SUM(input_tokens), 0) as total_input_tokens,
                  COALESCE(SUM(output_tokens), 0) as total_output_tokens,
                  COALESCE(SUM(cache_read_tokens), 0) as total_cache_read_tokens,
                  COALESCE(SUM(cache_write_tokens), 0) as total_cache_write_tokens,
                  COALESCE(SUM(compactions), 0) as total_compactions
           FROM matches`
        )
        .get();
      return Response.json({
        config,
        aiPaused,
        arenaIdle,
        meta: getMetaPayload(),
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
        setArenaIdle(body.arenaIdle);
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
      setArenaIdle(false);
      aiPaused = false;
      finishMatchRecord("admin launch", latestState || undefined);
      pendingNewGame = { seenGameOver: false, expiresAt: Date.now() + 25_000 };
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
      db.prepare("DELETE FROM match_interviews WHERE match_id = ?").run(id);
      db.prepare("DELETE FROM match_snapshots WHERE match_id = ?").run(id);
      db.prepare("DELETE FROM feed_events WHERE match_id = ?").run(id);
      db.prepare("DELETE FROM matches WHERE id = ?").run(id);
      broadcast({ type: "leaderboard", leaderboard: getLeaderboard() });
      return Response.json({ ok: true, deleted: id });
    }

    const adminInterviewMatch = url.pathname.match(/^\/api\/admin\/matches\/(\d+)\/interview$/);
    if (adminInterviewMatch && req.method === "POST") {
      const id = Number(adminInterviewMatch[1]);
      const body = (await req.json().catch(() => ({}))) as { question?: string };
      const asker = req.headers.get("remote-user") || "tetraslam";
      try {
        const item = await runMatchInterview(id, String(body.question || ""), asker);
        return Response.json({ ok: true, item, interviews: getMatchInterviews(id) });
      } catch (err: any) {
        return Response.json({ ok: false, error: String(err?.message || err) }, { status: 400 });
      }
    }

    const adminDeleteInterview = url.pathname.match(/^\/api\/admin\/interviews\/(\d+)$/);
    if (adminDeleteInterview && req.method === "DELETE") {
      const id = Number(adminDeleteInterview[1]);
      const row = db.query("SELECT match_id FROM match_interviews WHERE id = ?").get(id) as { match_id: number } | null;
      db.prepare("DELETE FROM match_interviews WHERE id = ?").run(id);
      if (row) {
        broadcast({ type: "interview_deleted", matchId: row.match_id, id });
      }
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
        void interruptActiveSession();
        pushFeed("system", "match paused", undefined, "ARENA");
      } else if (body.action === "resume") {
        setArenaIdle(false);
        aiPaused = false;
        if (config.mode === "paused") {
          config.mode = "single";
          saveConfig(config);
        }
        pushFeed("system", "match resumed", undefined, "ARENA");
        void runAiTurn();
      } else if (body.action === "go_idle") {
        finishMatchRecord("off-air", latestState || undefined);
        setArenaIdle(true);
        aiPaused = true;
        pushFeed("system", "arena set off-air", undefined, "ARENA");
      } else if (body.action === "step") {
        if (!arenaIdle) void runAiTurn(true);
      } else if ((body.action === "set_model" || body.action === "switch_model") && body.model) {
        activeContender = makeContender(String(body.model));
        await switchActiveSessionModel(activeContender.id);
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
        setArenaIdle(false);
        aiPaused = false;
        finishMatchRecord("manual reset", latestState || undefined);
        pendingNewGame = { seenGameOver: false, expiresAt: Date.now() + 25_000 };
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
          plan: currentPlan,
          config,
          feed: recentFeed.slice(-35),
          leaderboard: getLeaderboard(),
          factorio: factorioState,
        })
      );
      if (wsClients.size === 1) schedulePollMindustry(20);
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
