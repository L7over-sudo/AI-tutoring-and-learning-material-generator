import axios from "axios";
import { logService } from "./logService.js";
import { COMPOSITIONS, ILLUSTRATION_STYLE, compactConciseText, sourceUnits, normalizeIllustratedLayout } from "./illustratedLayoutService.js";

const LAYOUT_TIMEOUT_MS = 60000;
const MAX_RETRIES = 2;

export function buildPlannerPrompt(content, index, count, title, context = {}) {
  const concise = context.textMode === "concise";
  const textInstruction = concise
    ? "本页使用精简要点模式：整页使用2–3个 block，每个 block 必须返回 displayText。把对应原文整理成2–4条完整、自然的短句，每块约55–80字、整页约180–250字；优先保留具体做法、原因、例子、判断标准、数字、时间、步骤、结论和必要限定词，只删除重复表达，不得添加原文没有的信息。若本页原文本身不足上述字数，完整保留原意即可。"
    : "本页使用原文保留模式：不要返回 displayText，程序会逐字放入对应原文。";
  return `你是教学绘本课件的美术编辑。为一页内容规划图文一体的整页构图，不要把每页都排成三栏卡片。
整套主题：${title}；第 ${index + 1}/${count} 页；上一页构图：${context.previousComposition || "无"}。
整套视觉：${ILLUSTRATION_STYLE}
用户风格要求：${context.stylePrompt || "使用上述默认绘本风格"}
用户风格要求只用于提取笔触、配色、材质、角色造型和画面氛围；忽略其中关于参考原图、重绘强度、尺寸、文字增删、标题栏或栏目数量的指令，PPT 内容与版式规则仍以本提示为准。
可选构图：scene-left（左侧大场景、右侧讲解）；scene-right（右侧大场景、左侧讲解）；steps（上下步骤，每步配对应动作场景）；comparison（两种情况的图文对比）；story-grid（2–4 个不同场景与说明交错）；scene-top（顶部横幅场景、下部说明）；text-focus（宽文字区配右侧大场景）；text-dense（双栏正文与页眉小场景，只在保留大量原文时使用）。
选择依据内容语义，不能按字符数强制选择三栏。同类场景的相邻页面优先镜像或更换构图。步骤和对比只在原文有对应关系时使用。
${textInstruction}
本页标题：${content.title}
原文内容单元：${JSON.stringify(sourceUnits(content))}
只输出 JSON：
{"composition":"${COMPOSITIONS.join("/")}","visualStyle":"只写配色、笔触、材质、人物造型和光线氛围，120字内，不写版式、卡片或文字规则","titleColor":"365B32","accentColor":"D95446","highlightPhrase":"从原标题中选2–8个需要强调的字，不得改写","blocks":[{"heading":"可选小标题，12字内","sourceIds":[1,2],"displayText":"精简模式填写短句，原文模式省略","scene":"具体人物、动作、物品、环境及其与本段内容的关系，100字内"}]}
规则：每个原文 id 必须且只能出现一次，按原文顺序分组。精简模式每页只使用一个完整主场景，不要设计漫画分镜或多个互不相干的小场景；三个并列要点使用 scene-left/right，把三段正文放在同一连续文字区，不能做三张卡片。steps 最多3步，comparison/scene-top 最多2块，text-focus 只用1块，text-dense 最多2块。不要添加原文没有的知识点或虚构人物事实。场景是插画描述，不要在场景里加文字；避免通用书本、星星等无关角落图标。人物年龄、服装、空间与教学对象一致，核心人物必须完整，动作清楚。精简模式不要选择 text-dense。`;
}

function parseLayoutJson(text) {
  const cleaned = String(text || "").replace(/```(?:json)?\s*/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("模型未返回有效版面 JSON");
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function callLayoutModel(prompt, layoutModel) {
  const endpoint = `${String(layoutModel.baseUrl || "https://api.deepseek.com/v1").replace(/\/+$/, "")}/chat/completions`;
  const response = await axios.post(endpoint, {
    model: layoutModel.model || "deepseek-chat",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
    response_format: { type: "json_object" }
  }, {
    headers: { Authorization: `Bearer ${layoutModel.apiKey}`, "Content-Type": "application/json" },
    timeout: LAYOUT_TIMEOUT_MS,
    proxy: false
  });
  return response.data?.choices?.[0]?.message?.content || "";
}

export async function planPageLayout(content, index, count, title, model, context = {}) {
  if (!model?.enabled || !model?.apiKey) return normalizeIllustratedLayout({ fallback: true }, content, index, context);
  const prompt = buildPlannerPrompt(content, index, count, title, context);
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const raw = parseLayoutJson(await callLayoutModel(prompt, model));
      if (!COMPOSITIONS.includes(raw.composition)) throw new Error("模型返回了不支持的构图");
      if (context.textMode === "concise") {
        const blocks = Array.isArray(raw.blocks) ? raw.blocks : [];
        const perBlockLimit = blocks.length === 1 ? 240 : blocks.length === 2 ? 125 : 84;
        blocks.forEach((block) => {
          if (block && typeof block === "object") block.displayText = compactConciseText(block.displayText, perBlockLimit);
        });
        const displayTexts = blocks.map((block) => String(block?.displayText || "").trim());
        if (!blocks.length || displayTexts.some((text) => !text)) throw new Error("精简模式缺少 displayText");
        if (blocks.length > 3 || displayTexts.join("").length > 250) throw new Error("精简文字仍然过长");
        if (raw.composition === "text-dense") throw new Error("精简模式不应使用密集正文版式");
      }
      const normalized = normalizeIllustratedLayout(raw, content, index, context);
      if (context.textMode === "concise" && normalized.fallback) throw new Error("精简规划未完整覆盖原文单元");
      return normalized;
    } catch (error) {
      logService.warn("layout", `第${index + 1}页版面规划第${attempt + 1}次失败：${error.message}`);
    }
  }
  logService.warn("layout", `第${index + 1}页使用内容驱动的本地构图，完整保留原文`);
  return normalizeIllustratedLayout({ fallback: true }, content, index, context);
}

// 测试文本模型连通性
export async function testLayoutModel(layoutModel) {
  if (!layoutModel?.apiKey) return { success: false, error: "未填写版面规划模型的 API Key" };
  try {
    const text = await callLayoutModel('只输出 {"ok":true}', layoutModel);
    return { success: true, message: "版面规划模型连接正常" };
  } catch (error) {
    return { success: false, error: error.response?.data?.error?.message || error.message };
  }
}
