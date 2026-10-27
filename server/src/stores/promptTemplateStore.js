import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { dataDir } from "../paths.js";

const templatePath = path.join(dataDir, "promptTemplates.json");

const defaultTemplates = [
  {
    id: "default-xhs-redesign",
    name: "小红书教辅重设计",
    content: `请根据参考图片重新制作一张适合小红书发布的教辅图片。

核心要求：
1. 尽量保留标题、正文、栏目名、关键词、题目编号、公式和核心知识点。
2. 不要把长正文改写成要点摘要；正文需要完整保留并清晰排版。
3. 重新设计视觉样式，不要照搬原图的页眉、边框、装饰条、背景、品牌标识和整体版式。
4. 使用白色底、粉色/珊瑚色/浅橙色点缀，画面清晰柔和，适合手机端阅读。
5. 中文使用清晰印刷体、足够字号和充足行距，避免乱码、错字、糊字、伪中文和模糊小字。
6. 正文、题目、公式和表格文字必须逐字清晰，使用印刷体，禁止伪中文、乱码、错字、手写答案和艺术字正文。

背景统一要求：整页背景颜色必须一致，使用同一个主背景色或同一套浅色纸张底色；同级分区背景保持同一色系和同一明度范围，不要出现大块突兀色差、脏灰色块或每个模块换一种底色。
7. 版式要像小红书学习笔记/教辅卡片，而不是原图扫描件。

注意：AI 生成内容可能存在文字错误，生成后需要人工复核。`,
    builtin: true
  },
  {
    id: "default-clear-redraw",
    name: "教辅清晰重绘",
    content: `请按照参考图片重新绘制教辅内容。

优先保留标题、正文、栏目名、公式、表格、标注和核心知识点。
不要把长正文改写成要点摘要；正文需要完整保留并清晰排版。
保持原有知识结构，但允许优化标题区、间距、线条、底色和阅读层级。
中文必须清晰可读，使用印刷体、足够字号和充足行距，避免乱码、错字、糊字、伪中文和模糊小字。正文和题目不要使用艺术字或手写字。
整体画面干净、清晰、柔和，适合教辅知识图发布。`,
    builtin: true
  },
  {
    id: "default-pink-note",
    name: "粉色笔记风",
    content: `请把参考图片重新设计成粉色系小红书学习笔记图片。

保留原图的题目内容和知识点，但重新设计题号、提示标签、分隔线、色块和页面留白。
不要新增大标题或标题栏；只有原图本身有标题时才保留原标题。页面重点放在正文和题目内容，不要为了装饰额外添加标题。
正文、题目、公式和表格文字必须逐字清晰，使用印刷体，禁止伪中文、乱码、错字、手写答案和艺术字正文。

背景统一要求：整页背景颜色必须一致，使用同一个主背景色或同一套浅色纸张底色；同级分区背景保持同一色系和同一明度范围，不要出现大块突兀色差、脏灰色块或每个模块换一种底色。
风格温柔、清晰、现代，白底为主，搭配粉色、浅橙色和少量红色重点标记。`,
    builtin: true
  },
  {
    id: "default-handout",
    name: "高清讲义版式",
    content: `请把参考图片重制为高清讲义版式。

要求保留题目、表格、公式和主要标注，优化文字清晰度、行距、表格线和页面留白。正文、题目和表格必须使用清晰印刷体，避免伪中文、乱码、错字和模糊小字。
整体风格干净、规整、专业，适合打印或作为小红书学习资料发布。`,
    builtin: true
  },
  {
    id: "default-cute-cartoon",
    name: "可爱卡通风",
    content: `可爱卡通风，儿童教育插画风，手账笔记风，彩色课堂板报风，Q版人物，圆润中文标题字体，贴纸感边框，圆角分区卡片，整洁清晰的教学资料排版，栏目标题大而清楚，正文只使用少量短中文词组，避免密集长段落。

光线色调：
明亮柔和，暖白色背景，奶油色纸张，高饱和红橙黄绿蓝紫配色，清新活泼，温暖童趣，画面干净明快。

画质质感：
高清数字插画，干净平面设计，白色描边贴纸质感，纸张手账质感，轻微阴影，圆角卡片。标题可以可爱圆润，正文和题目必须使用清晰印刷体，逐字可读，无乱码，无伪中文，无错别字，无模糊小字，无杂乱文字。`,
    builtin: true
  },
  {
    id: "default-blackboard",
    name: "黑板报",
    content: `深绿色黑板背景，粉笔手绘风格，竖版版式，课堂黑板报设计，白色粉笔手写大标题区域，整齐的练习题排版结构，多个分区模块，横线填空、括号、虚线分隔线、波浪线装饰，粉笔颗粒质感，黑板擦痕，儿童教育风格，可爱清新。

四周有粉笔涂带装饰，包括太阳、星星、彩旗、小花、铅笔、书本、田字格、小草。标题和装饰可以有粉笔质感，正文和题目必须保持清晰印刷体，不要用粉笔手写字体重写正文；避免乱码、伪中文、错字和模糊小字。白色粉笔字为主，粉色、黄色、蓝色、绿色粉笔点缀，画面整洁、有童趣、高细节、竖版构图。`,
    builtin: true
  }
];

async function ensure() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(templatePath);
  } catch {
    await fs.writeFile(templatePath, JSON.stringify(defaultTemplates, null, 2), "utf8");
  }
}

async function readTemplates() {
  await ensure();
  return JSON.parse(await fs.readFile(templatePath, "utf8"));
}

async function writeTemplates(templates) {
  await fs.writeFile(templatePath, JSON.stringify(templates, null, 2), "utf8");
}

export const promptTemplateStore = {
  async list() {
    return readTemplates();
  },
  async save(input) {
    const templates = await readTemplates();
    const name = String(input.name || "").trim();
    const content = String(input.content || "").trim();
    if (!name || !content) throw new Error("模板名称和模板内容不能为空");

    if (input.id) {
      const next = templates.map((template) =>
        template.id === input.id
          ? { ...template, name, content, builtin: Boolean(template.builtin), updatedAt: new Date().toISOString() }
          : template
      );
      await writeTemplates(next);
      return next.find((template) => template.id === input.id);
    }

    const created = {
      id: nanoid(),
      name,
      content,
      builtin: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await writeTemplates([...templates, created]);
    return created;
  },
  async remove(ids = []) {
    const idSet = new Set(ids);
    const templates = await readTemplates();
    const next = templates.filter((template) => !idSet.has(template.id));
    await writeTemplates(next);
    return next;
  }
};
