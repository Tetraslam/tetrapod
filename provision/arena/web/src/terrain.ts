import { atlasReady, blit, has, variants } from "./atlas";
import type { Point, Terrain } from "./types";
import { hash2 } from "./util";

export const ORE_COLORS: Record<string, string> = {
  copper: "#d99d73",
  lead: "#8c7fa9",
  coal: "#7b7b86",
  sand: "#f7cba4",
  scrap: "#a3a3a3",
  titanium: "#8da1e3",
  thorium: "#f9a3c7",
  beryllium: "#58c08a",
  tungsten: "#8fa3b3",
};

type TileInfo = { wall: boolean; sprites: string[]; large: string | null };
type Level = { tpc: number; ppt: number };
type Chunk = { canvas: HTMLCanvasElement; used: number };

const MID: Level = { tpc: 32, ppt: 16 };
const HI: Level = { tpc: 16, ppt: 32 };
const MAX_CHUNKS = 140;
const DARK_ALPHA = [0, 0, 0, 0.3, 0.56, 0.78, 0.92, 1];

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function unrle(rle: number[], out: Uint8Array | Uint16Array): void {
  let i = 0;
  for (let k = 0; k + 1 < rle.length; k += 2) {
    out.fill(rle[k], i, i + rle[k + 1]);
    i += rle[k + 1];
  }
}

/**
 * One map's terrain: decoded tiles plus every cached picture of it.
 * World space is Mindustry's (y up). Map space is screen-like (y down): my = h - 1 - y.
 */
export class TerrainModel {
  readonly map: string;
  readonly w: number;
  readonly h: number;
  readonly spawns: Point[];
  readonly core: Point | null;
  readonly oreNames: string[] = [];
  /** Flat colour, 1px per tile. The fallback picture and the first thing on screen. */
  readonly base: HTMLCanvasElement;
  /** Darkness over deep rock, 1px per tile, drawn smoothed. */
  readonly dark: HTMLCanvasElement;
  /** Ore tiles in their item colour, 1px per tile, for the tactical overlay. */
  readonly oreMap: HTMLCanvasElement;
  /** Real sprites at a few px per tile, for zoomed-out views and the minimap. */
  readonly low: HTMLCanvasElement;
  readonly lowPpt: number;
  /** Ground routes from each spawn to the core, as world-space points. */
  routes: Point[][] = [];

  private readonly cell: Uint16Array;
  private readonly pal: Uint8Array;
  private readonly palette: string[];
  private readonly ore: Uint8Array;
  private readonly wall: Uint8Array;
  private infos: TileInfo[] = [];
  private readonly names: string[];
  private readonly chunks = new Map<string, Chunk>();
  private lowRow = 0;
  private spritesBound = false;
  private frame = 0;

  constructor(t: Terrain) {
    this.map = t.map;
    this.w = t.width;
    this.h = t.height;
    this.spawns = t.spawns || [];
    this.core = t.core;
    this.palette = t.palette;
    const n = this.w * this.h;
    this.pal = new Uint8Array(n);
    unrle(t.rle, this.pal);
    this.cell = new Uint16Array(n);
    this.names = t.tileNames || [];
    if (t.tileRle) unrle(t.tileRle, this.cell);
    this.wall = new Uint8Array(n);
    for (let i = 0; i < n; i++) this.wall[i] = this.names[this.cell[i]]?.startsWith("W:") ? 1 : 0;

    this.ore = new Uint8Array(n);
    for (const [x, y, name] of t.ores || []) {
      let idx = this.oreNames.indexOf(name);
      if (idx < 0) idx = this.oreNames.push(name) - 1;
      // Ore buried under solid rock can't be seen or mined, so it doesn't count.
      if (x >= 0 && y >= 0 && x < this.w && y < this.h && !this.wall[y * this.w + x])
        this.ore[y * this.w + x] = idx + 1;
    }

    this.base = this.paintBase();
    this.dark = this.paintDark();
    this.oreMap = this.paintOres();
    this.lowPpt = Math.max(1, Math.min(4, Math.floor(2048 / Math.max(this.w, this.h))));
    this.low = makeCanvas(this.w * this.lowPpt, this.h * this.lowPpt);
    this.routes = this.findRoutes();
  }

