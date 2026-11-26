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

/**
 * Draw a sprite centred on (cx, cy) in tile units at its native scale (32px per tile).
 * `rot` is degrees counter-clockwise, the way Mindustry measures it.
 */
export function sprite(
  ctx: CanvasRenderingContext2D,
  name: string | CanvasImageSource,
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
    [, sx, sy, w, hgt] = r;
  } else {
    src = name;
    w = (name as HTMLCanvasElement).width;
    hgt = (name as HTMLCanvasElement).height;
  }
  const dw = (w / TILE_PX) * scale;
  const dh = (hgt / TILE_PX) * scale;
  if (rot === 0 && !flipY) {
    ctx.drawImage(src, sx, sy, w, hgt, cx - dw / 2, cy - dh / 2, dw, dh);
    return true;
  }
  ctx.save();
  ctx.translate(cx, cy);
  if (rot !== 0) ctx.rotate((-rot * Math.PI) / 180);
  if (flipY) ctx.scale(1, -1);
  ctx.drawImage(src, sx, sy, w, hgt, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
  return true;
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
