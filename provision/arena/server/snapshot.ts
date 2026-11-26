import { createCanvas, GlobalFonts, loadImage, type Image } from "@napi-rs/canvas";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

let fontRegistered = false;
function ensureFont(): string {
  if (!fontRegistered) {
    fontRegistered = true;
    for (const [path, alias] of [
      ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", "ArenaMono"],
      ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", "ArenaMonoBold"],
      ["/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf", "ArenaMono"],
    ]) {
      if (existsSync(path)) {
        try {
          GlobalFonts.registerFromPath(path, alias);
        } catch {
          // ignore
        }
      }
    }
  }
  return GlobalFonts.has("ArenaMono") ? "ArenaMono" : "monospace";
}

type AtlasData = {
  pages: string[];
  regions: Record<string, [number, number, number, number, number]>;
};

let atlasPromise: Promise<{ atlas: AtlasData; images: Image[] } | null> | null = null;

async function getAtlas(spritesDir: string): Promise<{ atlas: AtlasData; images: Image[] } | null> {
  if (!atlasPromise) {
    atlasPromise = (async () => {
      try {
        const atlas = JSON.parse(await readFile(join(spritesDir, "atlas.json"), "utf8")) as AtlasData;
        const images = await Promise.all(atlas.pages.map((p) => loadImage(join(spritesDir, p))));
        return { atlas, images };
      } catch {
        return null;
      }
    })();
  }
  return await atlasPromise;
}

const ORE_COLORS: Record<string, string> = {
  copper: "#d99d73",
  lead: "#8c7fa9",
  coal: "#3b3b44",
  sand: "#f7cba4",
  scrap: "#7e7e88",
  titanium: "#8da1e3",
  thorium: "#f9a3c7",
};

const TURRET_RANGES: Record<string, number> = {
  duo: 20,
  scatter: 28,
  scorch: 8,
  hail: 29,
  wave: 14,
  lancer: 20,
  arc: 11,
  parallax: 30,
  swarmer: 30,
  salvo: 23,
  segment: 22,
  tsunami: 24,
  fuse: 11,
  ripple: 36,
  cyclone: 25,
  foreshadow: 62,
  spectre: 32,
  meltdown: 25,
};

const BLOCK_FALLBACK: Record<string, string> = {
  core: "#ffd37f",
  drill: "#f59e0b",
  turret: "#38bdf8",
  wall: "#c2855a",
  conveyor: "#94a3b8",
  router: "#cbd5e1",
  power: "#fde047",
  other: "#a78bfa",
};

function classifyBlock(name: string): string {
  if (name.startsWith("core-")) return "core";
  if (name.includes("drill")) return "drill";
  if (TURRET_RANGES[name]) return "turret";
  if (name.includes("wall")) return "wall";
  if (name.includes("conveyor")) return "conveyor";
  if (name.includes("router") || name.includes("junction") || name.includes("distributor") || name.includes("bridge"))
    return "router";
  if (name.includes("power") || name.includes("generator") || name.includes("solar") || name.includes("battery"))
    return "power";
  return "other";
}

function findRegion(atlas: AtlasData, candidates: string[]): [number, number, number, number, number] | null {
  for (const name of candidates) {
    const r = atlas.regions[name];
    if (r) return r;
  }
  return null;
}

export type SnapshotOptions = {
  mode?: "base" | "whole_map" | "region" | "spawn_to_core";
  cx?: number;
  cy?: number;
  radius?: number;
  width?: number;
  grid?: boolean;
  ranges?: boolean;
  labels?: boolean;
  ores?: boolean;
  power?: boolean;
  enemies?: boolean;
};

