import type { TerrainModel } from "./terrain";
import type { Building, FrameDelta, PlayerDrone, Point, State, Unit } from "./types";
import { clamp, lerp, lerpAngle } from "./util";

export type Kind = "core" | "turret" | "drill" | "conveyor" | "router" | "wall" | "power" | "other";

/** Turret reach in tiles (Mindustry range / 8). */
export const RANGES: Record<string, number> = {
  duo: 13.75,
  scatter: 27.5,
  scorch: 7.5,
  hail: 29.4,
  wave: 13.75,
  lancer: 20.6,
  arc: 11.25,
  parallax: 35,
  swarmer: 30,
  salvo: 23.75,
  segment: 10,
  tsunami: 23.75,
  fuse: 11.25,
  ripple: 36.25,
  cyclone: 25,
  foreshadow: 62.5,
  spectre: 32.5,
  meltdown: 23.75,
};

const FLYERS = new Set([
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

export function kindOf(block: string): Kind {
  if (block.startsWith("core-")) return "core";
  if (block in RANGES) return "turret";
  if (block.includes("drill")) return "drill";
  if (block.includes("conveyor") && !block.includes("bridge")) return "conveyor";
  if (/router|junction|sorter|gate|distributor|bridge|unloader/.test(block)) return "router";
  if (block.includes("wall")) return "wall";
  if (/node|generator|battery|solar|panel|reactor|diode/.test(block)) return "power";
  return "other";
}

export const TEAM_COLORS: Record<string, string> = {
  sharded: "#ffd37f",
  crux: "#f25555",
  derelict: "#8a8477",
  malis: "#a27ce5",
  green: "#54d67d",
  blue: "#6c87fd",
};
export const teamColor = (team: string): string => TEAM_COLORS[team] || "#bfb8a8";
export const HOME = "sharded";

export type BView = {
  key: string;
  b: Building;
  kind: Kind;
  /** Centre in tile space (tile x spans x..x+1). */
  cx: number;
  cy: number;
  /** Bottom-left tile of the footprint. */
  ox: number;
  oy: number;
  aim: number;
  aimFrom: number;
  born: number;
  hitAt: number;
  firedAt: number;
  /** Conveyor sprite variant (0..4) and whether it is mirrored. */
  blend: number;
  flip: boolean;
  range: number;
};

export type UView = {
  u: Unit;
  x0: number;
  y0: number;
  r0: number;
  x: number;
  y: number;
  rot: number;
  flying: boolean;
  hitAt: number;
  trail: Point[];
  trailAt: number;
};

export type Item = { name: string; x0: number; y0: number; x1: number; y1: number; born: number };

export type LiveItem = { name: string; x: number; y: number };

export type LiveBullet = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  team: string;
  dmg: number;
  size: number;
  color: string;
  kind: number;
  len: number;
};

type SnapUnit = {
  id: number;
  type: string;
  team: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  hp: number;
  maxHp: number;
  shield: number;
};

type SnapItem = {
  name: string;
  x: number;
  y: number;
  rot: number;
  px: number;
  py: number;
  paired: boolean;
};

type LiveSnap = {
  seq: number;
  t: number;
  frame: FrameDelta;
  committed: boolean;
  units: Map<number, SnapUnit>;
  bullets: Map<number, LiveBullet>;
  items: SnapItem[];
  turretAims: Map<string, number>;
};

export type Fx =
  | { t: "spark"; x: number; y: number; vx: number; vy: number; born: number; life: number; color: string }
  | { t: "smoke"; x: number; y: number; vx: number; vy: number; born: number; life: number; size: number }
  | { t: "ring"; x: number; y: number; born: number; life: number; size: number; color: string }
  | { t: "flash"; x: number; y: number; born: number; life: number; size: number; color: string }
  | { t: "place"; x: number; y: number; born: number; life: number; size: number }
  | { t: "scorch"; x: number; y: number; born: number; life: number; size: number; rot: number; v: number }
  | { t: "ping"; x: number; y: number; born: number; life: number; ok: boolean }
  | {
      t: "beam";
      x: number;
      y: number;
      rot: number;
      len: number;
      width: number;
      color: string;
      kind: number;
      team: string;
      seed: number;
      born: number;
      life: number;
    }
  | {
      t: "tracer";
      x: number;
      y: number;
      dx: number;
      dy: number;
      born: number;
      life: number;
      reach: number;
      speed: number;
      team: string;
      big: boolean;
      hit: boolean;
    };

export type WorldEvents = {
  built?: (views: BView[]) => void;
  lost?: (views: BView[]) => void;
  wave?: (wave: number, state: State) => void;
  gameOver?: (state: State) => void;
  newMap?: (state: State) => void;
};

const MAX_FX = 900;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** The live match as the renderer sees it: snapshots turned into smooth, continuous things. */
export class World {
  terrain: TerrainModel | null = null;
  state: State | null = null;
  buildings = new Map<string, BView>();
  units = new Map<number, UView>();
  items: Item[] = [];
  /** Pre-interpolated live conveyor items when receiving 20 Hz delta frames (null in replay mode). */
  liveItems: LiveItem[] | null = null;
  /** Pre-interpolated live projectiles by real entity ID when receiving 20 Hz delta frames. */
  liveBullets: LiveBullet[] = [];
  fx: Fx[] = [];
  /** performance.now() of the newest snapshot, and the smoothed gap between snapshots. */
  at = 0;
  gap = 320;
  /** Live 20 Hz snapshot interpolation buffer state. */
  private snaps: LiveSnap[] = [];
  private liveMode = false;
  private clockOffset = 0;
  private hasClock = false;
  private lastRenderT = 0;
  private lastTickNow = 0;
  private readonly interpDelayMs = 160;
  private seenBulletIds = new Set<number>();
  /** Bumps whenever the set of buildings changes. */
  layout = 0;
  events: WorldEvents = {};
  droneId = -1;
  build: { x: number; y: number; block: string; cx: number; cy: number; size: number; since: number } | null =
    null;
  private weldAt = 0;
  private tiles = new Map<number, BView>();
  private lastWave = -1;
  private wasOver = false;

  get w(): number {
    return this.terrain?.w ?? this.state?.width ?? 0;
  }
  get h(): number {
    return this.terrain?.h ?? this.state?.height ?? 0;
  }

  /** 0..1 progress from the previous snapshot to the newest. */
  phase(now: number): number {
    return clamp((now - this.at) / this.gap, 0, 1.15);
  }

  buildingAt(x: number, y: number): BView | undefined {
    return this.tiles.get(y * 4096 + x);
  }

  setTerrain(t: TerrainModel): void {
    this.terrain = t;
  }

  /**
   * Take a new snapshot. A replay passes `gap` (how long to glide to it) and `fresh` (a jump:
   * no glide, no effects) itself. Live play works both out from the clock.
   */
  apply(next: State, now: number, opts?: { fresh?: boolean; gap?: number }): void {
    const prev = this.state;
    const fresh =
      opts?.fresh ??
      (!prev || prev.map !== next.map || now - this.at > 4000 || (prev.gameOver && !next.gameOver));
    if (opts?.gap) this.gap = opts.gap;
    else if (prev && !fresh) this.gap = clamp(lerp(this.gap, now - this.at, 0.25), 150, 900);
    const t = prev ? this.phase(now) : 1;
    this.at = now;
    this.state = next;

    if (fresh) {
      this.buildings.clear();
      this.units.clear();
      this.items = [];
      this.liveItems = null;
      this.liveBullets = [];
      this.snaps = [];
      this.liveMode = false;
      this.hasClock = false;
      this.lastRenderT = 0;
      this.lastTickNow = 0;
      this.seenBulletIds.clear();
      this.fx = [];
      this.lastWave = next.wave;
      this.wasOver = next.gameOver;
      if (prev && prev.map !== next.map) this.events.newMap?.(next);
    } else if (opts?.gap) {
      // Replay mode disables live 20 Hz ring buffer
      this.liveMode = false;
      this.liveItems = null;
      this.liveBullets = [];
      this.snaps = [];
    }

    this.applyBuildings(next, now, fresh);
    this.applyUnits(next, now, t, fresh);
    this.applyItems(next, now, t);
    if (!fresh) this.applyBullets(next, now);
    this.applyDrone(next.playerDrone || null, now, fresh);

    if (next.wave !== this.lastWave) {
      if (!fresh && next.wave > this.lastWave) this.events.wave?.(next.wave, next);
      this.lastWave = next.wave;
    }
    if (next.gameOver && !this.wasOver && !fresh) this.events.gameOver?.(next);
    this.wasOver = next.gameOver;
  }

  /**
   * Queue a 20 Hz compact delta frame into the interpolation ring buffer.
   * All discrete world mutations (building add/remove, unit death/hit FX, beams, flashes)
   * are phase-locked to `renderT` inside `commitSnap()` so visuals and effects never desync
   * by the 160ms interpolation buffer.
   */
  applyFrame(frame: FrameDelta, now: number): void {
    if (!frame.ready || !this.state || this.state.map !== frame.map) return;

    this.liveMode = true;
    this.at = now;

    // Ultra-stable clock servo with a +-18ms deadband so network jitter never perturbs playback speed.
    const rawOffset = frame.t - now;
    if (!this.hasClock || Math.abs(rawOffset - this.clockOffset) > 500) {
      this.clockOffset = rawOffset;
      this.hasClock = true;
      this.lastRenderT = frame.t - this.interpDelayMs;
      this.lastTickNow = now;
    } else if (Math.abs(rawOffset - this.clockOffset) > 18) {
      this.clockOffset = lerp(this.clockOffset, rawOffset, 0.015);
    }

    const prevSnap = this.snaps.length > 0 ? this.snaps[this.snaps.length - 1] : null;
    if (prevSnap && frame.seq <= prevSnap.seq) return;

    const turretAims = new Map<string, number>();
    for (const [ux, uy, aimRot] of frame.bUpd || []) {
      turretAims.set(`${ux},${uy}`, aimRot);
    }

    const snapUnits = new Map<number, SnapUnit>();
    for (const raw of frame.units || []) {
      const [id, type, team, rx, ry, vx, vy, rot, hp, maxHp, shield] = raw;
      snapUnits.set(id, { id, type, team, x: rx + 0.5, y: ry + 0.5, vx, vy, rot, hp, maxHp, shield });
    }

    const snapBullets = new Map<number, LiveBullet>();
    for (const raw of frame.bullets || []) {
      const [id, rx, ry, vx, vy, rot, team, dmg, size, color, kind, len] = raw;
      snapBullets.set(id, { id, x: rx + 0.5, y: ry + 0.5, vx, vy, rot, team, dmg, size, color, kind, len });
    }

    // Parse uncapped conveyor items & O(1) spatial-grid pair with prevSnap along belt direction
    const prevItems = prevSnap?.items || [];
    const prevGrid = new Map<number, number[]>();
    for (let i = 0; i < prevItems.length; i++) {
      const pi = prevItems[i];
      const cell = (Math.floor(pi.y) << 12) | (Math.floor(pi.x) & 0xfff);
      let bucket = prevGrid.get(cell);
      if (!bucket) {
        bucket = [];
        prevGrid.set(cell, bucket);
      }
      bucket.push(i);
    }
    const usedPrev = new Uint8Array(prevItems.length);
    const ci = frame.ci || [];
    const iPal = frame.iPal || [];
    const snapItems: SnapItem[] = [];
    const dtSec = prevSnap ? clamp((frame.t - prevSnap.t) / 1000, 0.02, 0.25) : 0.05;
    const DX = [1, 0, -1, 0];
    const DY = [0, 1, 0, -1];

    for (let k = 0; k + 3 < ci.length; k += 4) {
      const x = ci[k];
      const y = ci[k + 1];
      const name = iPal[ci[k + 2]] || "copper";
      const rot = ci[k + 3] & 3;
      const bvx = DX[rot];
      const bvy = DY[rot];
      const fx = Math.floor(x);
      const fy = Math.floor(y);

      let bestIdx = -1;
      let bestCost = 0.55;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const bucket = prevGrid.get(((fy + oy) << 12) | ((fx + ox) & 0xfff));
          if (!bucket) continue;
          for (let bi = 0; bi < bucket.length; bi++) {
            const idx = bucket[bi];
            if (usedPrev[idx]) continue;
            const pi = prevItems[idx];
            if (pi.name !== name) continue;
            const ddx = x - pi.x;
            const ddy = y - pi.y;
            const dist = Math.hypot(ddx, ddy);
            if (dist > 0.58) continue;
            const along = ddx * bvx + ddy * bvy;
            const cross = Math.abs(ddx * bvy - ddy * bvx);
            const penalty = along < -0.06 ? 0.35 : cross * 0.4;
            const cost = dist + penalty;
            if (cost < bestCost) {
              bestCost = cost;
              bestIdx = idx;
            }
          }
        }
      }

      if (bestIdx >= 0) {
        usedPrev[bestIdx] = 1;
        const pi = prevItems[bestIdx];
        snapItems.push({ name, x, y, rot, px: pi.x, py: pi.y, paired: true });
      } else {
        const back = Math.min(0.18, 2.2 * dtSec);
        snapItems.push({ name, x, y, rot, px: x - bvx * back, py: y - bvy * back, paired: false });
      }
    }

    const snap: LiveSnap = {
      seq: frame.seq,
      t: frame.t,
      frame,
      committed: false,
      units: snapUnits,
      bullets: snapBullets,
      items: snapItems,
      turretAims,
    };
    this.snaps.push(snap);
    // Keep ~24 frames (~1.2s) so Catmull-Rom always has neighbors and bursts never drop uncommitted frames.
    while (this.snaps.length > 24) {
      const oldest = this.snaps[0];
      if (!oldest.committed) this.commitSnap(oldest, null, now);
      this.snaps.shift();
    }

    // If this is the very first live frame, commit immediately so initial drone/HUD state is live.
    if (this.snaps.length === 1) {
      this.commitSnap(snap, null, now);
    }
  }

  /** Commit a snapshot's discrete changes (buildings, hit/death FX, beams, HUD scalars) right when renderT reaches it. */
  private commitSnap(snap: LiveSnap, prevSnap: LiveSnap | null, now: number): void {
    if (snap.committed || !this.state) return;
    snap.committed = true;
    const frame = snap.frame;

    const built: BView[] = [];
    const lost: BView[] = [];
    let topologyChanged = false;

    for (const [dx, dy] of frame.bDel || []) {
      const key = `${dx},${dy}`;
      const v = this.buildings.get(key);
      if (!v) continue;
      this.buildings.delete(key);
      topologyChanged = true;
      lost.push(v);
      if (v.b.hp < v.b.maxHp || this.underFireLive(v, frame)) {
        this.explode(v.cx, v.cy, 0.5 + v.b.size * 0.55, now);
      } else {
        this.push({ t: "place", x: v.cx, y: v.cy, born: now, life: 300, size: -v.b.size });
      }
    }

    for (const b of frame.bAdd || []) {
      const key = `${b.x},${b.y}`;
      const off = Math.floor((b.size - 1) / 2);
      const v: BView = {
        key,
        b,
        kind: kindOf(b.block),
        ox: b.x - off,
        oy: b.y - off,
        cx: b.x - off + b.size / 2,
        cy: b.y - off + b.size / 2,
        aim: b.aimRot,
        aimFrom: b.aimRot,
        born: now,
        hitAt: -1e9,
        firedAt: -1e9,
        blend: 0,
        flip: false,
        range: RANGES[b.block] || 0,
      };
      this.buildings.set(key, v);
      topologyChanged = true;
      built.push(v);
      this.push({ t: "place", x: v.cx, y: v.cy, born: now, life: 420, size: b.size });
    }

    for (const [ux, uy, aimRot, hp, ammo] of frame.bUpd || []) {
      const key = `${ux},${uy}`;
      const v = this.buildings.get(key);
      if (!v) continue;
      if (hp < v.b.hp - 0.5) {
        v.hitAt = now;
        this.sparks(v.cx + rand(-0.4, 0.4) * v.b.size, v.cy + rand(-0.4, 0.4) * v.b.size, 5, "#ffd9a0", now);
      }
      v.b.aimRot = aimRot;
      v.b.hp = hp;
      v.b.ammo = ammo;
    }

    if (topologyChanged) {
      this.layout++;
      this.tiles.clear();
      for (const v of this.buildings.values()) {
        for (let dy = 0; dy < v.b.size; dy++)
          for (let dx = 0; dx < v.b.size; dx++) this.tiles.set((v.oy + dy) * 4096 + v.ox + dx, v);
      }
      for (const v of this.buildings.values()) if (v.kind === "conveyor") this.blendConveyor(v);
      this.state.buildings = Array.from(this.buildings.values(), (v) => v.b);
    }
    if (frame.powerLinks) this.state.powerLinks = frame.powerLinks;
    if (built.length) this.events.built?.(built);
    if (lost.length) this.events.lost?.(lost);

    // Sync units lifecycle at renderT
    for (const [id, su] of snap.units) {
      const existing = this.units.get(id);
      if (!existing) {
        this.units.set(id, {
          u: { ...su },
          x0: su.x,
          y0: su.y,
          r0: su.rot,
          x: su.x,
          y: su.y,
          rot: su.rot,
          flying: FLYERS.has(su.type),
          hitAt: -1e9,
          trail: [],
          trailAt: 0,
        });
      } else {
        if (su.hp < existing.u.hp - 0.5) {
          existing.hitAt = now;
          this.sparks(existing.x, existing.y, 4, su.team === HOME ? "#ffd9a0" : "#ffb199", now);
        }
        existing.u.x = su.x;
        existing.u.y = su.y;
        existing.u.vx = su.vx;
        existing.u.vy = su.vy;
        existing.u.rot = su.rot;
        existing.u.hp = su.hp;
        existing.u.maxHp = su.maxHp;
        existing.u.shield = su.shield;
      }
    }
    for (const [id, v] of this.units) {
      if (snap.units.has(id)) continue;
      this.units.delete(id);
      this.explode(v.x, v.y, v.flying ? 0.9 : 0.75, now, v.u.team !== HOME);
    }

    // Muzzle flashes & bullet impacts at renderT
    for (const [id, b] of snap.bullets) {
      if (!this.seenBulletIds.has(id)) {
        this.seenBulletIds.add(id);
        const bAt = this.buildingAt(Math.floor(b.x), Math.floor(b.y));
        if (bAt && bAt.kind === "turret" && bAt.b.team === b.team && now - bAt.firedAt > 90) {
          bAt.firedAt = now;
          this.push({
            t: "flash",
            x: b.x,
            y: b.y,
            born: now,
            life: 95,
            size: 0.45 + bAt.b.size * 0.18,
            color: b.color || "#fff1c9",
          });
        }
      }
    }
    if (prevSnap) {
      for (const [id, pb] of prevSnap.bullets) {
        if (!snap.bullets.has(id) && pb.kind === 0 && this.fx.length < MAX_FX - 12) {
          const dtSec = Math.min(0.08, Math.max(0.01, (snap.t - prevSnap.t) / 1000));
          const ix = pb.x + pb.vx * dtSec * 0.5;
          const iy = pb.y + pb.vy * dtSec * 0.5;
          this.push({
            t: "flash",
            x: ix,
            y: iy,
            born: now,
            life: 85,
            size: Math.max(0.4, pb.size * 2.4),
            color: pb.color || "#fff1c9",
          });
          this.sparks(ix, iy, pb.dmg > 30 ? 4 : 2, pb.color || "#ffe2a8", now);
        }
      }
    }
    if (this.seenBulletIds.size > 2000) this.seenBulletIds.clear();

    // 60 Hz captured beams/lightning/rails fired at exact renderT
    for (const raw of frame.beams || []) {
      const [id, rx, ry, rot, len, width, color, kind, team] = raw;
      const bx = rx + 0.5;
      const by = ry + 0.5;
      this.push({
        t: "beam",
        x: bx,
        y: by,
        rot,
        len: Math.max(1.5, len),
        width: Math.max(0.14, width),
        color,
        kind,
        team,
        seed: id,
        born: now,
        life: kind === 3 ? 280 : kind === 2 ? 170 : 190,
      });
      const bAt = this.buildingAt(Math.floor(bx), Math.floor(by));
      if (bAt && bAt.kind === "turret" && now - bAt.firedAt > 90) {
        bAt.firedAt = now;
      }
    }

    this.state.wave = frame.wave;
    this.state.waveTime = frame.waveTime;
    this.state.enemies = frame.enemies;
    this.state.gameOver = frame.gameOver;
    this.state.playing = frame.playing;
    this.state.core = frame.core;
    this.state.items = frame.items;
    this.state.power = frame.power;
    this.state.playerDrone = frame.playerDrone;
    this.state.units = Array.from(this.units.values(), (v) => v.u);
    this.applyDrone(frame.playerDrone || null, now, false);

    if (frame.wave !== this.lastWave) {
      if (frame.wave > this.lastWave) this.events.wave?.(frame.wave, this.state);
      this.lastWave = frame.wave;
    }
    if (frame.gameOver && !this.wasOver) this.events.gameOver?.(this.state);
    this.wasOver = frame.gameOver;
  }

  private underFireLive(v: BView, frame: FrameDelta): boolean {
    for (const u of this.units.values()) {
      if (u.u.team !== v.b.team && Math.abs(u.x - v.cx) < 16 && Math.abs(u.y - v.cy) < 16) return true;
    }
    for (const b of frame.bullets || []) {
      if (b[6] !== v.b.team && Math.abs(b[1] + 0.5 - v.cx) < 6 && Math.abs(b[2] + 0.5 - v.cy) < 6) return true;
    }
    return false;
  }

  private applyBuildings(next: State, now: number, fresh: boolean): void {
    const seen = new Set<string>();
    const built: BView[] = [];
    let changed = false;
    for (const b of next.buildings) {
      const key = `${b.x},${b.y}`;
      seen.add(key);
      let v = this.buildings.get(key);
      if (v && v.b.block !== b.block) {
        this.buildings.delete(key);
        v = undefined;
      }
      if (!v) {
        const off = Math.floor((b.size - 1) / 2);
        v = {
          key,
          b,
          kind: kindOf(b.block),
          ox: b.x - off,
          oy: b.y - off,
          cx: b.x - off + b.size / 2,
          cy: b.y - off + b.size / 2,
          aim: b.aimRot,
          aimFrom: b.aimRot,
          born: fresh ? -1e9 : now,
          hitAt: -1e9,
          firedAt: -1e9,
          blend: 0,
          flip: false,
          range: RANGES[b.block] || 0,
        };
        this.buildings.set(key, v);
        changed = true;
        if (!fresh) {
          built.push(v);
          this.push({ t: "place", x: v.cx, y: v.cy, born: now, life: 420, size: b.size });
        }
      } else {
        if (b.hp < v.b.hp - 0.5) {
          v.hitAt = now;
          this.sparks(v.cx + rand(-0.4, 0.4) * b.size, v.cy + rand(-0.4, 0.4) * b.size, 5, "#ffd9a0", now);
        }
        v.aimFrom = v.aim;
        v.b = b;
      }
    }
    const lost: BView[] = [];
    for (const [key, v] of this.buildings) {
      if (seen.has(key)) continue;
      this.buildings.delete(key);
      changed = true;
      if (!fresh) {
        lost.push(v);
        // Only a block that died fighting blows up. One the model demolished just folds away.
        if (v.b.hp < v.b.maxHp || this.underFire(v, next))
          this.explode(v.cx, v.cy, 0.5 + v.b.size * 0.55, now);
        else this.push({ t: "place", x: v.cx, y: v.cy, born: now, life: 300, size: -v.b.size });
      }
    }
    if (changed) {
      this.layout++;
      this.tiles.clear();
      for (const v of this.buildings.values()) {
        for (let dy = 0; dy < v.b.size; dy++)
          for (let dx = 0; dx < v.b.size; dx++) this.tiles.set((v.oy + dy) * 4096 + v.ox + dx, v);
      }
      for (const v of this.buildings.values()) if (v.kind === "conveyor") this.blendConveyor(v);
    }
    if (built.length) this.events.built?.(built);
    if (lost.length) this.events.lost?.(lost);
  }

  /** The model's own builder ship: which unit it is, and the tile it is welding right now. */
  private applyDrone(d: PlayerDrone | null, now: number, fresh: boolean): void {
    this.droneId = d ? d.id : -1;
    const t = d?.buildTarget || null;
    if (!t) {
      this.build = null;
      return;
    }
    const at = this.buildingAt(t.x, t.y);
    const prev = this.build;
    const same = prev && prev.x === t.x && prev.y === t.y;
    this.build = {
      x: t.x,
      y: t.y,
      block: t.block,
      cx: at ? at.cx : t.x + 0.5,
      cy: at ? at.cy : t.y + 0.5,
      size: at ? at.b.size : 1,
      since: same && prev ? prev.since : now,
    };
    if (!fresh && now - this.weldAt > 240) {
      this.weldAt = now;
      this.sparks(this.build.cx, this.build.cy, 3, "#c9ffd0", now);
    }
  }

  private underFire(v: BView, next: State): boolean {
    for (const u of this.units.values()) {
      if (u.u.team !== v.b.team && Math.abs(u.x - v.cx) < 16 && Math.abs(u.y - v.cy) < 16) return true;
    }
    return next.bullets.some(
      (b) => b.team !== v.b.team && Math.abs(b.x - v.cx) < 6 && Math.abs(b.y - v.cy) < 6,
    );
  }

  /** Mindustry's conveyor autotiling: which neighbours feed this belt decides its sprite. */
  private blendConveyor(v: BView): void {
    const DX = [1, 0, -1, 0];
    const DY = [0, 1, 0, -1];
    const feeds = (rel: number): boolean => {
      const dir = (v.b.rot + rel + 4) % 4;
      const other = this.buildingAt(v.b.x + DX[dir], v.b.y + DY[dir]);
      if (!other || other === v) return false;
      if (other.kind === "conveyor") {
        return other.b.x + DX[other.b.rot % 4] === v.b.x && other.b.y + DY[other.b.rot % 4] === v.b.y;
      }
      return other.kind === "drill" || other.kind === "router";
    };
    const left = feeds(1);
    const back = feeds(2);
    const right = feeds(3);
    v.flip = false;
    if (left && back && right) v.blend = 3;
    else if (left && right) v.blend = 4;
    else if (left && back) v.blend = 2;
    else if (right && back) {
      v.blend = 2;
      v.flip = true;
    } else if (left) {
      v.blend = 1;
      v.flip = true;
    } else if (right) v.blend = 1;
    else v.blend = 0;
  }

  private applyUnits(next: State, now: number, t: number, fresh: boolean): void {
    const seen = new Set<number>();
    for (const u of next.units) {
      seen.add(u.id);
      const v = this.units.get(u.id);
      // Unit positions are measured from tile centres. Everything here is measured from tile corners.
      const ux = u.x + 0.5;
      const uy = u.y + 0.5;
      if (!v) {
        this.units.set(u.id, {
          u: { ...u, x: ux, y: uy },
          x0: ux,
          y0: uy,
          r0: u.rot,
          x: ux,
          y: uy,
          rot: u.rot,
          flying: FLYERS.has(u.type),
          hitAt: -1e9,
          trail: [],
          trailAt: 0,
        });
        continue;
      }
      if (u.hp < v.u.hp - 0.5) {
        v.hitAt = now;
        this.sparks(v.x, v.y, 4, u.team === HOME ? "#ffd9a0" : "#ffb199", now);
      }
      v.x0 = lerp(v.x0, v.u.x, t);
      v.y0 = lerp(v.y0, v.u.y, t);
      v.r0 = lerpAngle(v.r0, v.u.rot, Math.min(1, t));
      if (Math.hypot(ux - v.x0, uy - v.y0) > 12) {
        v.x0 = ux;
        v.y0 = uy;
        v.trail = [];
      }
      v.u = { ...u, x: ux, y: uy };
    }
    for (const [id, v] of this.units) {
      if (seen.has(id)) continue;
      this.units.delete(id);
      if (!fresh) this.explode(v.x, v.y, v.flying ? 0.9 : 0.75, now, v.u.team !== HOME);
    }
  }

  /**
   * Belt items have no ids, so each new one is paired with the old one it most plausibly was:
   * same kind, either where it stood (a backed-up belt) or one step further along (a moving belt).
   */
  private applyItems(next: State, now: number, t: number): void {
    const incoming = next.conveyorItems || [];
    const old = this.items.map((it) => ({
      it,
      x: lerp(it.x0, it.x1, Math.min(1, t)),
      y: lerp(it.y0, it.y1, Math.min(1, t)),
      used: false,
    }));
    const step = 1.8 * (this.gap / 1000);
    const out: Item[] = [];
    for (const [x, y, name] of incoming) {
      let best: (typeof old)[number] | null = null;
      let bestCost = 1.1;
      const belt = this.buildingAt(Math.floor(x), Math.floor(y));
      const rot = belt ? belt.b.rot % 4 : -1;
      const bx = rot === 0 ? -step : rot === 2 ? step : 0;
      const by = rot === 1 ? -step : rot === 3 ? step : 0;
      for (const o of old) {
        if (o.used || o.it.name !== name) continue;
        const dx = x - o.it.x1;
        const dy = y - o.it.y1;
        if (dx > 1.6 || dx < -1.6 || dy > 1.6 || dy < -1.6) continue;
        const still = Math.hypot(dx, dy);
        const moved = rot >= 0 ? Math.hypot(dx + bx, dy + by) + 0.02 : 9;
        const cost = Math.min(still, moved);
        if (cost < bestCost) {
          bestCost = cost;
          best = o;
        }
      }
      if (best) {
        best.used = true;
        out.push({ name, x0: best.x, y0: best.y, x1: x, y1: y, born: best.it.born });
      } else {
        out.push({ name, x0: x, y0: y, x1: x, y1: y, born: now });
      }
    }
    this.items = out;
  }

  /** Bullets have no ids or headings either. Each becomes a short tracer along its turret's line of fire. */
  private applyBullets(next: State, now: number): void {
    const turrets: BView[] = [];
    for (const v of this.buildings.values()) if (v.kind === "turret") turrets.push(v);
    const units = [...this.units.values()];
    for (const b of next.bullets) {
      const x = b.x + 0.5;
      const y = b.y + 0.5;
      let dx = 0;
      let dy = 0;
      let reach = 5;
      let found = false;
      // A bullet flies straight out from its turret, so the nearest turret that could have
      // fired it (the one aimed most nearly at it) gives the heading.
      let bestScore = Number.POSITIVE_INFINITY;
      let shooter: BView | null = null;
      for (const tv of turrets) {
        if (tv.b.team !== b.team) continue;
        const ddx = x - tv.cx;
        const ddy = y - tv.cy;
        const d = Math.hypot(ddx, ddy);
        if (d > tv.range + 3) continue;
        const bearing = Math.atan2(ddy, ddx) - (tv.b.aimRot * Math.PI) / 180;
        const off = d < 0.9 ? 0 : Math.abs(Math.atan2(Math.sin(bearing), Math.cos(bearing)));
        const score = off * 6 + d * 0.15;
        if (score < bestScore) {
          bestScore = score;
          shooter = tv;
        }
      }
      if (shooter) {
        const tv = shooter;
        const ddx = x - tv.cx;
        const ddy = y - tv.cy;
        const d = Math.hypot(ddx, ddy);
        const a = d < 0.9 ? (tv.b.aimRot * Math.PI) / 180 : Math.atan2(ddy, ddx);
        dx = Math.cos(a);
        dy = Math.sin(a);
        reach = Math.max(0.5, tv.range - d);
        found = true;
        if (now - tv.firedAt > 160 && d < 4.5) {
          tv.firedAt = now;
          this.push({
            t: "flash",
            x: tv.cx + dx * (0.35 + tv.b.size * 0.3),
            y: tv.cy + dy * (0.35 + tv.b.size * 0.3),
            born: now,
            life: 110,
            size: 0.5 + tv.b.size * 0.22,
            color: "#fff1c9",
          });
        }
      }
      if (!found) {
        let bestD = 9;
        for (const uv of units) {
          if (uv.u.team !== b.team) continue;
          const d = Math.hypot(x - uv.u.x, y - uv.u.y);
          if (d < bestD) {
            bestD = d;
            const a = (uv.u.rot * Math.PI) / 180;
            dx = Math.cos(a);
            dy = Math.sin(a);
            reach = Math.max(0.5, 9 - d);
            found = true;
          }
        }
      }
      // Stop the tracer on the first opposing thing in its path, and spark there.
      let hit = false;
      if (found) {
        const check = (tx: number, ty: number, radius: number) => {
          const along = (tx - x) * dx + (ty - y) * dy;
          if (along < 0 || along > reach) return;
          const across = Math.abs((tx - x) * dy - (ty - y) * dx);
          if (across < radius) {
            reach = along;
            hit = true;
          }
        };
        for (const uv of units) if (uv.u.team !== b.team) check(uv.u.x, uv.u.y, 0.8);
        if (b.team !== HOME) {
          for (const bv of this.buildings.values())
            if (bv.b.team !== b.team && Math.abs(bv.cx - x) < 12 && Math.abs(bv.cy - y) < 12)
              check(bv.cx, bv.cy, bv.b.size * 0.55);
        }
      }
      const speed = b.dmg > 30 ? 16 : 24;
      this.push({
        t: "tracer",
        x,
        y,
        dx,
        dy,
        born: now,
        life: found ? Math.min(this.gap * 1.05, (reach / speed) * 1000 + 40) : this.gap,
        reach,
        speed: found ? speed : 0,
        team: b.team,
        big: b.dmg > 30,
        hit,
      });
    }
  }

  sparks(x: number, y: number, n: number, color: string, now: number): void {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(2, 7);
      this.push({
        t: "spark",
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        born: now,
        life: rand(160, 380),
        color,
      });
    }
  }

  explode(x: number, y: number, size: number, now: number, hostile = false): void {
    this.push({ t: "flash", x, y, born: now, life: 150, size: size * 1.9, color: "#fff3d0" });
    this.push({
      t: "ring",
      x,
      y,
      born: now,
      life: 420,
      size: size * 2.4,
      color: hostile ? "#ffb08a" : "#ffd37f",
    });
    this.push({
      t: "scorch",
      x,
      y,
      born: now,
      life: 26_000,
      size,
      rot: rand(0, 360),
      v: Math.floor(rand(0, 3)),
    });
    this.sparks(x, y, Math.round(8 + size * 9), hostile ? "#ff9d6e" : "#ffd9a0", now);
    for (let i = 0; i < 4 + size * 3; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(0.3, 1.6);
      this.push({
        t: "smoke",
        x: x + rand(-0.3, 0.3) * size,
        y: y + rand(-0.3, 0.3) * size,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp + 0.5,
        born: now,
        life: rand(500, 1100),
        size: rand(0.35, 0.8) * size,
      });
    }
  }

  ping(x: number, y: number, ok: boolean, now: number): void {
    this.push({ t: "ping", x: x + 0.5, y: y + 0.5, born: now, life: 2600, ok });
  }

  private push(f: Fx): void {
    if (this.fx.length >= MAX_FX) {
      const drop = this.fx.findIndex((e) => e.t === "spark" || e.t === "smoke");
      this.fx.splice(drop < 0 ? 0 : drop, 1);
    }
    this.fx.push(f);
  }

  /** Advance everything that moves between snapshots. */
  tick(now: number): void {
    if (this.liveMode && this.snaps.length >= 2) {
      this.tickLive(now);
    } else {
      const t = this.phase(now);
      for (const v of this.buildings.values()) {
        if (v.kind === "turret") v.aim = lerpAngle(v.aimFrom, v.b.aimRot, Math.min(1, t));
      }
      for (const v of this.units.values()) {
        v.x = lerp(v.x0, v.u.x, t);
        v.y = lerp(v.y0, v.u.y, t);
        v.rot = lerpAngle(v.r0, v.u.rot, Math.min(1, t));
        this.pushTrail(v, now);
      }
    }
    let keep = 0;
    for (const f of this.fx) {
      if (now - f.born < f.life) {
        this.fx[keep++] = f;
      } else if (f.t === "tracer" && f.hit) {
        const hx = f.x + f.dx * f.reach;
        const hy = f.y + f.dy * f.reach;
        this.fx[keep++] = {
          t: "flash",
          x: hx,
          y: hy,
          born: now,
          life: 90,
          size: f.big ? 0.9 : 0.5,
          color: "#fff1c9",
        };
        if (this.fx.length < MAX_FX - 8)
          this.sparks(hx, hy, f.big ? 5 : 2, f.team === HOME ? "#ffe2a8" : "#ff9d8a", now);
      }
    }
    this.fx.length = Math.max(keep, 0);
  }

  private pushTrail(v: UView, now: number): void {
    if (now - v.trailAt > 55) {
      v.trailAt = now;
      const last = v.trail[v.trail.length - 1];
      if (!last || Math.hypot(last.x - v.x, last.y - v.y) > 0.08) {
        v.trail.push({ x: v.x, y: v.y });
        if (v.trail.length > 18) v.trail.shift();
      } else if (v.trail.length > 1) v.trail.shift();
    }
  }

  /**
   * Monotonic, phase-locked snapshot interpolation at `renderT = serverNow - 160ms`.
   * - `renderT` advances at 0.96x..1.04x real time (never jumps or reverses on jitter).
   * - Discrete world mutations (builds, kills, beams, flashes) commit exactly as `renderT` crosses `snap.t`.
   * - Units use Catmull-Rom splines across 4 real server positions for zero velocity-kink pulsing.
   */
  private tickLive(now: number): void {
    const snaps = this.snaps;
    const frameDtMs = clamp(now - (this.lastTickNow || now), 0, 100);
    this.lastTickNow = now;

    const targetRenderT = now + this.clockOffset - this.interpDelayMs;
    let renderT = this.lastRenderT ? this.lastRenderT + frameDtMs : targetRenderT;
    const drift = targetRenderT - renderT;
    if (Math.abs(drift) > 350) {
      renderT = targetRenderT;
    } else {
      // Gently steer playback clock toward target without any noticeable speed wobble (+-3.5% max)
      renderT += clamp(drift * 0.04, -frameDtMs * 0.035, frameDtMs * 0.035);
    }
    this.lastRenderT = renderT;

    // Commit every snapshot whose server timestamp `renderT` has now reached
    for (let i = 0; i < snaps.length; i++) {
      if (snaps[i].t <= renderT && !snaps[i].committed) {
        this.commitSnap(snaps[i], i > 0 ? snaps[i - 1] : null, now);
      }
    }

    const first = snaps[0];
    const last = snaps[snaps.length - 1];

    let idxA = 0;
    let idxB = 1;
    let alpha = 1;
    let extraSec = 0;

    if (renderT <= first.t) {
      idxA = 0;
      idxB = 1;
      alpha = 0;
    } else if (renderT >= last.t) {
      idxA = snaps.length - 2;
      idxB = snaps.length - 1;
      alpha = 1;
      extraSec = clamp((renderT - last.t) / 1000, 0, 0.15);
    } else {
      for (let i = snaps.length - 2; i >= 0; i--) {
        if (snaps[i].t <= renderT) {
          idxA = i;
          idxB = i + 1;
          alpha = clamp((renderT - snaps[i].t) / Math.max(1, snaps[i + 1].t - snaps[i].t), 0, 1);
          break;
        }
      }
    }

    const a = snaps[idxA];
    const b = snaps[idxB];
    const prevS = idxA > 0 ? snaps[idxA - 1] : null;
    const nextS = idxB + 1 < snaps.length ? snaps[idxB + 1] : null;
    const dtSec = clamp((b.t - a.t) / 1000, 0.01, 0.4);
    const frameDtSec = Math.max(0.004, frameDtMs / 1000);

    // 1. Units: Catmull-Rom spline through (p0, p1, p2, p3) — C1 smooth with zero 20Hz velocity pulsing
    const t = alpha;
    const t2 = t * t;
    const t3 = t2 * t;

    for (const v of this.units.values()) {
      const ua = a.units.get(v.u.id);
      const ub = b.units.get(v.u.id);
      if (ua && ub) {
        if (extraSec > 0) {
          v.x = ub.x + ub.vx * extraSec;
          v.y = ub.y + ub.vy * extraSec;
          v.rot = ub.rot;
        } else {
          const dist = Math.hypot(ub.x - ua.x, ub.y - ua.y);
          const u0 = prevS?.units.get(v.u.id);
          const u3 = nextS?.units.get(v.u.id);
          if (
            u0 &&
            u3 &&
            dist > 0.002 &&
            dist < 6 &&
            Math.hypot(ua.x - u0.x, ua.y - u0.y) < 6 &&
            Math.hypot(u3.x - ub.x, u3.y - ub.y) < 6
          ) {
            // Standard centripetal-like Catmull-Rom (tau = 0.5)
            v.x =
              0.5 *
              (2 * ua.x +
                (-u0.x + ub.x) * t +
                (2 * u0.x - 5 * ua.x + 4 * ub.x - u3.x) * t2 +
                (-u0.x + 3 * ua.x - 3 * ub.x + u3.x) * t3);
            v.y =
              0.5 *
              (2 * ua.y +
                (-u0.y + ub.y) * t +
                (2 * u0.y - 5 * ua.y + 4 * ub.y - u3.y) * t2 +
                (-u0.y + 3 * ua.y - 3 * ub.y + u3.y) * t3);
          } else {
            v.x = lerp(ua.x, ub.x, alpha);
            v.y = lerp(ua.y, ub.y, alpha);
          }
          v.rot = lerpAngle(ua.rot, ub.rot, alpha);
        }
      } else if (ub) {
        const back = dtSec * (1 - alpha);
        v.x = ub.x - ub.vx * back + ub.vx * extraSec;
        v.y = ub.y - ub.vy * back + ub.vy * extraSec;
        v.rot = ub.rot;
      } else if (ua) {
        v.x = ua.x + ua.vx * dtSec * alpha;
        v.y = ua.y + ua.vy * dtSec * alpha;
        v.rot = ua.rot;
      }
      this.pushTrail(v, now);
    }

    // 2. Turrets: frame-rate-independent smooth rotation
    const aimK = 1 - Math.exp(-frameDtSec / 0.045);
    for (const v of this.buildings.values()) {
      if (v.kind !== "turret") continue;
      const aimA = a.turretAims.get(v.key);
      const aimB = b.turretAims.get(v.key);
      if (aimA !== undefined && aimB !== undefined) {
        v.aim = lerpAngle(aimA, aimB, alpha);
      } else {
        v.aim = lerpAngle(v.aim, v.b.aimRot, aimK);
      }
    }

    // 3. Real projectiles interpolated by entity ID
    const bulletsOut: LiveBullet[] = [];
    for (const [id, bb] of b.bullets) {
      const ba = a.bullets.get(id);
      if (ba) {
        bulletsOut.push({
          ...bb,
          x: extraSec > 0 ? bb.x + bb.vx * extraSec : lerp(ba.x, bb.x, alpha),
          y: extraSec > 0 ? bb.y + bb.vy * extraSec : lerp(ba.y, bb.y, alpha),
          rot: lerpAngle(ba.rot, bb.rot, alpha),
        });
      } else {
        const back = dtSec * (1 - alpha);
        bulletsOut.push({
          ...bb,
          x: bb.x - bb.vx * back + bb.vx * extraSec,
          y: bb.y - bb.vy * back + bb.vy * extraSec,
        });
      }
    }
    for (const [id, ba] of a.bullets) {
      if (b.bullets.has(id) || alpha > 0.65) continue;
      bulletsOut.push({
        ...ba,
        x: ba.x + ba.vx * dtSec * alpha,
        y: ba.y + ba.vy * dtSec * alpha,
      });
    }
    this.liveBullets = bulletsOut;

    // 4. Uncapped conveyor items interpolated smoothly (and extrapolated gently if extraSec > 0)
    const itemsOut: LiveItem[] = new Array(b.items.length);
    const exFrac = extraSec > 0 ? extraSec / dtSec : 0;
    for (let i = 0; i < b.items.length; i++) {
      const it = b.items[i];
      itemsOut[i] = {
        name: it.name,
        x: extraSec > 0 ? it.x + (it.x - it.px) * exFrac : lerp(it.px, it.x, alpha),
        y: extraSec > 0 ? it.y + (it.y - it.py) * exFrac : lerp(it.py, it.y, alpha),
      };
    }
    this.liveItems = itemsOut;
  }

  hostiles(): UView[] {
    const out: UView[] = [];
    for (const v of this.units.values()) if (v.u.team !== HOME) out.push(v);
    return out;
  }
}
