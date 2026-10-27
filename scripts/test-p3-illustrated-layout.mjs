import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import sharp from "sharp";

const output = path.resolve(".tmp-pptx-p3-illustrated");
process.env.APP_DATA_DIR = output;
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });

const { normalizeIllustratedLayout, compileIllustratedLayout, buildIllustratedBackgroundPrompt, paginateIllustratedContent, sourceUnits } = await import("../server/src/services/illustratedLayoutService.js");
const { renderSlidePreview } = await import("../server/src/services/slidePreviewService.js");
const { convertImagesToPpt } = await import("../server/src/services/convertService.js");
const { buildSlidePlans } = await import("../server/src/services/presentationService.js");

const cases = [
  { composition: "scene-left", title: "走进校园，认识新环境", body: "早晨，同学们背着书包走进校园。老师在教室门口微笑迎接大家。大家找到自己的座位，准备开始新的学习生活。" },
  { composition: "scene-right", title: "课堂上怎样认真听讲", body: "老师讲课时，我们要看着老师。遇到问题先举手，得到允许后再发言。别人回答时，认真倾听，不随意打断。" },
  { composition: "steps", title: "整理书包有三个步骤", body: "第一步，把课本按照大小整齐摆放。\n第二步，把文具装进文具袋。\n第三步，对照课程表检查第二天的用品。" },
  { composition: "comparison", title: "课间活动要安全", body: "课间可以喝水、上厕所、和同学轻声交流。\n课间不可以在楼梯追跑、趴在窗台向外看、拿扫帚打闹。" },
  { composition: "story-grid", title: "感谢身边关心我们的人", body: "爸爸妈妈每天照顾我们的生活。老师耐心教我们知识。食堂阿姨准备可口的饭菜。保安叔叔守护校园安全。" },
  { composition: "scene-top", title: "每天进步一点点", body: "今天多认识一个字，明天多读一本书。\n日积月累，我们会发现自己越来越能干。" }
];

const slidePlans = [];
const mediaMap = {};
const compact = value => String(value || "").replace(/\s/gu, "");
for (const [index, item] of cases.entries()) {
  const source = { title: item.title, body: item.body };
  const ids = sourceUnits(source).map((unit) => unit.id);
  const groupedIds = item.composition === "scene-left" || item.composition === "scene-right" || item.composition === "scene-top"
    ? [ids]
    : ids.map(id => [id]);
  const raw = {
    composition: item.composition,
    title: "模型改写标题不应覆盖原文",
    blocks: groupedIds.map((sourceIds, blockIndex) => ({
      sourceIds,
      heading: item.composition === "steps" ? `第${blockIndex + 1}步` : "",
      scene: `教学绘本场景：${item.body}`
    }))
  };
  const normalized = normalizeIllustratedLayout(raw, source, index, { previousComposition: index ? cases[index - 1].composition : "" });
  const { layout, slidePlan } = compileIllustratedLayout(normalized, { bgMediaKey: `bg-${index}`, pageNumber: index + 1 });
  assert.equal(layout.title, item.title, `slide ${index + 1}: source title is authoritative`);
  assert.equal(compact(layout.blocks.map(b => b.body).join("")), compact(item.body), `slide ${index + 1}: exact source text`);
  assert.ok(slidePlan.sceneRegions.length >= 1, `slide ${index + 1}: scene regions`);
  assert.ok(slidePlan.textShapes.every(s => Array.isArray(s.lines)), `slide ${index + 1}: measured line breaks`);
  const prompt = buildIllustratedBackgroundPrompt(layout, slidePlan);
  assert.match(prompt, /文字保留区域/);
  assert.match(prompt, /禁止任何文字/);

  const background = await sharp({ create: { width: 1600, height: 900, channels: 3, background: { r: 251, g: 248, b: 235 } } })
    .composite(slidePlan.sceneRegions.map((r, i) => ({
      input: Buffer.from(`<svg width="${Math.round(r.w)}" height="${Math.round(r.h)}"><rect width="100%" height="100%" rx="28" fill="${["#DDECCA", "#D9EAF4", "#F8DEC7"][i % 3]}"/><circle cx="50%" cy="48%" r="70" fill="#ffffff" opacity=".55"/></svg>`),
      left: Math.round(r.x), top: Math.round(r.y)
    }))).png().toBuffer();
  mediaMap[`bg-${index}`] = background;
  await fs.writeFile(path.join(output, `slide-${index + 1}-preview.png`), await renderSlidePreview(slidePlan, mediaMap));
  slidePlans.push(slidePlan);
}

