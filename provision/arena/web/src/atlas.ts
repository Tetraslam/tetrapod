/**
 * The official Mindustry v159.7 sprite atlas, served by the arena at /sprites.
 * Everything here degrades to "not available" so callers can fall back to flat colour.
 */
type Region = [page: number, x: number, y: number, w: number, h: number];

const regions = new Map<string, Region>();
const pages: ImageBitmap[] = [];
let ready = false;
const waiters: Array<() => void> = [];

export const TILE_PX = 32;

export async function loadAtlas(): Promise<void> {
  try {
    const res = await fetch("/sprites/atlas.json");
    if (!res.ok) throw new Error(`atlas ${res.status}`);
    const json = (await res.json()) as { pages: string[]; regions: Record<string, Region> };
    const loaded = await Promise.all(
      json.pages.map(async (name) => {
        const blob = await (await fetch(`/sprites/${name}`)).blob();
        return createImageBitmap(blob);
      }),
    );
    pages.push(...loaded);
    for (const [name, r] of Object.entries(json.regions)) regions.set(name, r);
    ready = true;
  } catch (err) {
    console.warn("sprite atlas unavailable, drawing flat colours", err);
  }
  for (const fn of waiters.splice(0)) fn();
}

export const atlasReady = (): boolean => ready;
export function onAtlas(fn: () => void): void {
  if (ready) fn();
  else waiters.push(fn);
}

export const has = (name: string): boolean => regions.has(name);
export const region = (name: string): Region | undefined => regions.get(name);

/** How many numbered variants a sprite has ("grass1".."grass3" gives 3). */
const variantCache = new Map<string, number>();
export function variants(base: string): number {
  let n = variantCache.get(base);
  if (n === undefined) {
    n = 0;
    while (regions.has(`${base}${n + 1}`)) n++;
    if (ready) variantCache.set(base, n);
  }
  return n;
}

/** Draw a region stretched into a destination rect. Returns false when the sprite is missing. */
export function blit(
  ctx: CanvasRenderingContext2D,
  name: string,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): boolean {
  const r = regions.get(name);
  if (!r) return false;
  ctx.drawImage(pages[r[0]], r[1], r[2], r[3], r[4], dx, dy, dw, dh);
  return true;
}

let baseS = 1;
let baseX = 0;
let baseY = 0;

/** Set the tile-space transform every sprite() call draws in: `s` device px per tile, origin at (ox, oy). */
export function setBase(ctx: CanvasRenderingContext2D, s: number, ox: number, oy: number): void {
  baseS = s;
  baseX = ox;
  baseY = oy;
  ctx.setTransform(s, 0, 0, s, ox, oy);
}

/**
 * Draw a sprite centred on (cx, cy) in tile units at its native scale (32px per tile).
 * `rot` is degrees counter-clockwise, the way Mindustry measures it. Rotated sprites set the
 * matrix directly: save() and restore() around every belt tile is slow in Firefox.
 */
export function sprite(
  ctx: CanvasRenderingContext2D,
  name: string | HTMLCanvasElement,
  cx: number,
  cy: number,
  rot = 0,
  scale = 1,
  flipY = false,
): boolean {
  let src: CanvasImageSource;
  let sx = 0;
  let sy = 0;
  let w: number;
  let hgt: number;
  if (typeof name === "string") {
    const r = regions.get(name);
    if (!r) return false;
    src = pages[r[0]];
    sx = r[1];
    sy = r[2];
    w = r[3];
    hgt = r[4];
  } else {
    src = name;
    w = name.width;
    hgt = name.height;
  }
  const dw = (w / TILE_PX) * scale;
  const dh = (hgt / TILE_PX) * scale;
  if (rot === 0 && !flipY) {
    ctx.drawImage(src, sx, sy, w, hgt, cx - dw / 2, cy - dh / 2, dw, dh);
    return true;
  }
  const a = (-rot * Math.PI) / 180;
  const c = Math.cos(a) * baseS;
  const sn = Math.sin(a) * baseS;
  const f = flipY ? -1 : 1;
  ctx.setTransform(c, sn, -sn * f, c * f, baseX + cx * baseS, baseY + cy * baseS);
  ctx.drawImage(src, sx, sy, w, hgt, -dw / 2, -dh / 2, dw, dh);
  ctx.setTransform(baseS, 0, 0, baseS, baseX, baseY);
  return true;
}

const glowCache = new Map<string, HTMLCanvasElement>();

/**
 * A soft round glow as a small picture, drawn with drawImage. Building a radial gradient for
 * every flash every frame stalls Gecko's canvas, a cached bitmap does not.
 */
export function glow(color: string): HTMLCanvasElement {
  let c = glowCache.get(color);
  if (!c) {
    c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const x = c.getContext("2d")!;
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, color);
    g.addColorStop(0.35, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    glowCache.set(color, c);
  }
  return c;
}

const tintCache = new Map<string, HTMLCanvasElement | null>();

/**
 * A recoloured copy of a sprite. "fill" keeps only the shape (shadows, hit flashes),
 * "multiply" keeps the shading (team cells are drawn white in the atlas).
 */
export function tinted(
  name: string,
  color: string,
  mode: "fill" | "multiply" = "fill",
): HTMLCanvasElement | null {
  const key = `${name}|${color}|${mode}`;
  const hit = tintCache.get(key);
  if (hit !== undefined) return hit;
  const r = regions.get(name);
  if (!r) {
    if (ready) tintCache.set(key, null);
    return null;
  }
  const c = document.createElement("canvas");
  c.width = r[3];
  c.height = r[4];
  const x = c.getContext("2d")!;
  x.drawImage(pages[r[0]], r[1], r[2], r[3], r[4], 0, 0, r[3], r[4]);
  if (mode === "multiply") {
    x.globalCompositeOperation = "multiply";
    x.fillStyle = color;
    x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = "destination-in";
    x.drawImage(pages[r[0]], r[1], r[2], r[3], r[4], 0, 0, r[3], r[4]);
  } else {
    x.globalCompositeOperation = "source-in";
    x.fillStyle = color;
    x.fillRect(0, 0, c.width, c.height);
  }
  tintCache.set(key, c);
  return c;
}

const iconCache = new Map<string, string | null>();

/** A sprite as a data URL, for <img> icons in the chrome. */
export function iconURL(name: string): string | null {
  const hit = iconCache.get(name);
  if (hit !== undefined) return hit;
  const r = regions.get(name);
  let url: string | null = null;
  if (r) {
    const c = document.createElement("canvas");
    c.width = r[3];
    c.height = r[4];
    c.getContext("2d")!.drawImage(pages[r[0]], r[1], r[2], r[3], r[4], 0, 0, r[3], r[4]);
    url = c.toDataURL();
  }
  if (ready) iconCache.set(name, url);
  return url;
}

/** The best single-image icon for a block, unit or item name. */
export function iconFor(name: string): string | null {
  for (const candidate of [`${name}-preview`, `block-${name}-ui`, name, `unit-${name}-ui`, `item-${name}`]) {
    if (regions.has(candidate)) return iconURL(candidate);
  }
  return null;
}