export async function renderBattlefieldSnapshot(
  terrain: any,
  state: any,
  spritesDir: string,
  opts: SnapshotOptions = {}
): Promise<{ pngBase64: string; summary: string; width: number; height: number }> {
  const w = Number(terrain.width);
  const h = Number(terrain.height);
  const mode = opts.mode || "base";
  const showGrid = opts.grid !== false;
  const showRanges = Boolean(opts.ranges);
  const showLabels = opts.labels !== false;
  const showOres = opts.ores !== false;
  const showPower = opts.power !== false;
  const showEnemies = opts.enemies !== false;

  const core = state.core || terrain.core || { x: Math.floor(w / 2), y: Math.floor(h / 2) };
  const friendly = (state.buildings || []).filter((b: any) => b.team === "sharded");
  const spawns: Array<{ x: number; y: number }> = state.spawns || terrain.spawns || [];

  let minX = 0;
  let maxX = w - 1;
  let minY = 0;
  let maxY = h - 1;

  if (mode === "whole_map") {
    minX = 0;
    maxX = w - 1;
    minY = 0;
    maxY = h - 1;
  } else if (mode === "region") {
    const cx = Math.max(0, Math.min(w - 1, Math.round(opts.cx ?? core.x)));
    const cy = Math.max(0, Math.min(h - 1, Math.round(opts.cy ?? core.y)));
    const r = Math.max(8, Math.min(90, Math.round(opts.radius ?? 28)));
    minX = Math.max(0, cx - r);
    maxX = Math.min(w - 1, cx + r);
    minY = Math.max(0, cy - r);
    maxY = Math.min(h - 1, cy + r);
  } else if (mode === "spawn_to_core") {
    const pts = [core, ...spawns];
    minX = Math.max(0, Math.min(...pts.map((p) => p.x)) - 14);
    maxX = Math.min(w - 1, Math.max(...pts.map((p) => p.x)) + 14);
    minY = Math.max(0, Math.min(...pts.map((p) => p.y)) - 14);
    maxY = Math.min(h - 1, Math.max(...pts.map((p) => p.y)) + 14);
  } else {
    // mode === "base": auto-fit around all friendly buildings + breathing room
    const xs = friendly.length > 0 ? friendly.map((b: any) => b.x) : [core.x];
    const ys = friendly.length > 0 ? friendly.map((b: any) => b.y) : [core.y];
    const pad = 14;
    minX = Math.max(0, Math.min(...xs, core.x) - pad);
    maxX = Math.min(w - 1, Math.max(...xs, core.x) + pad);
    minY = Math.max(0, Math.min(...ys, core.y) - pad);
    maxY = Math.min(h - 1, Math.max(...ys, core.y) + pad);
    // Keep minimum window size so early 1-building bases still show nearby ores
    if (maxX - minX < 36) {
      const mid = Math.round((minX + maxX) / 2);
      minX = Math.max(0, mid - 18);
      maxX = Math.min(w - 1, mid + 18);
    }
    if (maxY - minY < 36) {
      const mid = Math.round((minY + maxY) / 2);
      minY = Math.max(0, mid - 18);
      maxY = Math.min(h - 1, mid + 18);
    }
  }

  const spanX = Math.max(1, maxX - minX + 1);
  const spanY = Math.max(1, maxY - minY + 1);
  const maxDim = Math.max(320, Math.min(1280, Math.round(opts.width ?? 768)));
  const ruler = showGrid ? 28 : 0;
  const tilePx = Math.max(2, Math.min(28, Math.floor((maxDim - ruler) / Math.max(spanX, spanY))));
  const mapW = spanX * tilePx;
  const mapH = spanY * tilePx;
  const canvasW = mapW + ruler;
  const canvasH = mapH + ruler;

  const canvas = createCanvas(canvasW, canvasH);
  const ctx = canvas.getContext("2d");
  const fontFamily = ensureFont();
  ctx.imageSmoothingEnabled = tilePx < 24;

  // Background
  ctx.fillStyle = "#0c0b09";
  ctx.fillRect(0, 0, canvasW, canvasH);

  const loaded = await getAtlas(spritesDir);
  const useTileSprites = Boolean(loaded && tilePx >= 6 && Array.isArray(terrain.tileNames) && Array.isArray(terrain.tileRle));

  // Helpers converting Mindustry tile (tx, ty) -> canvas pixel (top-left of tile, Y flipped so North is UP)
  const toPxX = (tx: number) => ruler + (tx - minX) * tilePx;
  const toPxY = (ty: number) => ruler + (maxY - ty) * tilePx;

  // 1. Decode & draw terrain
  if (useTileSprites && loaded) {
    const { atlas, images } = loaded;
    const names: string[] = terrain.tileNames;
    const tileRle: number[] = terrain.tileRle;
    const palette: string[] = terrain.palette || [];
    const colorRle: number[] = terrain.rle || [];

    // Expand color fallback only if needed
    const colorGrid = new Uint16Array(w * h);
    let ci = 0;
    for (let i = 0; i < colorRle.length; i += 2) {
      const c = colorRle[i];
      const cnt = colorRle[i + 1];
      colorGrid.fill(c, ci, ci + cnt);
      ci += cnt;
    }

    const regionCache = names.map((raw) => {
      const isWall = raw.startsWith("W:");
      const n = isWall ? raw.slice(2) : raw;
      return findRegion(atlas, isWall ? [`${n}1`, n] : [`${n}1`, n, `${n}2`]);
    });

    let idx = 0;
    for (let i = 0; i < tileRle.length; i += 2) {
      const nIdx = tileRle[i];
      const cnt = tileRle[i + 1];
      const reg = regionCache[nIdx];
      const isWall = names[nIdx]?.startsWith("W:");
      for (let k = 0; k < cnt; k++) {
        const tx = idx % w;
        const ty = Math.floor(idx / w);
        idx++;
        if (tx < minX || tx > maxX || ty < minY || ty > maxY) continue;
        const px = toPxX(tx);
        const py = toPxY(ty);
        if (reg) {
          ctx.drawImage(images[reg[0]], reg[1], reg[2], reg[3], reg[4], px, py, tilePx, tilePx);
          if (isWall) {
            ctx.fillStyle = "rgba(0,0,0,0.22)";
            ctx.fillRect(px, py, tilePx, tilePx);
          }
        } else {
          ctx.fillStyle = palette[colorGrid[ty * w + tx]] || "#1c2330";
          ctx.fillRect(px, py, tilePx, tilePx);
        }
      }
    }
  } else {
    const palette: string[] = terrain.palette || [];
    const rle: number[] = terrain.rle || [];
    let idx = 0;
    for (let i = 0; i < rle.length; i += 2) {
      const col = palette[rle[i]] || "#1c2330";
      const cnt = rle[i + 1];
      ctx.fillStyle = col;
      for (let k = 0; k < cnt; k++) {
        const tx = idx % w;
        const ty = Math.floor(idx / w);
        idx++;
        if (tx < minX || tx > maxX || ty < minY || ty > maxY) continue;
        ctx.fillRect(toPxX(tx), toPxY(ty), tilePx, tilePx);
      }
    }
  }

  // 2. Ores
  if (showOres) {
    for (const [ox, oy, oreName] of terrain.ores || []) {
      if (ox < minX || ox > maxX || oy < minY || oy > maxY) continue;
      const px = toPxX(ox);
      const py = toPxY(oy);
      const reg =
        loaded && tilePx >= 6
          ? findRegion(loaded.atlas, [`ore-${oreName}1`, `ore-${oreName}2`, `${oreName}1`])
          : null;
      if (reg && loaded) {
        ctx.drawImage(loaded.images[reg[0]], reg[1], reg[2], reg[3], reg[4], px, py, tilePx, tilePx);
      } else {
        ctx.fillStyle = ORE_COLORS[oreName] || "#e2e8f0";
        ctx.fillRect(px, py, tilePx, tilePx);
      }
    }
  }

  // 3. Optional subtle coordinate grid
  if (showGrid) {
    const step = spanX > 140 ? 25 : spanX > 65 ? 10 : 5;
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.ceil(minX / step) * step; x <= maxX; x += step) {
      const px = toPxX(x) + 0.5;
      ctx.moveTo(px, ruler);
      ctx.lineTo(px, canvasH);
    }
    for (let y = Math.ceil(minY / step) * step; y <= maxY; y += step) {
      const py = toPxY(y) + tilePx + 0.5;
      ctx.moveTo(ruler, py);
      ctx.lineTo(canvasW, py);
    }
    ctx.stroke();
  }

  // 4. Optional turret firing ranges (under buildings)
  if (showRanges) {
    for (const b of state.buildings || []) {
      const range = TURRET_RANGES[b.block];
      if (!range || b.team !== "sharded") continue;
      const cx = toPxX(b.x) + tilePx * 0.5;
      const cy = toPxY(b.y) + tilePx * 0.5;
      const rad = range * tilePx;
      ctx.fillStyle = b.ammo > 0 || b.block === "arc" || b.block === "lancer"
        ? "rgba(56, 189, 248, 0.08)"
        : "rgba(251, 113, 133, 0.06)";
      ctx.strokeStyle = b.ammo > 0 || b.block === "arc" || b.block === "lancer"
        ? "rgba(56, 189, 248, 0.45)"
        : "rgba(251, 113, 133, 0.35)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // 5. Buildings (real sprites when tilePx >= 5!)
  for (const b of state.buildings || []) {
    const offset = Math.floor((b.size - 1) / 2);
    const bxTile = b.x - offset;
    const byTileTop = b.y - offset + b.size - 1;
    if (bxTile + b.size < minX || bxTile > maxX || byTileTop - b.size > maxY || byTileTop < minY) continue;
    const px = toPxX(bxTile);
    const py = toPxY(byTileTop);
    const sz = b.size * tilePx;
    const kind = classifyBlock(b.block);

    let drew = false;
    if (loaded && tilePx >= 5) {
      const { atlas, images } = loaded;
      const cands =
        kind === "conveyor"
          ? [`${b.block}-0-0`, b.block]
          : [b.block, `${b.block}-base`, `block-${b.size}`];
      const reg = findRegion(atlas, cands);
      if (reg) {
        if (kind === "turret") {
          const baseReg = findRegion(atlas, [`block-${b.size}`, `${b.block}-base`]);
          if (baseReg) ctx.drawImage(images[baseReg[0]], baseReg[1], baseReg[2], baseReg[3], baseReg[4], px, py, sz, sz);
          ctx.save();
          ctx.translate(px + sz / 2, py + sz / 2);
          ctx.rotate((-(b.aimRot ?? b.rot * 90) + 90) * (Math.PI / 180));
          ctx.drawImage(images[reg[0]], reg[1], reg[2], reg[3], reg[4], -sz / 2, -sz / 2, sz, sz);
          ctx.restore();
        } else if (kind === "conveyor") {
          ctx.save();
          ctx.translate(px + sz / 2, py + sz / 2);
          const ang = b.rot === 0 ? 0 : b.rot === 1 ? -Math.PI / 2 : b.rot === 2 ? Math.PI : Math.PI / 2;
          ctx.rotate(ang);
          ctx.drawImage(images[reg[0]], reg[1], reg[2], reg[3], reg[4], -sz / 2, -sz / 2, sz, sz);
          ctx.restore();
        } else {
          ctx.drawImage(images[reg[0]], reg[1], reg[2], reg[3], reg[4], px, py, sz, sz);
          if (kind === "drill") {
            const rotReg = findRegion(atlas, [`${b.block}-rotator`]);
            if (rotReg) ctx.drawImage(images[rotReg[0]], rotReg[1], rotReg[2], rotReg[3], rotReg[4], px, py, sz, sz);
          }
        }
        drew = true;
      }
    }
    if (!drew) {
      ctx.fillStyle = b.team === "sharded" ? BLOCK_FALLBACK[kind] : "#ef4444";
      ctx.fillRect(px, py, Math.max(2, sz), Math.max(2, sz));
    }

    // Armed / dry dot on turrets
    if (kind === "turret" && b.team === "sharded" && tilePx >= 6) {
      const armed = b.ammo > 0 || b.block === "arc" || b.block === "lancer";
      ctx.fillStyle = armed ? "#34d399" : "#fb7185";
      ctx.beginPath();
      ctx.arc(px + sz - 2.5, py + 2.5, Math.max(2, tilePx * 0.16), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 6. Live conveyor items
  if (tilePx >= 8) {
    for (const [ix, iy, itemName] of state.conveyorItems || []) {
      if (ix < minX || ix > maxX + 1 || iy < minY || iy > maxY + 1) continue;
      const px = ruler + (ix - minX) * tilePx;
      const py = ruler + (maxY + 1 - iy) * tilePx;
      ctx.fillStyle = ORE_COLORS[itemName] || "#e2e8f0";
      ctx.beginPath();
      ctx.arc(px, py, Math.max(1.5, tilePx * 0.18), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 7. Glowing power links
  if (showPower && Array.isArray(state.powerLinks) && state.powerLinks.length > 0) {
    const live = (state.power?.produced || 0) > 0;
    ctx.lineCap = "round";
    for (const [x1, y1, x2, y2] of state.powerLinks) {
      const ax = toPxX(x1) + tilePx * 0.5;
      const ay = toPxY(y1) + tilePx * 0.5;
      const bx = toPxX(x2) + tilePx * 0.5;
      const by = toPxY(y2) + tilePx * 0.5;
      ctx.strokeStyle = live ? "rgba(251, 211, 103, 0.35)" : "rgba(251, 211, 103, 0.16)";
      ctx.lineWidth = Math.max(2, tilePx * 0.28);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.strokeStyle = live ? "#fef08a" : "#a18b4a";
      ctx.lineWidth = Math.max(1, tilePx * 0.1);
      ctx.stroke();
    }
  }

  // 8. Spawns & Enemy Units + Player Drone
  for (const sp of spawns) {
    if (sp.x < minX || sp.x > maxX || sp.y < minY || sp.y > maxY) continue;
    const sx = toPxX(sp.x) + tilePx * 0.5;
    const sy = toPxY(sp.y) + tilePx * 0.5;
    ctx.strokeStyle = "#fb7185";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(6, tilePx * 2.2), 0, Math.PI * 2);
    ctx.stroke();
    if (showLabels) {
      ctx.fillStyle = "rgba(12,11,9,0.82)";
      ctx.fillRect(sx - 24, sy - 10, 48, 14);
      ctx.fillStyle = "#fb7185";
      ctx.font = `bold 10px ${fontFamily}`;
      ctx.textAlign = "center";
      ctx.fillText("SPAWN", sx, sy);
    }
  }

  if (showEnemies) {
    for (const u of state.units || []) {
      if (u.x < minX || u.x > maxX + 1 || u.y < minY || u.y > maxY + 1) continue;
      const ux = ruler + (u.x - minX) * tilePx;
      const uy = ruler + (maxY + 1 - u.y) * tilePx;
      const isFriendly = u.team === "sharded";
      ctx.fillStyle = isFriendly ? "#ffd37f" : "#fb7185";
      ctx.strokeStyle = "#0c0b09";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(ux, uy, Math.max(3, tilePx * (isFriendly ? 0.55 : 0.45)), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // 9. Core label
  if (showLabels && core.x >= minX && core.x <= maxX && core.y >= minY && core.y <= maxY) {
    const cx = toPxX(core.x) + tilePx * 0.5;
    const cy = toPxY(core.y) - 6;
    const txt = `CORE (${core.x},${core.y})`;
    ctx.font = `bold 10px ${fontFamily}`;
    const tw = ctx.measureText(txt).width + 8;
    ctx.fillStyle = "rgba(12,11,9,0.85)";
    ctx.fillRect(cx - tw / 2, cy - 10, tw, 13);
    ctx.fillStyle = "#ffd37f";
    ctx.textAlign = "center";
    ctx.fillText(txt, cx, cy);
  }

  // 10. Crisp Coordinate Rulers along top & left
  if (showGrid) {
    const step = spanX > 140 ? 25 : spanX > 65 ? 10 : 5;
    ctx.fillStyle = "#12110e";
    ctx.fillRect(0, 0, canvasW, ruler);
    ctx.fillRect(0, 0, ruler, canvasH);
    ctx.strokeStyle = "#2d2a24";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ruler, 0);
    ctx.lineTo(ruler, canvasH);
    ctx.moveTo(0, ruler);
    ctx.lineTo(canvasW, ruler);
    ctx.stroke();

    ctx.fillStyle = "#9d9689";
    ctx.font = `10px ${fontFamily}`;
    ctx.textAlign = "center";
    for (let x = Math.ceil(minX / step) * step; x <= maxX; x += step) {
      const px = toPxX(x) + tilePx * 0.5;
      if (px > ruler + 14 && px < canvasW - 10) {
        ctx.fillText(String(x), px, 18);
      }
    }
    ctx.textAlign = "right";
    for (let y = Math.ceil(minY / step) * step; y <= maxY; y += step) {
      const py = toPxY(y) + tilePx * 0.5 + 3;
      if (py > ruler + 10 && py < canvasH - 6) {
        ctx.fillText(String(y), ruler - 4, py);
      }
    }
  }

  const buf = canvas.toBuffer("image/png");
  return {
    pngBase64: buf.toString("base64"),
    width: canvasW,
    height: canvasH,
    summary: `snapshot (${mode}) on ${state.map}: x=${minX}..${maxX}, y=${minY}..${maxY} (${canvasW}x${canvasH}px, ${tilePx}px/tile, wave ${state.wave}, ${state.enemies} enemies)`,
  };
}