const longBody = Array.from({ length: 18 }, (_, i) => `第${i + 1}条内容必须完整保留，不能因为页面需要美观就截断或省略。`).join("");
const chunks = paginateIllustratedContent({ title: "完整正文测试", body: longBody });
assert.ok(chunks.length > 1, "long text becomes continuation pages");
assert.equal(compact(chunks.map(c => c.body).join("")), compact(longBody), "continuation pages preserve every character");

const denseSentence = "进入初中后，课程数量增加，单科作业的信息量也会变多，需要学会记录、排序、分段完成并及时复盘".repeat(16);
const measuredPlans = await buildSlidePlans(`初中学习方法\n${denseSentence}`, [`初中学习方法\n${denseSentence}`], "初中学习方法", 1, { enabled: false }, "温暖教学绘本");
assert.ok(measuredPlans.length > 1, "measured layout creates continuation pages instead of throwing");
assert.equal(compact(measuredPlans.map(plan => plan.presentationContent.body).join("")), compact(denseSentence), "measured continuation pages preserve dense text");
assert.ok(measuredPlans.every(plan => plan.slidePlan.textShapes.every(shape => Array.isArray(shape.lines))), "measured continuation pages are fully fitted");

const physicalPages = [
  `第3周：开始七上预习。语文先熟悉六个单元和古诗文，数学重点预习有理数与有理数运算，英语先过Starter Units和Unit 1-3。\n二、学习习惯衔接\n${"进入初中后，课程数量增加，单科作业的信息量也会变大。每天记录任务、及时订正和复盘。".repeat(5)}\n三、综合自测清单\n${Array.from({ length: 6 }, (_, i) => `${i + 1}. 我能完成本项学习任务并说明方法。自评：____。`).join("\n")}`,
  `7. 我能按时完成模拟测试并独立订正。自评：____。\n四、教师版阶段观察要点\n教师观察学生能否先读题、圈条件、合理分配时间，并把错误原因说清楚。`
];
const physicalPlans = await buildSlidePlans(physicalPages.join("\n"), physicalPages, "六升七衔接资料", 2, { enabled: false }, "温暖教学绘本", "preserve", "preserve");
assert.equal(physicalPlans.length, 2, "physical two-page document remains two slides");
assert.deepEqual(physicalPlans.map(plan => plan.presentationContent.title), ["二、学习习惯衔接", "四、教师版阶段观察要点"]);
assert.ok(physicalPlans[0].presentationContent.body.includes("自评：____。"), "worksheet blanks are preserved");
assert.ok(physicalPlans.every(plan => !plan.presentationContent.body.includes(plan.presentationContent.title)), "page titles are not duplicated in body text");

const balancedPlans = await buildSlidePlans(physicalPages.join("\n"), physicalPages, "六升七衔接资料", 2, { enabled: false }, "温暖教学绘本", "balanced", "preserve");
assert.equal(balancedPlans.length, 3, "balanced original-text mode adds only one logical section slide");

const conciseSource = { title: "学习方法", body: "进入初中后课程增加，需要记录任务并排序。每天及时订正，当天复盘，长期坚持。" };
const conciseLayout = normalizeIllustratedLayout({ composition: "scene-right", blocks: [{ sourceIds: [1], heading: "做好三件事", displayText: "记录并排序任务\n及时订正\n当天复盘", scene: "学生整理任务清单" }] }, conciseSource, 0, { textMode: "concise" });
assert.equal(conciseLayout.blocks[0].body, "记录并排序任务\n及时订正\n当天复盘", "concise mode uses model-authored display text");
assert.equal(compact(conciseLayout.sourceBody), compact(conciseSource.body), "concise mode keeps the original source body");

const ppt = await convertImagesToPpt([], { slidePlans, mediaMap, pptName: "P3内容驱动插画版式", outputFolder: output, preserveOrder: true });
const pptPath = path.join(output, ppt.fileName);
const zip = await JSZip.loadAsync(await fs.readFile(pptPath));
assert.equal(Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, cases.length);
for (const [index, item] of cases.entries()) {
  const xml = await zip.file(`ppt/slides/slide${index + 1}.xml`).async("string");
  for (const line of item.body.split("\n")) assert.ok(xml.includes(line.slice(0, 8)), `slide ${index + 1}: PPT contains source text`);
}
console.log(`PASS: ${cases.length} content-driven compositions, exact text preservation, measured preview/export, adaptive continuation pagination`);
console.log(`PPT: ${pptPath}`);
