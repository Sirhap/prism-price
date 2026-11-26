import { runAgent, type AgentProductPreview } from "../ai/agent";
import { classifyIntent, describeFilters, EMPTY_FILTERS, type AiIntent, type IntentFilters } from "../ai/intent";
import { matchKnowledge, QUICK_QUESTIONS, type KnowledgeSnippet } from "../ai/knowledge";
import { callChatModel, readLlmConfig, type LlmMessage } from "../ai/llm";
import { normalizeProductQuery, type AppliedProductFilters } from "./search";

/** 单 IP 每日体验次数上限 */
const DAILY_LIMIT = 30;
/** 相同问题的缓存有效期 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_QUESTION_LENGTH = 200;

export interface AiAssistantPayload {
  type: "compare" | "answer" | "mixed" | "hint";
  intent: AiIntent;
  message: string;
  filters?: AppliedProductFilters;
  apiUrl?: string;
  items?: AgentProductPreview[];
  sources?: Array<{ title: string; url: string }>;
  suggestions?: string[];
  meta: { source: "rule" | "model"; cached: boolean };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/** 优先取 Cloudflare 回源头；自托管时由 OpenResty 透传。 */
function clientIp(request: Request): string {
  const forwarded = request.headers.get("X-Forwarded-For") || "";
  return (
    request.headers.get("CF-Connecting-IP")
    || request.headers.get("X-Real-IP")
    || forwarded.split(",")[0].trim()
    || "unknown"
  );
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * 按 IP 做每日计数。表不存在或查询失败时放行，避免因迁移未应用阻断页面功能。
 */
async function checkRateLimit(env: Env, ip: string): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const expiresAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
    const bucket = `${await sha256Hex(ip)}:${day}`;
    const row = await env.DB.prepare(
      `INSERT INTO ai_rate_limit (bucket, hits, expires_at) VALUES (?, 1, ?)
       ON CONFLICT(bucket) DO UPDATE SET hits = hits + 1
       RETURNING hits`,
    ).bind(bucket, expiresAt).first<{ hits: number }>();
    const hits = Number(row?.hits ?? 1);
    return { allowed: hits <= DAILY_LIMIT, remaining: Math.max(0, DAILY_LIMIT - hits) };
  } catch {
    return { allowed: true, remaining: DAILY_LIMIT };
  }
}

async function readCache(env: Env, key: string): Promise<AiAssistantPayload | null> {
  try {
    const row = await env.DB.prepare(
      "SELECT response_json FROM ai_cache WHERE cache_key = ? AND expires_at > ?",
    ).bind(key, new Date().toISOString()).first<{ response_json: string }>();
    if (!row?.response_json) return null;
    return JSON.parse(row.response_json) as AiAssistantPayload;
  } catch {
    return null;
  }
}

async function writeCache(env: Env, key: string, payload: AiAssistantPayload): Promise<void> {
  try {
    const now = new Date();
    await env.DB.prepare(
      `INSERT INTO ai_cache (cache_key, intent, response_json, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         intent = excluded.intent,
         response_json = excluded.response_json,
         created_at = excluded.created_at,
         expires_at = excluded.expires_at`,
    ).bind(
      key,
      payload.intent,
      JSON.stringify(payload),
      now.toISOString(),
      new Date(now.getTime() + CACHE_TTL_MS).toISOString(),
    ).run();
  } catch {
    // 缓存失败不影响正常返回
  }
}

/** 用现有 normalizeProductQuery 校验规则层抽出的参数，非法值自动回退。 */
function normalizeFilters(raw: IntentFilters): AppliedProductFilters {
  const params = new URLSearchParams();
  if (raw.q) params.set("q", raw.q);
  if (raw.group && raw.group !== "all") params.set("group", raw.group);
  if (raw.type && raw.type !== "all") params.set("type", raw.type);
  if (raw.plan && raw.plan !== "all") params.set("plan", raw.plan);
  if (raw.duration && raw.duration !== "all") params.set("duration", raw.duration);
  if (raw.price && raw.price !== "all") params.set("price", raw.price);
  if (raw.sort) params.set("sort", raw.sort);
  return normalizeProductQuery(params).appliedFilters;
}

function buildProductsApiUrl(filters: AppliedProductFilters, hideOutOfStock: boolean): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.group !== "all") params.set("group", filters.group);
  if (filters.type !== "all") params.set("type", filters.type);
  if (filters.plan !== "all") params.set("plan", filters.plan);
  if (filters.duration !== "all") params.set("duration", filters.duration);
  if (filters.price !== "all") params.set("price", filters.price);
  params.set("sort", filters.sort);
  if (hideOutOfStock) params.set("hideRecentOutOfStock", "1");
  params.set("page", "1");
  params.set("pageSize", "6");
  return `/api/products?${params.toString()}`;
}

function sourcesOf(snippets: KnowledgeSnippet[]): Array<{ title: string; url: string }> {
  const seen = new Set<string>();
  return snippets
    .filter((snippet) => {
      if (seen.has(snippet.url)) return false;
      seen.add(snippet.url);
      return true;
    })
    .map((snippet) => ({ title: snippet.title, url: snippet.url }));
}

