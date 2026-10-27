import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { uploadsRoot, resolveUploadRelative } from "./fileService.js";
import { SLIDE_W, SLIDE_H, EMU_PER_PX, FONT_FAMILY, shapeRect, fitSlideText, validateIllustratedPlan } from "./slideTypography.js";

const PREVIEW_RENDER_VERSION = "single-hero-editorial-v12";

function planColor(plan, name, fallback) {
  const shape = (plan.textShapes || []).find(item => item.name === name);
  return /^[0-9a-f]{6}$/i.test(shape?.color || "") ? shape.color : fallback;
}

function rgba(hex, alpha) {
  const value = String(hex || "").replace("#", "");
  const safe = /^[0-9a-f]{6}$/i.test(value) ? value : "365B32";
  return `rgba(${parseInt(safe.slice(0, 2), 16)}, ${parseInt(safe.slice(2, 4), 16)}, ${parseInt(safe.slice(4, 6), 16)}, ${alpha})`;
}

function fillNeutralCanvas(ctx, plan = {}) {
  const titleColor = planColor(plan, "页面标题", "365B32");
  const accentColor = (plan.textShapes || []).find(item => /^内容\d+标题$/.test(item.name || "") && item.color !== titleColor)?.color || "D95446";
  const gradient = ctx.createLinearGradient(0, 0, SLIDE_W, SLIDE_H);
  gradient.addColorStop(0, "#fffaf0");
  gradient.addColorStop(0.52, "#fffdf8");
  gradient.addColorStop(1, "#f0f6e9");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);

  // Broad translucent sweeps give the slide a composed page rhythm without
  // introducing content that can compete with text or illustrations.
  ctx.fillStyle = rgba(titleColor, 0.08);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(980, 0);
  ctx.bezierCurveTo(850, 55, 690, 110, 430, 135);
  ctx.bezierCurveTo(235, 155, 105, 125, 0, 175);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgba(accentColor, 0.065);
  ctx.beginPath();
  ctx.moveTo(760, SLIDE_H);
  ctx.bezierCurveTo(1050, 790, 1250, 785, SLIDE_W, 690);
  ctx.lineTo(SLIDE_W, SLIDE_H);
  ctx.closePath();
  ctx.fill();

  // Restrained dot clusters and rings replace the dead white corners commonly
  // left after masking, while remaining too light to look like slide content.
  ctx.strokeStyle = rgba(accentColor, 0.2);
  ctx.lineWidth = 2;
  for (const [x, y, radius] of [[1490, 82, 19], [1530, 118, 9], [68, 780, 14]]) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = rgba(titleColor, 0.17);
  for (const [x, y, radius] of [[1460, 126, 5], [1510, 157, 7], [95, 825, 6], [128, 850, 4]]) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawAmbientArtwork(ctx, source, plan, backgroundRect) {
  // The generated artwork still supplies the palette and atmosphere across the
  // full slide, but is reduced to a tiny image before enlargement. People and
  // objects become an unrecognisable colour wash outside the scene windows.
  const wash = createCanvas(128, 72);
  const washCtx = wash.getContext("2d");
  washCtx.drawImage(source, 0, 0, wash.width, wash.height);
  ctx.save();
  ctx.globalAlpha = 0.24;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(wash, backgroundRect.x, backgroundRect.y, backgroundRect.w, backgroundRect.h);
  const veil = ctx.createLinearGradient(0, 0, SLIDE_W, SLIDE_H);
  veil.addColorStop(0, "rgba(255, 252, 244, 0.64)");
  veil.addColorStop(0.55, "rgba(255, 255, 252, 0.58)");
  veil.addColorStop(1, "rgba(244, 249, 237, 0.64)");
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);
  ctx.restore();
}

