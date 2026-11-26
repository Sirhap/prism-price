import { handleGetProducts, handleGetShops } from "../routes/api";
import { matchKnowledge } from "./knowledge";
import {
  callChatModelWithTools,
  readLlmConfig,
  type LlmMessage,
  type LlmToolCall,
  type LlmToolDefinition,
} from "./llm";

export interface AgentProductPreview {
  name: string;
  group?: string;
  minPrice: number;
  shopCount: number;
  shopName?: string;
  itemUrl?: string;
  shopUrl?: string;
}

export interface AgentResult {
  message: string;
  items?: AgentProductPreview[];
  apiUrl?: string;
  sources?: Array<{ title: string; url: string }>;
}

const MAX_ROUNDS = 3;
const INTERNAL_ORIGIN = "http://internal.local";

const SYSTEM_PROMPT = [
  "你是棱镜比价（PRISM）的导购与站点助手。你可以调用工具查询真实的商品报价、收录店铺和站点指南。",
  "规则：",
  "1. 凡涉及价格、库存、店铺、对接码，必须先调用工具获取数据，禁止编造。",
  "2. 可以回答站点使用、商品选择建议、支付与售后边界等一般问题；资料不足时如实说明，不要猜测。",
  "3. 涉及价格时提醒：实际价格与库存以店铺页面为准。",
  "4. 中文回答，简洁，200 字以内；推荐商品时说明最低价和同款店铺数。",
  "5. 与站点完全无关的问题，简短回应并引导回比价或站点帮助。",
].join("\n");

