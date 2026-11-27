export type Building = {
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
};

export type Unit = {
  id: number;
  type: string;
  team: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  rot: number;
};

export type PlayerDrone = {
  id: number;
  type: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  rot: number;
  buildTarget: { x: number; y: number; block: string } | null;
};

export type Bullet = { x: number; y: number; team: string; dmg: number };
export type Point = { x: number; y: number };

export type State = {
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
  spawns: Point[];
  buildings: Building[];
  powerLinks?: Array<[number, number, number, number]>;
  conveyorItems?: Array<[number, number, string]>;
  power: { produced: number; consumed: number };
  units: Unit[];
  bullets: Bullet[];
  playerDrone?: PlayerDrone | null;
};

export type Terrain = {
  ready: boolean;
  map: string;
  width: number;
  height: number;
  spawns: Point[];
  core: Point | null;
  palette: string[];
  rle: number[];
  tileNames?: string[];
  tileRle?: number[];
  ores: Array<[number, number, string]>;
};

export type RunnerMode = "paused" | "single" | "pinned" | "rotation";

export type Contender = { id: string; provider: string; ticker: string; label: string; color: string };

export type TokenUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheHitPct: number;
};

export type Meta = {
  contender: Contender;
  matchId: number | null;
  plan?: PlanGoal[];
  /** live: a match is running. paused: it is frozen in place, game and model both. idle: off air, no match. */
  matchState?: "live" | "paused" | "idle";
  lastCompleted?: { id: number; model: string; map: string; peak_wave: number; ended_at: number } | null;
  mode?: RunnerMode;
  turnIntervalMs?: number;
  autoPauseEmpty?: boolean;
  emptyPaused?: boolean;
  turns?: number;
  avgLatencyMs?: number;
  tokens?: TokenUsage;
  compactions?: number;
  queueLength?: number;
  aiPaused: boolean;
  aiBusy: boolean;
  blocksBuilt: number;
  actionsOk: number;
  actionsFail: number;
  spectators: number;
};

/** One line of the model's own plan board, set through its set_plan tool. */
export type PlanGoal = { text: string; status: "active" | "done" | "blocked"; x?: number; y?: number };

export type FeedAction = { label: string; ok: boolean; error?: string };

export type FeedItem = {
  id: number;
  ts: number;
  kind: "thought" | "system" | "milestone" | "error";
  model?: string;
  text: string;
  actions?: FeedAction[];
  latencyMs?: number;
  seq?: number;
};

export type ModelRow = {
  model: string;
  label: string;
  matches: number;
  best_wave: number;
  avg_wave: number;
  total_blocks: number;
  actions_ok: number;
  actions_fail: number;
  total_turns?: number;
};

export type MatchRow = {
  id: number;
  model: string;
  label: string;
  map: string;
  started_at: number;
  ended_at: number | null;
  peak_wave: number;
  blocks_built: number;
  actions_ok: number;
  actions_fail: number;
  status: string;
  turns?: number;
  avg_latency_ms?: number;
  end_reason?: string;
  snapshot_count?: number;
  last_thought?: string;
  prompt_chars?: number;
  output_chars?: number;
};

export type QueueRow = { id: number; model: string; map: string; created_at: number };

export type Snapshot = {
  seq: number;
  ts: number;
  kind: string;
  wave: number;
  enemies: number;
  coreHp: number;
  coreMaxHp: number;
  items: Record<string, number>;
  power: { produced: number; consumed: number };
  buildings: Building[];
  powerLinks?: Array<[number, number, number, number]>;
  units: Unit[];
  playerDrone: PlayerDrone | null;
  thought: string | null;
  plan?: PlanGoal[];
  actions: FeedAction[];
  promptChars: number;
  outputChars: number;
  latencyMs: number;
};

export type TimelinePoint = {
  seq: number;
  ts: number;
  wave: number;
  enemies: number;
  coreHp: number;
  coreMaxHp: number;
  copper: number;
  lead: number;
  graphite: number;
  buildings: number;
  drills: number;
  turrets: number;
  armedTurrets: number;
  powerNet: number;
  latencyMs: number;
};

/** One question put to the model in its own match session after the match, and what it said. */
export type InterviewItem = {
  id: number;
  matchId: number;
  ts: number;
  asker: string;
  question: string;
  answer: string;
  latencyMs: number;
};

export type MatchDetail = {
  match: MatchRow;
  /** True when the match kept its session and is over, so the model can still be asked things. */
  canInterview?: boolean;
  interviews?: InterviewItem[];
  hasTerrain: boolean;
  snapshots: Snapshot[];
  timeline: TimelinePoint[];
};

export type ArenaConfig = {
  mode: RunnerMode;
  turnIntervalMs: number;
  autoPauseEmpty: boolean;
  pinnedModel: string;
  enabledModels: string[];
};

export type AdminState = {
  config: ArenaConfig;
  aiPaused: boolean;
  contender: Contender;
  availableRoster: Contender[];
  roster: Contender[];
  maps: string[];
  queue: QueueRow[];
  usage: {
    total_matches: number;
    total_turns: number;
    total_blocks: number;
    total_prompt_chars: number;
    total_output_chars: number;
    total_input_tokens?: number;
    total_output_tokens?: number;
    total_cache_read_tokens?: number;
    total_cache_write_tokens?: number;
    total_compactions?: number;
  };
};

export type Leaderboard = {
  models: ModelRow[];
  recentMatches: MatchRow[];
  roster: Contender[];
  availableRoster?: Contender[];
  maps: string[];
  queue?: QueueRow[];
};

export type Factorio = {
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

export type ServerMessage =
  | {
      type: "init";
      terrain: Terrain | null;
      state: State | null;
      meta: Meta;
      feed?: FeedItem[];
      plan?: PlanGoal[];
      leaderboard?: Leaderboard;
      factorio?: Factorio;
    }
  | { type: "terrain"; terrain: Terrain }
  | { type: "state"; state: State; meta: Meta }
  | { type: "feed"; item: FeedItem }
  | { type: "plan"; plan: PlanGoal[] }
  | { type: "interview"; matchId: number; item: InterviewItem }
  | { type: "interview_deleted"; matchId: number; id: number }
  | { type: "leaderboard"; leaderboard: Leaderboard }
  | { type: "factorio"; factorio: Factorio }
  | { type: "config"; config: ArenaConfig; meta: Meta; leaderboard?: Leaderboard };