function singleSceneSourceCrop(plan, region) {
  if ((plan.sceneRegions || []).length !== 1) return null;
  // A single tall scene is commonly generated as a complete left/right strip.
  // Refit that whole strip into the window instead of chopping its top and
  // bottom at the destination coordinates.
  if (region.x >= SLIDE_W * 0.5) {
    const x = Math.max(0, region.x - 45);
    return { x, y: 0, w: SLIDE_W - x, h: SLIDE_H };
  }
  if (region.x + region.w <= SLIDE_W * 0.5) {
    const right = Math.min(SLIDE_W, region.x + region.w + 45);
    return { x: 0, y: 0, w: right, h: SLIDE_H };
  }
  if (region.w >= SLIDE_W * 0.7) {
    const bottom = Math.min(SLIDE_H, region.y + region.h + 45);
    return { x: 0, y: 0, w: SLIDE_W, h: bottom };
  }
  return null;
}

function detectBlankOuterBands(source, sx, sy, sw, sh) {
  const sampleWidth = 180;
  const sampleHeight = 112;
  const sample = createCanvas(sampleWidth, sampleHeight);
  const sampleCtx = sample.getContext("2d");
  sampleCtx.drawImage(source, sx, sy, sw, sh, 0, 0, sampleWidth, sampleHeight);
  const pixels = sampleCtx.getImageData(0, 0, sampleWidth, sampleHeight).data;
  const top = Math.floor(sampleHeight * 0.06);
  const bottom = Math.ceil(sampleHeight * 0.94);
  const columnRatios = [];
  for (let x = 0; x < sampleWidth; x += 1) {
    let content = 0;
    for (let y = top; y < bottom; y += 1) {
      const offset = (y * sampleWidth + x) * 4;
      const r = pixels[offset];
      const g = pixels[offset + 1];
      const b = pixels[offset + 2];
      const average = (r + g + b) / 3;
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      if (average < 246 || spread > 12) content += 1;
    }
    columnRatios.push(content / Math.max(1, bottom - top));
  }

  const average = values => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const findBand = side => {
    const edgeColumns = side === "left" ? columnRatios.slice(0, 3) : columnRatios.slice(-3);
    // Only repair an unmistakably empty outer edge. Pale walls and skies still
    // contain enough colour variation to stay below this false-positive gate.
    if (average(edgeColumns) > 0.1) return 0;
    const maximum = Math.floor(sampleWidth * 0.24);
    for (let distance = 3; distance < maximum; distance += 1) {
      const columns = side === "left"
        ? columnRatios.slice(distance, distance + 3)
        : columnRatios.slice(sampleWidth - distance - 3, sampleWidth - distance);
      if (columns.length === 3 && average(columns) >= 0.18) {
        return Math.max(0.015, Math.min(0.24, distance / sampleWidth));
      }
    }
    return 0;
  };

  return { left: findBand("left"), right: findBand("right") };
}

function mirroredSourcePatch(source, sx, sy, sw, sh) {
  const width = Math.max(2, Math.round(sw));
  const height = Math.max(2, Math.round(sh));
  const adjacent = createCanvas(width, height);
  adjacent.getContext("2d").drawImage(source, sx, sy, sw, sh, 0, 0, width, height);
  const patch = createCanvas(width, height);
  const patchCtx = patch.getContext("2d");
  patchCtx.translate(width, 0);
  patchCtx.scale(-1, 1);
  patchCtx.drawImage(adjacent, 0, 0, width, height);
  // Soften the reflected extension. This keeps the neighbouring palette and
  // vertical scene structure while avoiding a conspicuous duplicated face,
  // bookcase or window frame inside the repaired edge.
  const softened = createCanvas(width, height);
  const softenedCtx = softened.getContext("2d");
  const blur = Math.max(6, Math.min(18, Math.round(width * 0.12)));
  softenedCtx.filter = `blur(${blur}px)`;
  softenedCtx.drawImage(patch, -blur, -blur, width + blur * 2, height + blur * 2);
  softenedCtx.filter = "none";
  return softened;
}

