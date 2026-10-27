import { createCanvas } from "@napi-rs/canvas";

export const SLIDE_W = 1600;
export const SLIDE_H = 900;
export const EMU_PER_PX = 7620;
export const FONT_FAMILY = "Microsoft YaHei";
const measure = createCanvas(1, 1).getContext("2d");

export function shapeRect(shape) {
  return { x: shape.x / EMU_PER_PX, y: shape.y / EMU_PER_PX, w: shape.cx / EMU_PER_PX, h: shape.cy / EMU_PER_PX };
}

function font(size, bold) { return `${bold ? "bold " : ""}${size / 0.6}px "${FONT_FAMILY}"`; }

function wrapShape(shape, size) {
  const inset = (shape.margin || 0) / EMU_PER_PX;
  const width = shape.cx / EMU_PER_PX - inset * 2 - 5;
  const runs = shape.runs?.length ? shape.runs : [{ text: shape.text || "", color: shape.color, bold: shape.bold }];
  const lines = [[]];
  let used = 0;
  const closingPunctuation = /^[，。！？；：、）》】〉”’]$/u;
  const openingPunctuation = /^[（《【〈“‘]$/u;
  const runWidth = (run) => {
    measure.font = font(size, run.bold);
    return measure.measureText(run.text).width;
  };
  const append = (line, text, color, bold) => {
    line.push({ text, color, bold, fontSize: size });
    used += runWidth(line[line.length - 1]);
  };
  for (const run of runs) {
    // Keep Latin words together; split long words only when they exceed a line.
    const tokens = String(run.text || "").match(/[A-Za-z0-9]+(?:[.'’_-][A-Za-z0-9]+)*|\n|[^\n]/gu) || [];
    for (const token of tokens) {
      if (token === "\n") { lines.push([]); used = 0; continue; }
      measure.font = font(size, run.bold ?? shape.bold);
      const pieces = measure.measureText(token).width > width ? Array.from(token) : [token];
      for (const piece of pieces) {
        const textWidth = measure.measureText(piece).width;
        const color = run.color || shape.color || "273142";
        const bold = run.bold ?? shape.bold ?? false;
        if (used && used + textWidth > width) {
          const previousLine = lines[lines.length - 1];
          const last = previousLine[previousLine.length - 1];
          // Keep Chinese closing punctuation with the preceding token and opening
          // punctuation with the following token. This avoids orphaned quotes and
          // commas at line edges without changing the authored text.
          const carry = closingPunctuation.test(piece) || openingPunctuation.test(last?.text || "")
            ? previousLine.pop()
            : null;
          lines.push([]);
          used = 0;
          if (carry) append(lines[lines.length - 1], carry.text, carry.color, carry.bold);
        }
        append(lines[lines.length - 1], piece, color, bold);
      }
    }
  }
  return lines.map((line) => line.reduce((merged, run) => {
    const previous = merged[merged.length - 1];
    if (previous && previous.color === run.color && previous.bold === run.bold && previous.fontSize === run.fontSize) previous.text += run.text;
    else merged.push({ ...run });
    return merged;
  }, []));
}

export function fitSlideText(shape) {
  const available = (shape.cy - 2 * (shape.margin || 0)) / EMU_PER_PX;
  const minSize = shape.minFontSize || 18;
  for (let size = shape.fontSize || 20; size >= minSize; size -= 1) {
    const lines = wrapShape(shape, size);
    const lineHeightPt = size * (shape.lineHeight || 1.3);
    if (lines.length * lineHeightPt / 0.6 <= available && (!shape.singleLine || lines.length === 1)) {
      return { ...shape, fontSize: size, lines, lineHeightPt, wrap: "none", anchor: "t" };
    }
  }
  throw new Error(`“${String(shape.text || shape.runs?.map(r => r.text).join("") || shape.name).slice(0, 24)}”超出版面，请减少本页内容或拆为续页`);
}

function intersects(a, b) {
  return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 &&
    Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;
}

export function validateIllustratedPlan(plan) {
  const errors = [];
  const text = plan.textShapes || [];
  const regions = plan.sceneRegions || [];
  const fixedPanels = (plan.filledShapes || []).filter((shape) => String(shape.name || "").includes("固定文字面板"));
  for (const shape of [...text, ...(plan.filledShapes || [])]) {
    const rect = shapeRect(shape);
    if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) || rect.w <= 0 || rect.h <= 0 ||
        rect.x < 0 || rect.y < 0 || rect.x + rect.w > SLIDE_W + 1 || rect.y + rect.h > SLIDE_H + 1) errors.push(`${shape.name}超出画布`);
  }
  for (const [i, shape] of text.entries()) {
    const rect = shapeRect(shape);
    for (const other of text.slice(i + 1)) if (intersects(rect, shapeRect(other))) errors.push(`${shape.name}与${other.name}文字重叠`);
    for (const region of regions) if (intersects(rect, region)) errors.push(`${shape.name}遮挡插画区域`);
    if (shape.lines && shape.lines.length * shape.lineHeightPt / 0.6 > rect.h + 1) errors.push(`${shape.name}文字溢出`);
  }
  for (const region of regions) {
    if (![region.x, region.y, region.w, region.h].every(Number.isFinite) || region.w < 1 || region.h < 1 ||
        region.x < 0 || region.y < 0 || region.x + region.w > SLIDE_W || region.y + region.h > SLIDE_H) errors.push("插画区域超出画布");
  }
  for (const panel of fixedPanels) {
    const rect = shapeRect(panel);
    for (const region of regions) if (intersects(rect, region)) errors.push(`${panel.name}与插画区域重叠`);
  }
  if (errors.length) throw new Error(`PPT 版面检查未通过：${errors.join("；")}`);
  return plan;
}