function guideMessage(snippets: KnowledgeSnippet[]): string {
  return snippets.map((snippet) => snippet.answer).join("\n\n");
}

function buildModelMessages(question: string, snippets: KnowledgeSnippet[]): LlmMessage[] {
  const context = snippets.length > 0
    ? snippets.map((snippet) => `- ${snippet.title}（${snippet.url}）：${snippet.answer}`).join("\n")
    : "- 暂无命中资料，请只回答站点使用相关问题，不编造价格、库存或店铺信息。";
  return [
    {
      role: "system",
      content: "你是棱镜比价（PRISM）的导购助手。只依据给定资料回答，不编造价格、库存、店铺名。回答用中文，简洁，150 字以内；涉及价格时提醒以店铺页面为准。",
    },
    { role: "user", content: `资料：\n${context}\n\n用户问题：${question}` },
  ];
}

async function buildPayload(env: Env, question: string, classification: ReturnType<typeof classifyIntent>): Promise<AiAssistantPayload> {
  // 已配置模型时优先交给 Agent：由模型自行决定查商品、店铺还是指南。
  const agent = await runAgent(env, question);
  if (agent) {
    const hasItems = Boolean(agent.items?.length);
    return {
      type: hasItems ? "compare" : "answer",
      intent: hasItems ? "mixed" : "guide",
      message: agent.message,
      items: agent.items,
      apiUrl: agent.apiUrl,
      sources: agent.sources,
      meta: { source: "model", cached: false },
    };
  }

  const { intent } = classification;
  const filters = normalizeFilters(classification.filters);
  const hideOutOfStock = /有货|库存|缺货/.test(question);
  const apiUrl = buildProductsApiUrl(filters, hideOutOfStock);
  const comparePayload = {
    filters,
    apiUrl,
    message: `已按「${describeFilters(filters)}」筛选，点击查看当前报价。实际价格与库存以店铺页面为准。`,
  };

  if (intent === "compare") {
    return { type: "compare", intent, ...comparePayload, meta: { source: "rule", cached: false } };
  }

  const snippets = matchKnowledge(question);

  if (intent === "mixed") {
    return {
      type: "mixed",
      intent,
      ...comparePayload,
      message: `${comparePayload.message}\n\n${snippets.length > 0 ? guideMessage(snippets) : ""}`.trim(),
      sources: sourcesOf(snippets),
      meta: { source: "rule", cached: false },
    };
  }

  if (intent === "guide") {
    if (snippets.length > 0) {
      return {
        type: "answer",
        intent,
        message: guideMessage(snippets),
        sources: sourcesOf(snippets),
        meta: { source: "rule", cached: false },
      };
    }
    if (await readLlmConfig(env, env.DB)) {
      const answer = await callChatModel(env, buildModelMessages(question, snippets));
      if (answer) {
        return { type: "answer", intent, message: answer, sources: [], meta: { source: "model", cached: false } };
      }
    }
    return {
      type: "hint",
      intent,
      message: "这个问题我暂时没有找到明确说明。可以换个说法，或直接查看使用指南。",
      suggestions: [...QUICK_QUESTIONS],
      meta: { source: "rule", cached: false },
    };
  }

  // chat：没有明确意图，给更具体的问法示例
  return {
    type: "hint",
    intent: "chat",
    message: "这个问题我暂时没有把握。你可以试试问「便宜的 Claude 月付」「哪家店有 Claude 对接码」「开店怎么对接货源」。",
    suggestions: [...QUICK_QUESTIONS],
    meta: { source: "rule", cached: false },
  };
}

/**
 * POST /api/ai：悬浮助手统一入口。
 */
export async function handleAiRequest(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }

  let body: { question?: unknown } | null = null;
  try {
    body = await request.json() as { question?: unknown };
  } catch {
    return jsonResponse({ error: "请求体必须是 JSON" }, 400);
  }

  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) return jsonResponse({ error: "请输入问题" }, 400);
  if (question.length > MAX_QUESTION_LENGTH) {
    return jsonResponse({ error: `问题请控制在 ${MAX_QUESTION_LENGTH} 个字符以内` }, 400);
  }

  const limit = await checkRateLimit(env, clientIp(request));
  if (!limit.allowed) {
    return jsonResponse({ error: "今日体验次数已用完，可稍后再试" }, 429);
  }

  const cacheKey = await sha256Hex(question.normalize("NFKC").toLowerCase().replace(/\s+/g, " "));
  const cached = await readCache(env, cacheKey);
  if (cached) {
    return jsonResponse({ ...cached, meta: { ...cached.meta, cached: true } });
  }

  const classification = classifyIntent(question);
  const payload = await buildPayload(env, question, classification);
  await writeCache(env, cacheKey, payload);
  return jsonResponse(payload);
}

export { EMPTY_FILTERS };