function extendBlankOuterBands(ctx, source, sx, sy, sw, sh, dx, dy, dw, dh) {
  const bands = detectBlankOuterBands(source, sx, sy, sw, sh);
  for (const side of ["left", "right"]) {
    const fraction = bands[side];
    if (!fraction) continue;
    const blankSourceWidth = Math.min(sw * 0.24, Math.max(2, sw * fraction));
    const adjacentWidth = Math.min(blankSourceWidth, (sw - blankSourceWidth) / 2);
    if (adjacentWidth < 2) continue;
    const adjacentX = side === "left"
      ? sx + blankSourceWidth
      : sx + sw - blankSourceWidth - adjacentWidth;
    const patch = mirroredSourcePatch(source, adjacentX, sy, adjacentWidth, sh);
    const blankDestinationWidth = blankSourceWidth / sw * dw;
    const overlap = Math.min(24, Math.max(8, blankDestinationWidth * 0.18));
    const destinationWidth = blankDestinationWidth + overlap;
    const destinationX = side === "left" ? dx : dx + dw - destinationWidth;
    ctx.drawImage(patch, destinationX, dy, destinationWidth, dh);
  }
}

function drawSceneArtwork(ctx, source, plan, region, backgroundRect) {
  const crop = singleSceneSourceCrop(plan, region);
  if (!crop) {
    ctx.drawImage(source, backgroundRect.x, backgroundRect.y, backgroundRect.w, backgroundRect.h);
    return;
  }
  const sx = crop.x / SLIDE_W * source.width;
  const sy = crop.y / SLIDE_H * source.height;
  const sw = crop.w / SLIDE_W * source.width;
  const sh = crop.h / SLIDE_H * source.height;
  // Fill the complete scene window. `contain` left thick white bars whenever
  // the generated left/right strip was narrower than the destination frame.
  // The prompt already keeps people inside a safe area, so a small centered
  // crop is preferable to visible letterboxing in a finished slide.
  const scale = Math.max(region.w / crop.w, region.h / crop.h);
  const dw = crop.w * scale;
  const dh = crop.h * scale;
  const dx = region.x + (region.w - dw) / 2;
  const dy = region.y + (region.h - dh) / 2;
  ctx.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh);
  // Some image models still return a pure-white strip at the outer edge even
  // when the prompt explicitly forbids it. Preserve the complete composition
  // and replace only that detected strip with a mirrored continuation of the
  // neighbouring environment. Preview and PPT export both use this renderer.
  extendBlankOuterBands(ctx, source, sx, sy, sw, sh, dx, dy, dw, dh);
}

async function drawMaskedIllustration(ctx, media, plan, backgroundRect) {
  const source = await loadImage(media);
  drawAmbientArtwork(ctx, source, plan, backgroundRect);
  for (const region of plan.sceneRegions || []) {
    const radius = Math.min(24, region.w * 0.06, region.h * 0.08);
    ctx.save();
    ctx.shadowColor = "rgba(50, 62, 43, 0.2)";
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 7;
    ctx.fillStyle = "rgba(255, 255, 255, 0.98)";
    ctx.beginPath();
    ctx.roundRect(region.x, region.y, region.w, region.h, radius);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(region.x, region.y, region.w, region.h, radius);
    ctx.clip();
    drawSceneArtwork(ctx, source, plan, region, backgroundRect);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = "#ded8c7";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(region.x, region.y, region.w, region.h, radius);
    ctx.stroke();
    ctx.restore();
  }
}

export async function maskIllustratedBackground(buffer, plan) {
  if (plan?.version !== 3 || !(plan.sceneRegions || []).length) return buffer;
  validateIllustratedPlan(plan);
  const canvas = createCanvas(SLIDE_W, SLIDE_H);
  const ctx = canvas.getContext("2d");
  fillNeutralCanvas(ctx, plan);
  const backgroundRect = plan.background ? shapeRect(plan.background) : { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H };
  await drawMaskedIllustration(ctx, buffer, plan, backgroundRect);
  return canvas.encode("png");
}