  isWall(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return true;
    return this.wall[y * this.w + x] === 1;
  }

  tileName(x: number, y: number): string {
    const name = this.names[this.cell[y * this.w + x]] || "";
    return name.startsWith("W:") ? name.slice(2) : name;
  }

  oreAt(x: number, y: number): string | null {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    const o = this.ore[y * this.w + x];
    return o ? this.oreNames[o - 1] : null;
  }

  private bindSprites(): void {
    this.spritesBound = true;
    this.infos = this.names.map((raw) => {
      const wall = raw.startsWith("W:");
      const name = wall ? raw.slice(2) : raw;
      const count = variants(name);
      const sprites: string[] = [];
      for (let i = 1; i <= count; i++) sprites.push(`${name}${i}`);
      if (!sprites.length && has(name)) sprites.push(name);
      return { wall, sprites, large: wall && has(`${name}-large`) ? `${name}-large` : null };
    });
  }

  private paintBase(): HTMLCanvasElement {
    const c = makeCanvas(this.w, this.h);
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(this.w, this.h);
    const rgb = this.palette.map((hex) => {
      const v = Number.parseInt(hex.slice(1), 16);
      return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    });
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const col = rgb[this.pal[y * this.w + x]] || [22, 21, 19];
        const p = ((this.h - 1 - y) * this.w + x) * 4;
        img.data[p] = col[0];
        img.data[p + 1] = col[1];
        img.data[p + 2] = col[2];
        img.data[p + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /** Rock more than a tile from open ground fades to black, like the game's own fog. */
  private paintDark(): HTMLCanvasElement {
    const { w, h } = this;
    const depth = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < w * h; i++) {
      if (this.wall[i]) depth[i] = 255;
      else queue[tail++] = i;
    }
    while (head < tail) {
      const i = queue[head++];
      const d = depth[i] + 1;
      if (d >= DARK_ALPHA.length) continue;
      const x = i % w;
      const y = (i - x) / w;
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (depth[j] === 255) {
          depth[j] = d;
          queue[tail++] = j;
        }
      }
    }
    const c = makeCanvas(w, h);
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = depth[y * w + x];
        const a = d === 255 ? DARK_ALPHA[DARK_ALPHA.length - 1] : DARK_ALPHA[d];
        const p = ((h - 1 - y) * w + x) * 4;
        img.data[p] = 6;
        img.data[p + 1] = 5;
        img.data[p + 2] = 4;
        img.data[p + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  private paintOres(): HTMLCanvasElement {
    const c = makeCanvas(this.w, this.h);
    const ctx = c.getContext("2d")!;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const o = this.ore[y * this.w + x];
        if (!o) continue;
        ctx.fillStyle = ORE_COLORS[this.oreNames[o - 1]] || "#efe9dc";
        ctx.fillRect(x, this.h - 1 - y, 1, 1);
      }
    }
    return c;
  }

  /** One tile into a destination rect: floor or wall sprite, then ore. Flat colour if a sprite is missing. */
  private drawTile(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    dx: number,
    dy: number,
    s: number,
  ): void {
    const i = y * this.w + x;
    const info = this.infos[this.cell[i]];
    const hsh = hash2(x, y);
    const name = info?.sprites.length ? info.sprites[hsh % info.sprites.length] : null;
    if (!name || !blit(ctx, name, dx, dy, s, s)) {
      ctx.fillStyle = this.palette[this.pal[i]] || "#161513";
      ctx.fillRect(dx, dy, s, s);
    }
    const o = this.ore[i];
    if (o) {
      const ore = this.oreNames[o - 1];
      const count = variants(`ore-${ore}`);
      if (!count || !blit(ctx, `ore-${ore}${1 + ((hsh >>> 8) % count)}`, dx, dy, s, s)) {
        ctx.fillStyle = ORE_COLORS[ore] || "#efe9dc";
        ctx.fillRect(dx + s * 0.3, dy + s * 0.3, s * 0.4, s * 0.4);
      }
    }
  }

