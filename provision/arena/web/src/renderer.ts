import { atlasReady, glow, has, setBase, sprite, tinted } from "./atlas";
import { ORE_COLORS } from "./terrain";
import { clamp, reducedMotion } from "./util";
import { type BView, HOME, teamColor, type UView, type World } from "./world";

export type Pick =
  | { kind: "unit"; id: number }
  | { kind: "building"; key: string }
  | { kind: "tile"; x: number; y: number };

export type Camera = { x: number; y: number; z: number };

const BG = "#060504";
const INK = "#efe9dc";
const YELLOW = "#ffd37f";
const RED = "#f25555";
const FLAT: Record<string, string> = {
  core: "#ffd37f",
  turret: "#ffe9b8",
  drill: "#d99d73",
  conveyor: "#8f897c",
  router: "#b9b2a2",
  wall: "#b08a66",
  power: "#f3c95a",
  other: "#a9a294",
};

/**
 * Draws the match. Camera coordinates are in map space: x in tiles from the west edge,
 * y in tiles from the NORTH edge, so they match the screen. World y is flipped on the way in.
 */
export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  cam: Camera = { x: 0, y: 0, z: 16 };
  goal: Camera = { x: 0, y: 0, z: 16 };
  /** Seconds for the camera to close most of the gap to its goal. */
  ease = 0.08;
  tactical = false;
  hover: Pick | null = null;
  selected: Pick | null = null;
  /** The exact model id, shown as the builder ship's callsign, and its line colour. */
  callsign = "";
  callsignColor = "#ffd37f";
  /** Frame times in ms, newest last, for the perf readout on window.arena. */
  readonly frames = new Float32Array(240);
  frameCount = 0;
  /** Longest terrain pass since it was last read, in ms. */
  terrainWorst = 0;
  private vw = 1;
  private vh = 1;
  private dpr = 1;
  private last = 0;
  /** Render scale under the display's pixel ratio. Drops a step if frames run long. */
  private quality = 1;
  private slow = 0;
  private vis: BView[] = [];
  private tag: { key: string; canvas: HTMLCanvasElement } | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    private world: World,
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement!);
    this.resize();
  }

  get width(): number {
    return this.vw;
  }
  get height(): number {
    return this.vh;
  }

  resize(): void {
    const rect = this.canvas.parentElement!.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2) * this.quality;
    this.vw = Math.max(1, rect.width);
    this.vh = Math.max(1, rect.height);
    const w = Math.round(this.vw * this.dpr);
    const h = Math.round(this.vh * this.dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  minZoom(): number {
    const { w, h } = this.world;
    if (!w || !h) return 1;
    return Math.min(this.vw / w, this.vh / h) * 0.9;
  }

  fitZoom(tilesW: number, tilesH: number, lo = 0, hi = 64): number {
    return clamp(Math.min(this.vw / tilesW, this.vh / tilesH), Math.max(lo, this.minZoom()), hi);
  }

  /** Aim the camera at a world tile position. */
  lookAt(wx: number, wy: number, z?: number, snap = false): void {
    this.goal.x = wx;
    this.goal.y = this.world.h - wy;
    if (z) this.goal.z = z;
    this.bound(this.goal);
    if (snap || reducedMotion()) this.cam = { ...this.goal };
  }

  private bound(c: Camera): void {
    const { w, h } = this.world;
    c.z = clamp(c.z, this.minZoom(), 64);
    if (w && h) {
      c.x = clamp(c.x, 0, w);
      c.y = clamp(c.y, 0, h);
    }
  }

  panBy(dxPx: number, dyPx: number): void {
    this.goal.x -= dxPx / this.cam.z;
    this.goal.y -= dyPx / this.cam.z;
    this.bound(this.goal);
    this.cam.x = this.goal.x;
    this.cam.y = this.goal.y;
  }

  /** Zoom by a factor, keeping the tile under (px, py) where it is. */
  zoomAt(px: number, py: number, factor: number): void {
    const before = this.goal.z;
    const z = clamp(before * factor, this.minZoom(), 64);
    const mx = this.goal.x + (px - this.vw / 2) / before;
    const my = this.goal.y + (py - this.vh / 2) / before;
    this.goal.z = z;
    this.goal.x = mx - (px - this.vw / 2) / z;
    this.goal.y = my - (py - this.vh / 2) / z;
    this.bound(this.goal);
  }

  /** Screen point to world tile coordinates (fractional). */
  toWorld(px: number, py: number): { x: number; y: number } {
    return {
      x: this.cam.x + (px - this.vw / 2) / this.cam.z,
      y: this.world.h - (this.cam.y + (py - this.vh / 2) / this.cam.z),
    };
  }

  /** Visible rectangle in map space, for the minimap. */
  viewRect(): { x: number; y: number; w: number; h: number } {
    const w = this.vw / this.cam.z;
    const h = this.vh / this.cam.z;
    return { x: this.cam.x - w / 2, y: this.cam.y - h / 2, w, h };
  }

  pick(px: number, py: number): Pick | null {
    const world = this.world;
    if (!world.w) return null;
    const p = this.toWorld(px, py);
    let best: UView | null = null;
    let bestD = Math.max(0.9, 10 / this.cam.z);
    for (const v of world.units.values()) {
      const d = Math.hypot(v.x - p.x, v.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    if (best) return { kind: "unit", id: best.u.id };
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y);
    if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return null;
    const b = world.buildingAt(tx, ty);
    if (b) return { kind: "building", key: b.key };
    return { kind: "tile", x: tx, y: ty };
  }

  frame(now: number): void {
    const raw = now - (this.last || now);
    const dt = Math.min(0.1, raw / 1000);
    this.last = now;
    this.measure(raw);
    const k = reducedMotion() ? 1 : 1 - Math.exp(-dt / this.ease);
    this.cam.x += (this.goal.x - this.cam.x) * k;
    this.cam.y += (this.goal.y - this.cam.y) * k;
    this.cam.z *= (this.goal.z / this.cam.z) ** k;

    const { ctx, world } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    const terrain = world.terrain;
    if (!terrain) return;

    const s = this.cam.z * this.dpr;
    const ox = W / 2 - this.cam.x * s;
    const oy = H / 2 - this.cam.y * s;
    const t0 = performance.now();
    terrain.draw(ctx, ox, oy, s, W, H);
    this.terrainWorst = Math.max(this.terrainWorst, performance.now() - t0);

    // Between matches the new state can arrive a beat before its terrain. Draw nothing on the wrong map.
    if (world.state && world.state.map !== terrain.map) return;

    // From here on: tile units, y down, origin at the map's north-west corner.
    setBase(ctx, s, ox, oy);
    // Chunks for where the camera is going get baked on the way there.
    if (this.goal.z !== this.cam.z || this.goal.x !== this.cam.x || this.goal.y !== this.cam.y) {
      const gs = this.goal.z * this.dpr;
      terrain.warm(W / 2 - this.goal.x * gs, H / 2 - this.goal.y * gs, gs, W, H);
    }
    const mh = world.h;
    const Y = (wy: number) => mh - wy;
    const px = 1 / s;
    const v0x = -ox / s - 3;
    const v1x = (W - ox) / s + 3;
    const v0y = -oy / s - 3;
    const v1y = (H - oy) / s + 3;
    const seen = (x: number, y: number, pad = 0) =>
      x > v0x - pad && x < v1x + pad && y > v0y - pad && y < v1y + pad;
    const sprites = atlasReady() && this.cam.z >= 5;
    const detail = this.cam.z >= 9;
    ctx.imageSmoothingEnabled = s < 30;

    // Scorch marks sit on the ground, under everything.
    for (const f of world.fx) {
      if (f.t !== "scorch" || !seen(f.x, Y(f.y), 4)) continue;
      const age = (now - f.born) / f.life;
      const tier = clamp(Math.round(f.size) - 1, 0, 3);
      const img = tinted(`scorch-${tier}-${f.v}`, "#0b0907");
      if (!img) continue;
      ctx.globalAlpha = 0.34 * (1 - age * age);
      sprite(ctx, img, f.x, Y(f.y), f.rot, 0.45);
    }
    ctx.globalAlpha = 1;

    if (this.tactical) this.drawTacticalGround(now, px);
    this.drawSpawns(now, px, seen);

    const all = this.vis;
    all.length = 0;
    for (const v of world.buildings.values()) if (seen(v.cx, Y(v.cy), v.b.size)) all.push(v);
    const sel = this.selected?.kind === "building" ? this.selected.key : null;
    const hov = this.hover?.kind === "building" ? this.hover.key : null;

    if (!sprites) {
      for (const v of all) {
        ctx.fillStyle = v.b.team === HOME ? FLAT[v.kind] : teamColor(v.b.team);
        const pad = Math.min(0.08, px * 0.5);
        ctx.fillRect(v.ox + pad, Y(v.oy + v.b.size) + pad, v.b.size - pad * 2, v.b.size - pad * 2);
      }
    } else {
      // Soft contact shadows first, so neighbours never shade each other's tops.
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      for (const v of all) {
        if (v.kind === "conveyor") continue;
        ctx.fillRect(v.ox - 0.07, Y(v.oy + v.b.size) + 0.02, v.b.size + 0.2, v.b.size + 0.2);
      }
      const frame = reducedMotion() ? 0 : Math.floor((now / 1000) * 14.4) % 4;
      for (const v of all) {
        if (v.kind !== "conveyor") continue;
        const base = has(`${v.b.block}-0-0`) ? v.b.block : "conveyor";
        if (!sprite(ctx, `${base}-${v.blend}-${frame}`, v.cx, Y(v.cy), v.b.rot * 90, 1, v.flip))
          this.flat(v, Y);
      }
      if (detail) this.drawItems(now, Y, seen);
      for (const v of all) {
        if (v.kind === "conveyor") continue;
        this.drawBlock(v, now, Y, detail);
      }
    }

    this.drawPower(now, px, Y, seen);

    // Damage and status marks.
    for (const v of all) {
      const b = v.b;
      const hit = now - v.hitAt;
      if (hit < 180 && sprites) {
        ctx.globalAlpha = 0.5 * (1 - hit / 180);
        ctx.fillStyle = "#fff";
        ctx.fillRect(v.ox, Y(v.oy + b.size), b.size, b.size);
        ctx.globalAlpha = 1;
      }
      if (b.hp < b.maxHp - 0.5 && b.maxHp > 0 && this.cam.z >= 7) {
        this.bar(
          v.cx,
          Y(v.oy + b.size) - 0.26,
          Math.max(0.9, b.size * 0.8),
          b.hp / b.maxHp,
          b.team === HOME,
          px,
        );
      }
      if (v.kind === "turret" && b.team === HOME && this.cam.z >= 9) {
        const dry = b.ammo <= 0;
        if (dry) {
          // An unarmed turret is the one thing a viewer should not miss on defence.
          const blink = reducedMotion() ? 1 : 0.55 + 0.45 * Math.sin(now / 240);
          ctx.strokeStyle = `rgba(242,85,85,${0.5 + 0.5 * blink})`;
          ctx.lineWidth = Math.max(px * 1.5, 0.07);
          ctx.setLineDash([0.22, 0.16]);
          ctx.strokeRect(v.ox + 0.06, Y(v.oy + b.size) + 0.06, b.size - 0.12, b.size - 0.12);
          ctx.setLineDash([]);
        } else {
          ctx.fillStyle = "#0b0a08";
          ctx.fillRect(v.ox + 0.06, Y(v.oy) - 0.22, 0.2, 0.16);
          ctx.fillStyle = YELLOW;
          ctx.fillRect(v.ox + 0.09, Y(v.oy) - 0.19, 0.14, 0.1);
        }
      }
    }

    // Turret reach: every turret in tactical view, otherwise only the one under the cursor.
    for (const v of world.buildings.values()) {
      if (v.kind !== "turret" || !v.range) continue;
      const focus = v.key === sel || v.key === hov;
      if (!focus && !(this.tactical && v.b.team === HOME)) continue;
      if (!seen(v.cx, Y(v.cy), v.range)) continue;
      const armed = v.b.ammo > 0;
      ctx.beginPath();
      ctx.arc(v.cx, Y(v.cy), v.range, 0, Math.PI * 2);
      if (focus) {
        ctx.fillStyle = armed ? "rgba(255,211,127,0.07)" : "rgba(242,85,85,0.06)";
        ctx.fill();
      }
      ctx.strokeStyle = armed
        ? `rgba(255,211,127,${focus ? 0.9 : 0.38})`
        : `rgba(242,85,85,${focus ? 0.9 : 0.45})`;
      ctx.lineWidth = Math.max(px * (focus ? 1.5 : 1), 0.03);
      if (!armed) ctx.setLineDash([0.5, 0.4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    this.drawUnits(now, px, Y, seen, false);
    this.drawFx(now, px, Y, seen);
    this.drawUnits(now, px, Y, seen, true);
    this.drawMarks(now, px, Y);
    this.drawCallsign();
  }

  private flat(v: BView, Y: (wy: number) => number): void {
    this.ctx.fillStyle = v.b.team === HOME ? FLAT[v.kind] : teamColor(v.b.team);
    this.ctx.fillRect(v.ox + 0.05, Y(v.oy + v.b.size) + 0.05, v.b.size - 0.1, v.b.size - 0.1);
  }

  private drawBlock(v: BView, now: number, Y: (wy: number) => number, detail: boolean): void {
    const { ctx } = this;
    const b = v.b;
    const cy = Y(v.cy);
    // A fresh block settles in from slightly oversize.
    const age = now - v.born;
    const pop = age < 260 && !reducedMotion() ? 1 + 0.16 * (1 - age / 260) ** 2 : 1;

    if (v.kind === "turret") {
      if (!sprite(ctx, `block-${b.size}`, v.cx, cy, 0, pop)) this.flat(v, Y);
      const head = has(`${b.block}-outline`) ? `${b.block}-outline` : b.block;
      const kick = clamp(1 - (now - v.firedAt) / 140, 0, 1) * 0.12;
      const a = (v.aim * Math.PI) / 180;
      sprite(ctx, head, v.cx - Math.cos(a) * kick, cy + Math.sin(a) * kick, v.aim - 90, pop);
      return;
    }
    if (!sprite(ctx, b.block, v.cx, cy, 0, pop)) {
      this.flat(v, Y);
      return;
    }
    if (v.kind === "core") {
      sprite(ctx, `${b.block}-team-${b.team}`, v.cx, cy);
      return;
    }
    if (v.kind === "drill") {
      const spin = reducedMotion() ? 0 : (now / 1000) * (b.block.startsWith("mechanical") ? 95 : 150);
      if (detail) sprite(ctx, `${b.block}-rotator`, v.cx, cy, spin);
      sprite(ctx, `${b.block}-top`, v.cx, cy);
      return;
    }
    if (detail && has(`${b.block}-top`) && v.kind === "power") {
      ctx.globalAlpha = reducedMotion() ? 0.8 : 0.55 + 0.45 * Math.sin(now / 300 + v.cx);
      sprite(ctx, `${b.block}-top`, v.cx, cy);
      ctx.globalAlpha = 1;
    }
  }

  private drawItems(now: number, Y: (wy: number) => number, seen: (x: number, y: number) => boolean): void {
    const { ctx, world } = this;
    const t = Math.min(1, world.phase(now));
    for (const it of world.items) {
      const x = it.x0 + (it.x1 - it.x0) * t;
      const y = Y(it.y0 + (it.y1 - it.y0) * t);
      if (!seen(x, y)) continue;
      const fade = clamp((now - it.born) / 160, 0, 1);
      ctx.globalAlpha = fade;
      if (!sprite(ctx, `item-${it.name}`, x, y, 0, 0.56)) {
        ctx.fillStyle = ORE_COLORS[it.name] || INK;
        ctx.fillRect(x - 0.14, y - 0.14, 0.28, 0.28);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawPower(
    now: number,
    px: number,
    Y: (wy: number) => number,
    seen: (x: number, y: number, pad?: number) => boolean,
  ): void {
    const { ctx, world } = this;
    const links = world.state?.powerLinks;
    if (!links?.length) return;
    const live = (world.state?.power.produced || 0) > 0;
    ctx.lineCap = "round";
    for (const [x1, y1, x2, y2] of links) {
      const ax = x1 + 0.5;
      const ay = Y(y1 + 0.5);
      const bx = x2 + 0.5;
      const by = Y(y2 + 0.5);
      if (!seen(ax, ay, 12) && !seen(bx, by, 12)) continue;
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = live ? "rgba(251,211,103,0.22)" : "rgba(251,211,103,0.08)";
      ctx.lineWidth = Math.max(0.3, px * 3);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = live ? "#fbe6a6" : "#8f7a45";
      ctx.lineWidth = Math.max(0.08, px);
      ctx.stroke();
      if (live && !reducedMotion()) {
        // Current reads as a bright bead running down the beam.
        const len = Math.hypot(bx - ax, by - ay);
        const t = ((now / 1000) * 5 + x1 * 0.37) % Math.max(1, len);
        ctx.fillStyle = "#fff8dc";
        ctx.beginPath();
        ctx.arc(
          ax + ((bx - ax) * t) / len,
          ay + ((by - ay) * t) / len,
          Math.max(0.1, px * 1.6),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
    ctx.lineCap = "butt";
  }

  private drawSpawns(now: number, px: number, seen: (x: number, y: number, pad?: number) => boolean): void {
    const { ctx, world } = this;
    const mh = world.h;
    const spawns = world.state?.spawns?.length ? world.state.spawns : world.terrain?.spawns || [];
    const soon = (world.state?.waveTime ?? 99) < 15;
    for (const sp of spawns) {
      const x = sp.x + 0.5;
      const y = mh - (sp.y + 0.5);
      if (!seen(x, y, 8)) continue;
      const beat = reducedMotion() ? 0.5 : (now / (soon ? 700 : 1800)) % 1;
      ctx.strokeStyle = `rgba(242,85,85,${0.85 * (1 - beat)})`;
      ctx.lineWidth = Math.max(px * 1.5, 0.08);
      ctx.beginPath();
      ctx.arc(x, y, 1.2 + beat * 3.2, 0, Math.PI * 2);
      ctx.stroke();
      if (this.cam.z >= 5) sprite(ctx, "spawn", x, y, 0, 1.5);
      else {
        ctx.fillStyle = RED;
        ctx.fillRect(x - 2 * px, y - 2 * px, 4 * px, 4 * px);
      }
    }
  }

  /** Ore veins in colour and the routes ground units take from each spawn. */
  private drawTacticalGround(now: number, px: number): void {
    const { ctx, world } = this;
    const t = world.terrain!;
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.42;
    ctx.drawImage(t.oreMap, 0, 0, t.w, t.h);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = this.cam.z * this.dpr < 30;
    const mh = world.h;
    ctx.lineJoin = "round";
    for (const route of t.routes) {
      if (route.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(route[0].x, mh - route[0].y);
      for (let i = 1; i < route.length; i++) ctx.lineTo(route[i].x, mh - route[i].y);
      ctx.strokeStyle = "rgba(242,85,85,0.16)";
      ctx.lineWidth = Math.max(1.1, px * 6);
      ctx.stroke();
      ctx.strokeStyle = "rgba(242,85,85,0.9)";
      ctx.lineWidth = Math.max(0.14, px * 1.6);
      const dash = Math.max(0.9, px * 10);
      ctx.setLineDash([dash, dash * 0.8]);
      ctx.lineDashOffset = reducedMotion() ? 0 : -((now / 1000) * dash * 2.2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.lineJoin = "miter";
  }

  private drawUnits(
    now: number,
    px: number,
    Y: (wy: number) => number,
    seen: (x: number, y: number, pad?: number) => boolean,
    flying: boolean,
  ): void {
    const { ctx, world } = this;
    const sprites = atlasReady() && this.cam.z >= 5;
    for (const v of world.units.values()) {
      if (v.flying !== flying) continue;
      const x = v.x;
      const y = Y(v.y);
      if (!seen(x, y, 3)) continue;
      const home = v.u.team === HOME;
      const col = teamColor(v.u.team);
      const drone = v.u.id === world.droneId;
      if (drone) this.drawBeam(v, now, px, Y);

      if (v.trail.length > 1 && this.cam.z >= 6) {
        ctx.lineCap = "round";
        for (let i = 1; i < v.trail.length; i++) {
          const a = v.trail[i - 1];
          const b = v.trail[i];
          ctx.strokeStyle = col;
          ctx.globalAlpha = (i / v.trail.length) * (flying ? 0.5 : 0.22);
          ctx.lineWidth = (flying ? 0.22 : 0.14) * (i / v.trail.length);
          ctx.beginPath();
          ctx.moveTo(a.x, Y(a.y));
          ctx.lineTo(b.x, Y(b.y));
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.lineCap = "butt";
      }

      if (!sprites || !has(v.u.type)) {
        // Far out, or an unknown unit: a team-coloured dart.
        const r = Math.max(0.55, 3.5 * px);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((-v.rot * Math.PI) / 180);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(r * 1.2, 0);
        ctx.lineTo(-r * 0.8, -r * 0.75);
        ctx.lineTo(-r * 0.4, 0);
        ctx.lineTo(-r * 0.8, r * 0.75);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else {
        const shadow = tinted(v.u.type, "#000");
        if (shadow) {
          ctx.globalAlpha = flying ? 0.3 : 0.38;
          if (flying) sprite(ctx, shadow, x - 0.45, y + 0.6, v.rot - 90, 0.92);
          else sprite(ctx, shadow, x - 0.06, y + 0.1, v.rot - 90, 1.04);
          ctx.globalAlpha = 1;
        }
        if (!flying && has(`${v.u.type}-leg`)) {
          // Mechs walk: two legs swinging against each other, driven by distance covered.
          const stride = Math.sin((v.x + v.y) * 2.4) * 0.16;
          const a = (v.rot * Math.PI) / 180;
          const fx = Math.cos(a);
          const fy = -Math.sin(a);
          sprite(ctx, `${v.u.type}-leg`, x + fx * stride, y + fy * stride, v.rot - 90);
          sprite(ctx, `${v.u.type}-leg`, x - fx * stride, y - fy * stride, v.rot + 90);
          sprite(ctx, `${v.u.type}-base`, x, y, v.rot - 90);
        }
        if (drone) {
          // Engine glow behind the ship, brighter the faster it is travelling.
          const a = (v.rot * Math.PI) / 180;
          const speed = Math.min(1, Math.hypot(v.u.x - v.x0, v.u.y - v.y0) / 1.2);
          const flick = reducedMotion() ? 1 : 0.85 + 0.15 * Math.sin(now / 45);
          const r = (0.42 + speed * 0.5) * flick;
          ctx.globalCompositeOperation = "lighter";
          ctx.globalAlpha = 0.55 + speed * 0.4;
          ctx.drawImage(
            glow("#ffc56e"),
            x - Math.cos(a) * 0.55 - r,
            y + Math.sin(a) * 0.55 - r,
            r * 2,
            r * 2,
          );
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = "source-over";
        }
        sprite(ctx, v.u.type, x, y, v.rot - 90);
        const hit = now - v.hitAt;
        if (hit < 160) {
          const white = tinted(v.u.type, "#ffffff");
          if (white) {
            ctx.globalAlpha = 0.75 * (1 - hit / 160);
            sprite(ctx, white, x, y, v.rot - 90);
            ctx.globalAlpha = 1;
          }
        }
      }
      if (v.u.hp < v.u.maxHp - 0.5 && v.u.maxHp > 0 && this.cam.z >= 7) {
        this.bar(x, y - 0.95, 1.3, v.u.hp / v.u.maxHp, home, px);
      }
    }
  }

  /** The builder ship's weld beam: Mindustry's fan of light from the ship to the block it is placing. */
  private drawBeam(v: UView, now: number, px: number, Y: (wy: number) => number): void {
    const b = this.world.build;
    if (!b || this.cam.z < 5) return;
    const { ctx } = this;
    const x = v.x;
    const y = Y(v.y);
    const tx = b.cx;
    const ty = Y(b.cy);
    const len = Math.hypot(tx - x, ty - y);
    if (len < 0.01 || len > 60) return;
    // The fan opens to the block's width, square to the line of sight.
    const nx = (-(ty - y) / len) * b.size * 0.5;
    const ny = ((tx - x) / len) * b.size * 0.5;
    const pulse = reducedMotion() ? 0.8 : 0.7 + 0.3 * Math.sin(now / 90);
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "#98ffa9";
    ctx.globalAlpha = 0.16 * pulse;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(tx + nx, ty + ny);
    ctx.lineTo(tx - nx, ty - ny);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.75 * pulse;
    ctx.strokeStyle = "#98ffa9";
    ctx.lineWidth = Math.max(px, 0.06);
    ctx.beginPath();
    ctx.moveTo(tx + nx, ty + ny);
    ctx.lineTo(x, y);
    ctx.lineTo(tx - nx, ty - ny);
    ctx.stroke();
    const half = b.size / 2 + 0.06;
    ctx.globalAlpha = 0.22 * pulse;
    ctx.fillRect(tx - half, ty - half, half * 2, half * 2);
    ctx.globalAlpha = pulse;
    ctx.lineWidth = Math.max(px * 1.5, 0.08);
    ctx.strokeRect(tx - half, ty - half, half * 2, half * 2);
    const r = 0.7 * pulse;
    ctx.globalAlpha = 0.6;
    ctx.drawImage(glow("#98ffa9"), tx - r, ty - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  /** The callsign plate under the builder ship: line colour bar and the exact model id. */
  private drawCallsign(): void {
    const v = this.world.units.get(this.world.droneId);
    if (!v || !this.callsign || this.cam.z < 9) return;
    const key = `${this.callsign}|${this.callsignColor}|${this.dpr}`;
    if (this.tag?.key !== key) {
      const k = this.dpr;
      const c = document.createElement("canvas");
      const x = c.getContext("2d")!;
      const font = `700 ${11 * k}px "Commit Mono", ui-monospace, monospace`;
      x.font = font;
      const w = Math.ceil(x.measureText(this.callsign).width + 15 * k);
      c.width = w;
      c.height = Math.ceil(17 * k);
      x.fillStyle = "rgba(13,12,10,0.92)";
      x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = this.callsignColor;
      x.fillRect(0, 0, 3 * k, c.height);
      x.font = font;
      x.textBaseline = "middle";
      x.fillStyle = "#efe9dc";
      x.fillText(this.callsign, 9 * k, c.height / 2 + 0.5 * k);
      this.tag = { key, canvas: c };
    }
    const { ctx } = this;
    const s = this.cam.z * this.dpr;
    const sx = this.canvas.width / 2 + (v.x - this.cam.x) * s;
    const sy = this.canvas.height / 2 + (this.world.h - v.y - this.cam.y) * s;
    const tag = this.tag.canvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(tag, Math.round(sx - tag.width / 2), Math.round(sy + Math.max(0.9 * s, 16 * this.dpr)));
  }

  /** Keep the last few seconds of frame times, and trade resolution for smoothness if they run long. */
  private measure(ms: number): void {
    if (ms <= 0 || ms > 250) return;
    this.frames[this.frameCount++ % this.frames.length] = ms;
    this.slow = this.slow * 0.97 + (ms > 22 ? 1 : 0) * 0.03;
    if (this.slow > 0.45 && this.quality > 0.5 && this.frameCount > 180) {
      this.quality -= 0.25;
      this.slow = 0;
      this.frameCount = 0;
      this.resize();
    }
  }

  /** p50, p95 and worst frame time over the last few seconds. */
  perf(): { p50: number; p95: number; max: number; long: number; quality: number } {
    const n = Math.min(this.frameCount, this.frames.length);
    const sorted = Array.from(this.frames.subarray(0, n)).sort((a, b) => a - b);
    const at = (q: number) => +(sorted[Math.min(n - 1, Math.floor(n * q))] || 0).toFixed(1);
    return {
      p50: at(0.5),
      p95: at(0.95),
      max: at(1),
      long: sorted.filter((v) => v > 25).length,
      quality: this.quality,
    };
  }

  private bar(cx: number, y: number, w: number, frac: number, home: boolean, px: number): void {
    const { ctx } = this;
    const hgt = Math.max(0.13, px * 3);
    ctx.fillStyle = "#0b0a08";
    ctx.fillRect(cx - w / 2 - px, y - px, w + px * 2, hgt + px * 2);
    ctx.fillStyle = home ? (frac < 0.35 ? RED : YELLOW) : RED;
    ctx.fillRect(cx - w / 2, y, w * clamp(frac, 0, 1), hgt);
  }

  private drawFx(
    now: number,
    px: number,
    Y: (wy: number) => number,
    seen: (x: number, y: number, pad?: number) => boolean,
  ): void {
    const { ctx, world } = this;
    for (const f of world.fx) {
      if (f.t === "scorch" || f.t === "ping") continue;
      const age = now - f.born;
      const t = age / f.life;
      if (t < 0 || t >= 1) continue;
      if (f.t === "smoke") {
        const x = f.x + (f.vx * age) / 1000;
        const y = Y(f.y + (f.vy * age) / 1000);
        if (!seen(x, y, 2)) continue;
        ctx.globalAlpha = 0.34 * (1 - t);
        ctx.fillStyle = "#1c1915";
        ctx.beginPath();
        ctx.arc(x, y, f.size * (0.6 + t), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (const f of world.fx) {
      const age = now - f.born;
      const t = age / f.life;
      if (t < 0 || t >= 1) continue;
      if (f.t === "spark") {
        const drag = 1 - t * 0.5;
        const x = f.x + ((f.vx * age) / 1000) * drag;
        const y = Y(f.y + ((f.vy * age) / 1000) * drag);
        if (!seen(x, y)) continue;
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = Math.max(0.07, px * 1.3);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - f.vx * 0.035, y + f.vy * 0.035);
        ctx.stroke();
      } else if (f.t === "flash") {
        const y = Y(f.y);
        if (!seen(f.x, y, 3)) continue;
        const r = f.size * (0.5 + t * 0.6);
        ctx.globalAlpha = 1 - t;
        ctx.drawImage(glow(f.color), f.x - r, y - r, r * 2, r * 2);
      } else if (f.t === "ring") {
        const y = Y(f.y);
        if (!seen(f.x, y, 6)) continue;
        ctx.globalAlpha = (1 - t) * 0.9;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = Math.max(px, 0.22 * (1 - t));
        ctx.beginPath();
        ctx.arc(f.x, y, f.size * (1 - (1 - t) ** 3), 0, Math.PI * 2);
        ctx.stroke();
      } else if (f.t === "place") {
        const y = Y(f.y);
        if (!seen(f.x, y, 3)) continue;
        // A negative size is a block being taken away: the outline closes in instead of opening out.
        const half = f.size > 0 ? (f.size / 2) * (1 + t * 0.55) : (-f.size / 2) * (1 - t * 0.7);
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = f.size > 0 ? "#ffe9b8" : "#b3ac9c";
        ctx.lineWidth = Math.max(px, 0.14 * (1 - t));
        ctx.strokeRect(f.x - half, y - half, half * 2, half * 2);
      } else if (f.t === "tracer") {
        const head = Math.min(f.reach, (f.speed * age) / 1000);
        const tail = Math.max(0, head - (f.big ? 1.9 : 1.3));
        const hx = f.x + f.dx * head;
        const hy = Y(f.y + f.dy * head);
        if (!seen(hx, hy, 3)) continue;
        const home = f.team === HOME;
        ctx.globalAlpha = f.speed ? 1 : 1 - t;
        if (f.speed) {
          // The tail is three strokes of falling brightness: the look of a gradient without building one.
          const ex = Y(f.y + f.dy * tail) - hy;
          const dx = f.x + f.dx * tail - hx;
          ctx.strokeStyle = home ? "#ffe2a0" : "#ff7a66";
          const wide = Math.max(px * 1.5, f.big ? 0.24 : 0.15);
          for (let k = 0; k < 3; k++) {
            ctx.globalAlpha = 1 - k * 0.36;
            ctx.lineWidth = wide * (1 - k * 0.22);
            ctx.beginPath();
            ctx.moveTo(hx + (dx * k) / 3, hy + (ex * k) / 3);
            ctx.lineTo(hx + (dx * (k + 1)) / 3, hy + (ex * (k + 1)) / 3);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = home ? "#fff6dc" : "#ffd0c4";
        ctx.beginPath();
        ctx.arc(hx, hy, Math.max(px * 1.5, f.big ? 0.2 : 0.13), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.lineCap = "butt";
  }

  /** Selection, hover and the markers the feed drops when a model acts on a tile. */
  private drawMarks(now: number, px: number, Y: (wy: number) => number): void {
    const { ctx, world } = this;
    for (const f of world.fx) {
      if (f.t !== "ping") continue;
      const t = (now - f.born) / f.life;
      if (t < 0 || t >= 1) continue;
      const y = Y(f.y);
      const col = f.ok ? YELLOW : RED;
      const grow = reducedMotion() ? 1 : 1 - (1 - Math.min(1, t * 5)) ** 3;
      const half = Math.max(0.5, 7 * px) * (2.2 - 1.2 * grow);
      ctx.globalAlpha = 1 - t ** 3;
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(0.09, px * 1.5);
      ctx.strokeRect(f.x - half, y - half, half * 2, half * 2);
      if (!f.ok) {
        ctx.beginPath();
        ctx.moveTo(f.x - half * 0.55, y - half * 0.55);
        ctx.lineTo(f.x + half * 0.55, y + half * 0.55);
        ctx.moveTo(f.x + half * 0.55, y - half * 0.55);
        ctx.lineTo(f.x - half * 0.55, y + half * 0.55);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    const mark = (p: Pick | null, strong: boolean) => {
      if (!p) return;
      let x: number;
      let y: number;
      let size: number;
      if (p.kind === "unit") {
        const u = world.units.get(p.id);
        if (!u) return;
        x = u.x - 0.8;
        y = Y(u.y) - 0.8;
        size = 1.6;
      } else if (p.kind === "building") {
        const b = world.buildings.get(p.key);
        if (!b) return;
        x = b.ox;
        y = Y(b.oy + b.b.size);
        size = b.b.size;
      } else {
        x = p.x;
        y = Y(p.y + 1);
        size = 1;
      }
      // Corner brackets, so the thing itself stays visible.
      const arm = Math.min(size * 0.3, Math.max(0.24, 5 * px));
      const out = strong ? Math.max(0.08, 2 * px) : 0;
      ctx.strokeStyle = strong ? YELLOW : "rgba(239,233,220,0.85)";
      ctx.lineWidth = Math.max(px * (strong ? 2 : 1), 0.05);
      ctx.beginPath();
      const x0 = x - out;
      const y0 = y - out;
      const x1 = x + size + out;
      const y1 = y + size + out;
      for (const [cx, cy, dx, dy] of [
        [x0, y0, 1, 1],
        [x1, y0, -1, 1],
        [x0, y1, 1, -1],
        [x1, y1, -1, -1],
      ]) {
        ctx.moveTo(cx + dx * arm, cy);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx, cy + dy * arm);
      }
      ctx.stroke();
    };
    mark(this.hover, false);
    mark(this.selected, true);
  }
}