export async function renderSlidePreview(plan, mediaMap) {
  if (plan.version === 3) validateIllustratedPlan(plan);
  const canvas = createCanvas(SLIDE_W, SLIDE_H);
  const ctx = canvas.getContext("2d");
  fillNeutralCanvas(ctx, plan);
  const layers = [
    ...(plan.background ? [{ ...plan.background, kind: "image", isBackground: true, zOrder: plan.background.zOrder ?? 0 }] : []),
    ...(plan.pictures || []).map(s => ({ ...s, kind: "image", zOrder: s.zOrder ?? 1 })),
    ...(plan.filledShapes || []).map(s => ({ ...s, kind: "shape", zOrder: s.zOrder ?? 2 })),
    ...(plan.textShapes || []).map(s => ({ ...s, kind: "text", zOrder: s.zOrder ?? 3 }))
  ].sort((a, b) => a.zOrder - b.zOrder);
  for (const layer of layers) {
    const r = shapeRect(layer);
    ctx.save();
    if (layer.kind === "image") {
      if (mediaMap[layer.mediaKey]) {
        if (layer.isBackground && plan.version === 3 && plan.sceneRegions?.length) {
          await drawMaskedIllustration(ctx, mediaMap[layer.mediaKey], plan, r);
        } else {
          ctx.drawImage(await loadImage(mediaMap[layer.mediaKey]), r.x, r.y, r.w, r.h);
        }
      }
    } else if (layer.kind === "shape") {
      ctx.globalAlpha = (layer.alpha ?? 100000) / 100000;
      ctx.fillStyle = `#${layer.fill || "FFFFFF"}`;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, layer.radius ? Math.min(r.w, r.h) * 0.08 : 0);
      ctx.fill();
      if (layer.line) { ctx.strokeStyle = `#${layer.line}`; ctx.stroke(); }
    } else {
      const shape = layer.lines ? layer : fitSlideText({ ...layer, minFontSize: Math.min(layer.fontSize || 18, 12) });
      const inset = (shape.margin || 0) / EMU_PER_PX;
      const lineH = shape.lineHeightPt / 0.6;
      const top = r.y + inset + (layer.anchor === "mid" ? Math.max(0, (r.h - inset * 2 - shape.lines.length * lineH) / 2) : 0);
      // Canvas text is not clipped automatically like an office text box. Clip it
      // explicitly so font-rendering differences can never paint outside its box.
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      ctx.textBaseline = "top";
      for (const [lineIndex, line] of shape.lines.entries()) {
        const width = line.reduce((sum, run) => {
          ctx.font = `${run.bold ? "bold " : ""}${run.fontSize / 0.6}px "${FONT_FAMILY}"`;
          return sum + ctx.measureText(run.text).width;
        }, 0);
        let x = r.x + inset;
        if (layer.align === "ctr") x += (r.w - inset * 2 - width) / 2;
        if (layer.align === "r") x += r.w - inset * 2 - width;
        for (const run of line) {
          ctx.font = `${run.bold ? "bold " : ""}${run.fontSize / 0.6}px "${FONT_FAMILY}"`;
          ctx.fillStyle = `#${run.color || shape.color || "273142"}`;
          ctx.fillText(run.text, x, top + lineIndex * lineH);
          x += ctx.measureText(run.text).width;
        }
      }
    }
    ctx.restore();
  }
  return canvas.encode("png");
}

const pending = new Map();
export async function getSlidePreviewFile(task) {
  const backgroundPath = task.enhancedPath || task.generatedPath;
  if (!task.slidePlan || !backgroundPath) throw new Error("页面尚未生成插画");
  const fullPath = resolveUploadRelative(backgroundPath);
  const stat = await fs.stat(fullPath);
  const hash = crypto.createHash("sha256").update(PREVIEW_RENDER_VERSION).update(JSON.stringify(task.slidePlan)).update(`${fullPath}|${stat.mtimeMs}|${stat.size}`).digest("hex").slice(0, 20);
  const dir = path.join(uploadsRoot, "presentations", task.batchId, "previews");
  const output = path.join(dir, `${task.id}-${hash}.png`);
  try { await fs.access(output); return output; } catch { /* Render once per background/layout version. */ }
  if (!pending.has(output)) {
    pending.set(output, (async () => {
      const buffer = await renderSlidePreview(task.slidePlan, { [task.slidePlan.background.mediaKey]: await fs.readFile(fullPath) });
      await fs.mkdir(dir, { recursive: true });
      const temporary = `${output}.tmp`;
      await fs.writeFile(temporary, buffer);
      await fs.rename(temporary, output);
      return output;
    })().finally(() => pending.delete(output)));
  }
  return pending.get(output);
}