  /** Bake a few rows of the low-detail picture. Called every frame until it reports done. */
  stepLow(budgetMs: number): boolean {
    if (this.lowRow >= this.h) return true;
    if (!atlasReady() || !this.names.length) return false;
    if (!this.spritesBound) this.bindSprites();
    const ctx = this.low.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    const p = this.lowPpt;
    const until = performance.now() + budgetMs;
    while (this.lowRow < this.h && performance.now() < until) {
      const y = this.h - 1 - this.lowRow;
      for (let x = 0; x < this.w; x++) this.drawTile(ctx, x, y, x * p, this.lowRow * p, p);
      this.lowRow++;
    }
    return this.lowRow >= this.h;
  }

  get lowReady(): boolean {
    return this.lowRow >= this.h;
  }

  private bakeChunk(level: Level, cx: number, cy: number): HTMLCanvasElement {
    const { tpc, ppt } = level;
    const c = makeCanvas(tpc * ppt, tpc * ppt);
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = ppt < 32;
    ctx.fillStyle = "#060504";
    ctx.fillRect(0, 0, c.width, c.height);
    const skip = new Uint8Array(tpc * tpc);
    const mx0 = cx * tpc;
    const my0 = cy * tpc;
    for (let ly = 0; ly < tpc; ly++) {
      const y = this.h - 1 - (my0 + ly);
      if (y < 0 || y >= this.h) continue;
      for (let lx = 0; lx < tpc; lx++) {
        const x = mx0 + lx;
        if (x >= this.w || skip[ly * tpc + lx]) continue;
        const i = y * this.w + x;
        const info = this.infos[this.cell[i]];
        // Mindustry draws some rock as 2x2 boulders. Same rule here: aligned, uniform and a coin flip.
        if (
          info?.large &&
          (x & 1) === 0 &&
          (y & 1) === 0 &&
          lx + 1 < tpc &&
          ly >= 1 &&
          x + 1 < this.w &&
          y + 1 < this.h &&
          (hash2(x, y) & 1) === 0 &&
          this.cell[i + 1] === this.cell[i] &&
          this.cell[i + this.w] === this.cell[i] &&
          this.cell[i + this.w + 1] === this.cell[i] &&
          !this.ore[i] &&
          blit(ctx, info.large, lx * ppt, (ly - 1) * ppt, ppt * 2, ppt * 2)
        ) {
          skip[ly * tpc + lx + 1] = 1;
          continue;
        }
        this.drawTile(ctx, x, y, lx * ppt, ly * ppt, ppt);
      }
    }
    // Contact shadow where open floor meets rock, so walls read as raised.
    const band = Math.round(ppt * 0.34);
    for (let ly = 0; ly < tpc; ly++) {
      const y = this.h - 1 - (my0 + ly);
      if (y < 0 || y >= this.h) continue;
      for (let lx = 0; lx < tpc; lx++) {
        const x = mx0 + lx;
        if (x >= this.w || this.wall[y * this.w + x]) continue;
        const px = lx * ppt;
        const py = ly * ppt;
        if (this.isWall(x, y + 1)) this.shade(ctx, px, py, ppt, band, 0, 1);
        if (this.isWall(x, y - 1)) this.shade(ctx, px, py + ppt - band, ppt, band, 0, -1);
        if (this.isWall(x - 1, y)) this.shade(ctx, px, py, band, ppt, 1, 0);
        if (this.isWall(x + 1, y)) this.shade(ctx, px + ppt - band, py, band, ppt, -1, 0);
      }
    }
    return c;
  }