const TOOL_DEFINITIONS: LlmToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_products",
      description: "按关键词、品牌、套餐、时长、价格区间搜索商品报价。返回真实最低价、同款店铺数和最低价店铺，用于比价与推荐。",
      parameters: {
        type: "object",
        properties: {
          q: { type: "string", description: "商品关键词，如 ChatGPT Plus、Claude Pro、Codex" },
          group: { type: "string", description: "品牌或分类，如 ChatGPT、Claude、Codex、Gemini、AI视频、中转" },
          plan: { type: "string", enum: ["free", "plus", "pro", "ultra", "team", "pro5", "pro20"], description: "套餐类型" },
          duration: { type: "string", enum: ["day", "week", "month", "quarter", "half-year", "year"], description: "时长" },
          price: { type: "string", enum: ["under-10", "10-50", "50-150", "150-500", "500-plus"], description: "价格区间" },
          sort: { type: "string", enum: ["relevance", "price-asc", "updated-desc"], description: "排序方式，找最便宜用 price-asc" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_shops",
      description: "搜索收录的卡网店铺。可按关键词筛选，或只看有对接码/分销码的店铺（用于找货源）。",
      parameters: {
        type: "object",
        properties: {
          q: { type: "string", description: "店铺关键词" },
          has_integration_code: { type: "boolean", description: "是否只看有对接码的店铺" },
          sort: { type: "string", enum: ["default", "products-desc", "sales-desc", "updated-desc"], description: "排序方式" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_site_guide",
      description: "查询棱镜比价站点指南：开店、对接码、提交收录、赞助投放、数据准确性、支持品牌等。",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string", description: "要查询的主题或用户原问题" },
        },
        required: ["topic"],
      },
    },
  },
];

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function stringArg(args: Record<string, unknown>, key: string, maxLength = 120): string {
  const value = args[key];
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

interface ProductSearchItem {
  name?: string;
  group?: string;
  minPrice?: number;
  shopCount?: number;
  shopName?: string;
  itemUrl?: string;
  shopUrl?: string;
}

async function runProductSearch(env: Env, args: Record<string, unknown>) {
  const params = new URLSearchParams();
  const q = stringArg(args, "q");
  if (q) params.set("q", q);
  for (const key of ["group", "plan", "duration", "price", "sort"]) {
    const value = stringArg(args, key, 40);
    if (value) params.set(key, value);
  }
  params.set("page", "1");
  params.set("pageSize", "6");

  const response = await handleGetProducts(new URL(`/api/products?${params.toString()}`, INTERNAL_ORIGIN), env, false);
  const data = await response.json() as { items?: ProductSearchItem[]; total?: number };
  const items: AgentProductPreview[] = (data.items || []).slice(0, 4).map((item) => ({
    name: String(item.name || ""),
    group: item.group ? String(item.group) : undefined,
    minPrice: Number(item.minPrice || 0),
    shopCount: Number(item.shopCount || 0),
    shopName: item.shopName ? String(item.shopName) : undefined,
    itemUrl: item.itemUrl ? String(item.itemUrl) : undefined,
    shopUrl: item.shopUrl ? String(item.shopUrl) : undefined,
  }));

  const content = JSON.stringify({
    total: Number(data.total || 0),
    items: items.map((item) => ({
      name: item.name,
      group: item.group,
      minPrice: item.minPrice,
      shopCount: item.shopCount,
      shopName: item.shopName,
    })),
  });
  return { content, items, apiUrl: `/api/products?${params.toString()}` };
}

async function runShopSearch(env: Env, args: Record<string, unknown>) {
  const params = new URLSearchParams();
  const q = stringArg(args, "q");
  if (q) params.set("q", q);
  if (args.has_integration_code === true) params.set("hasIntegrationCode", "1");
  const sort = stringArg(args, "sort", 20);
  if (sort) params.set("sort", sort);
  params.set("page", "1");
  params.set("pageSize", "6");

  const response = await handleGetShops(new URL(`/api/shops?${params.toString()}`, INTERNAL_ORIGIN), env);
  const data = await response.json() as {
    shops?: Array<{
      shopName?: string;
      shopUrl?: string;
      productCount?: number;
      integrationCodes?: string[];
      systemTypeLabel?: string;
    }>;
    total?: number;
  };
  const shops = (data.shops || []).slice(0, 5).map((shop) => ({
    name: String(shop.shopName || ""),
    url: String(shop.shopUrl || ""),
    products: Number(shop.productCount || 0),
    system: shop.systemTypeLabel ? String(shop.systemTypeLabel) : "",
    codes: Array.isArray(shop.integrationCodes) ? shop.integrationCodes.slice(0, 3) : [],
  }));
  return {
    content: JSON.stringify({ total: Number(data.total || shops.length), shops }),
    apiUrl: `/api/shops?${params.toString()}`,
  };
}

function runGuideSearch(question: string, args: Record<string, unknown>) {
  const topic = stringArg(args, "topic", 200) || question;
  const snippets = matchKnowledge(topic, 2);
  const content = snippets.length > 0
    ? snippets.map((snippet) => `${snippet.title}（${snippet.url}）：${snippet.answer}`).join("\n")
    : "没有找到对应的站点指南条目。请如实说明并建议查看使用指南。";
  return {
    content,
    sources: snippets.map((snippet) => ({ title: snippet.title, url: snippet.url })),
  };
}

interface ToolExecution {
  content: string;
  items?: AgentProductPreview[];
  apiUrl?: string;
  sources?: Array<{ title: string; url: string }>;
}

async function executeTool(env: Env, question: string, call: LlmToolCall): Promise<ToolExecution> {
  const args = parseArguments(call.function.arguments);
  try {
    if (call.function.name === "search_products") {
      return await runProductSearch(env, args);
    }
    if (call.function.name === "search_shops") {
      return await runShopSearch(env, args);
    }
    if (call.function.name === "get_site_guide") {
      return runGuideSearch(question, args);
    }
  } catch {
    return { content: "工具执行失败，请基于已有信息回答并说明暂时无法查询。" };
  }
  return { content: `未知工具：${call.function.name}` };
}

/**
 * 工具调用型 Agent：模型自行决定查商品、店铺还是指南，最多 3 轮。
 * 未配置模型或接口不支持工具时返回 null，由调用方回退规则层。
 */
export async function runAgent(env: Env, question: string): Promise<AgentResult | null> {
  if (!(await readLlmConfig(env, env.DB))) return null;

  const messages: LlmMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: question },
  ];
  let lastItems: AgentProductPreview[] | undefined;
  let lastApiUrl: string | undefined;
  const sources: Array<{ title: string; url: string }> = [];

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const response = await callChatModelWithTools(env, messages, TOOL_DEFINITIONS);
    if (!response) return null;

    if (response.toolCalls.length === 0) {
      const message = (response.content || "").trim();
      if (!message) return null;
      return { message, items: lastItems, apiUrl: lastApiUrl, sources };
    }

    messages.push({ role: "assistant", content: response.content, tool_calls: response.toolCalls });
    for (const call of response.toolCalls) {
      const execution = await executeTool(env, question, call);
      if (execution.items?.length) {
        lastItems = execution.items;
        lastApiUrl = execution.apiUrl;
      }
      if (execution.sources?.length) sources.push(...execution.sources);
      messages.push({ role: "tool", tool_call_id: call.id, content: execution.content });
    }
  }

  return {
    message: lastItems?.length
      ? "查询步骤较多，先展示目前找到的报价，细节可以继续问我。"
      : "这个问题我暂时没有查清楚，可以换个说法，或查看站点使用指南。",
    items: lastItems,
    apiUrl: lastApiUrl,
    sources,
  };
}
