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

export type Contender = { id: string; provider: string; ticker: string; label: string; color: string };

export type Meta = {
  contender: Contender;
  matchId: number | null;
  aiPaused: boolean;
  aiBusy: boolean;
  blocksBuilt: number;
  actionsOk: number;
  actionsFail: number;
  spectators: number;
};

export type FeedAction = { label: string; ok: boolean; error?: string };

export type FeedItem = {
  id: number;
  ts: number;
  kind: "thought" | "system" | "milestone" | "error";
  model?: string;
  text: string;
  actions?: FeedAction[];
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
};

export type Leaderboard = {
  models: ModelRow[];
  recentMatches: MatchRow[];
  roster: Contender[];
  maps: string[];
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
      leaderboard?: Leaderboard;
      factorio?: Factorio;
    }
  | { type: "terrain"; terrain: Terrain }
  | { type: "state"; state: State; meta: Meta }
  | { type: "feed"; item: FeedItem }
  | { type: "leaderboard"; leaderboard: Leaderboard }
  | { type: "factorio"; factorio: Factorio };