  private shade(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    gx: number,
    gy: number,
  ): void {
    const g = ctx.createLinearGradient(
      gx < 0 ? x + w : x,
      gy < 0 ? y + h : y,
      gx > 0 ? x + w : gx < 0 ? x : x,
      gy > 0 ? y + h : gy < 0 ? y : y,
    );
    g.addColorStop(0, "rgba(0,0,0,0.42)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }

  /**
   * Paint the visible terrain. `ox, oy` is where map-space (0,0) lands in device pixels and
   * `s` is device pixels per tile. Picks the cheapest picture that still looks sharp.
   */
  draw(ctx: CanvasRenderingContext2D, ox: number, oy: number, s: number, vw: number, vh: number): void {
    this.frame++;
    const x0 = Math.max(0, Math.floor(-ox / s));
    const y0 = Math.max(0, Math.floor(-oy / s));
    const x1 = Math.min(this.w, Math.ceil((vw - ox) / s));
    const y1 = Math.min(this.h, Math.ceil((vh - oy) / s));
    if (x1 <= x0 || y1 <= y0) return;
    const whole = (img: HTMLCanvasElement, ppt: number) => {
      ctx.drawImage(
        img,
        x0 * ppt,
        y0 * ppt,
        (x1 - x0) * ppt,
        (y1 - y0) * ppt,
        Math.round(ox + x0 * s),
        Math.round(oy + y0 * s),
        Math.round((x1 - x0) * s),
        Math.round((y1 - y0) * s),
      );
    };

    const detailed = atlasReady() && this.names.length > 0;
    if (detailed && !this.spritesBound) this.bindSprites();

    if (!detailed || s <= this.lowPpt * 1.6) {
      ctx.imageSmoothingEnabled = false;
      whole(this.base, 1);
      ctx.imageSmoothingEnabled = s < this.lowPpt;
      whole(this.low, this.lowPpt);
    } else {
      const level = s <= 20 ? MID : HI;
      const { tpc, ppt } = level;
      let budget = 3;
      for (let cy = Math.floor(y0 / tpc); cy * tpc < y1; cy++) {
        for (let cx = Math.floor(x0 / tpc); cx * tpc < x1; cx++) {
          const key = `${ppt}:${cx}:${cy}`;
          let chunk = this.chunks.get(key);
          if (!chunk && budget > 0) {
            budget--;
            chunk = { canvas: this.bakeChunk(level, cx, cy), used: this.frame };
            this.chunks.set(key, chunk);
          }
          const dx0 = Math.round(ox + cx * tpc * s);
          const dy0 = Math.round(oy + cy * tpc * s);
          const dx1 = Math.round(ox + (cx + 1) * tpc * s);
          const dy1 = Math.round(oy + (cy + 1) * tpc * s);
          if (chunk) {
            chunk.used = this.frame;
            ctx.imageSmoothingEnabled = s < ppt;
            ctx.drawImage(chunk.canvas, dx0, dy0, dx1 - dx0, dy1 - dy0);
          } else {
            // Not baked yet this frame: stand in with the low-detail picture.
            const sx = cx * tpc;
            const sy = cy * tpc;
            const sw = Math.min(tpc, this.w - sx);
            const sh = Math.min(tpc, this.h - sy);
            if (sw <= 0 || sh <= 0) continue;
            ctx.imageSmoothingEnabled = false;
            const src = this.lowReady ? this.low : this.base;
            const p = this.lowReady ? this.lowPpt : 1;
            ctx.drawImage(src, sx * p, sy * p, sw * p, sh * p, dx0, dy0, sw * s, sh * s);
          }
        }
      }
      if (this.chunks.size > MAX_CHUNKS) this.evict();
    }

    ctx.imageSmoothingEnabled = true;
    const px0 = Math.max(0, x0 - 1);
    const py0 = Math.max(0, y0 - 1);
    const px1 = Math.min(this.w, x1 + 1);
    const py1 = Math.min(this.h, y1 + 1);
    ctx.drawImage(
      this.dark,
      px0,
      py0,
      px1 - px0,
      py1 - py0,
      ox + px0 * s,
      oy + py0 * s,
      (px1 - px0) * s,
      (py1 - py0) * s,
    );
  }

  private evict(): void {
    const stale = [...this.chunks.entries()]
      .filter(([, c]) => c.used < this.frame)
      .sort((a, b) => a[1].used - b[1].used);
    for (const [key] of stale.slice(0, this.chunks.size - MAX_CHUNKS + 20)) this.chunks.delete(key);
  }

  /**
   * The way ground units walk in: breadth-first from the core over open floor, then each
   * spawn's path pulled taut so it reads as a route and not a staircase.
   */
  private findRoutes(): Point[][] {
    const { w, h } = this;
    if (!this.core || !this.spawns.length || !this.names.length) return [];
    const blocked = (x: number, y: number) =>
      x < 0 ||
      y < 0 ||
      x >= w ||
      y >= h ||
      this.wall[y * w + x] === 1 ||
      this.tileName(x, y).includes("deep");
    const dist = new Int32Array(w * h).fill(-1);
    const queue = new Int32Array(w * h);
    let head = 0;
    let tail = 0;
    const start = this.core.y * w + this.core.x;
    dist[start] = 0;
    queue[tail++] = start;
    const NX = [1, -1, 0, 0, 1, 1, -1, -1];
    const NY = [0, 0, 1, -1, 1, -1, 1, -1];
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      const y = (i - x) / w;
      for (let k = 0; k < 8; k++) {
        const nx = x + NX[k];
        const ny = y + NY[k];
        if (blocked(nx, ny)) continue;
        if (k >= 4 && (blocked(x + NX[k], y) || blocked(x, y + NY[k]))) continue;
        const j = ny * w + nx;
        if (dist[j] >= 0) continue;
        dist[j] = dist[i] + 1;
        queue[tail++] = j;
      }
    }
    const clear = (a: Point, b: Point) => {
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2);
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        for (const [ox, oy] of [
          [0.35, 0.35],
          [-0.35, 0.35],
          [0.35, -0.35],
          [-0.35, -0.35],
        ]) {
          if (blocked(Math.floor(x + ox), Math.floor(y + oy))) return false;
        }
      }
      return true;
    };
    const routes: Point[][] = [];
    for (const sp of this.spawns) {
      if (blocked(sp.x, sp.y) || dist[sp.y * w + sp.x] < 0) {
        routes.push([
          { x: sp.x + 0.5, y: sp.y + 0.5 },
          { x: this.core.x + 0.5, y: this.core.y + 0.5 },
        ]);
        continue;
      }
      const raw: Point[] = [];
      let x = sp.x;
      let y = sp.y;
      for (let guard = 0; guard < w * h; guard++) {
        raw.push({ x: x + 0.5, y: y + 0.5 });
        const d = dist[y * w + x];
        if (d === 0) break;
        let moved = false;
        for (let k = 0; k < 8 && !moved; k++) {
          const nx = x + NX[k];
          const ny = y + NY[k];
          if (blocked(nx, ny) || dist[ny * w + nx] !== d - 1) continue;
          if (k >= 4 && (blocked(x + NX[k], y) || blocked(x, y + NY[k]))) continue;
          x = nx;
          y = ny;
          moved = true;
        }
        if (!moved) break;
      }
      const taut: Point[] = [raw[0]];
      let at = 0;
      while (at < raw.length - 1) {
        let next = at + 1;
        for (let j = Math.min(raw.length - 1, at + 90); j > at + 1; j--) {
          if (clear(raw[at], raw[j])) {
            next = j;
            break;
          }
        }
        taut.push(raw[next]);
        at = next;
      }
      routes.push(taut);
    }
    return routes;
  }
}
