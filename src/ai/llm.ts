/** OpenAI 兼容模型的可选配置；未配置时助手完全走规则层。 */
export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface LlmToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface LlmToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: LlmToolCall[];
  tool_call_id?: string;
}

export interface LlmToolResult {
  content: string | null;
  toolCalls: LlmToolCall[];
}

type LlmEnv = Env & {
  AI_API_BASE?: string;
  AI_API_KEY?: string;
  AI_MODEL?: string;
};

/**
 * 读取模型配置：后台 admin_settings 优先，未配置时回退环境变量。
 * 三项齐全才启用，否则返回 null 由调用方降级。
 */
export async function readLlmConfig(env: Env, db?: D1Database): Promise<LlmConfig | null> {
  let baseUrl = "";
  let apiKey = "";
  let model = "";

  if (db) {
    try {
      const row = await db.prepare(
        "SELECT ai_api_base, ai_api_key, ai_model FROM admin_settings WHERE id = 1",
      ).first<{ ai_api_base: string | null; ai_api_key: string | null; ai_model: string | null }>();
      baseUrl = (row?.ai_api_base || "").trim();
      apiKey = (row?.ai_api_key || "").trim();
      model = (row?.ai_model || "").trim();
    } catch {
      // 迁移尚未应用时忽略，继续回退环境变量
    }
  }

  if (!baseUrl && !apiKey && !model) {
    const source = env as LlmEnv;
    baseUrl = (source.AI_API_BASE || "").trim();
    apiKey = (source.AI_API_KEY || "").trim();
    model = (source.AI_MODEL || "").trim();
  }

  if (!baseUrl || !apiKey || !model) return null;
  return { baseUrl, apiKey, model };
}

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}

interface ChatRequestBody {
  model: string;
  messages: LlmMessage[];
  max_tokens: number;
  temperature: number;
  tools?: LlmToolDefinition[];
  tool_choice?: "auto";
}

interface ChatResponseBody {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: unknown };
      }>;
    };
  }>;
}

async function postChat(
  config: LlmConfig,
  body: ChatRequestBody,
  timeoutMs: number,
): Promise<ChatResponseBody | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(chatCompletionsUrl(config.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json() as ChatResponseBody;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 无工具的纯文本调用（规则分支的兜底回答）。
 */
export async function callChatModel(
  env: Env,
  messages: LlmMessage[],
  maxTokens = 600,
  timeoutMs = 20000,
): Promise<string | null> {
  const config = await readLlmConfig(env, env.DB);
  if (!config) return null;
  const payload = await postChat(config, {
    model: config.model,
    messages,
    max_tokens: maxTokens,
    temperature: 0.2,
  }, timeoutMs);
  const content = payload?.choices?.[0]?.message?.content;
  return typeof content === "string" && content.trim() ? content.trim() : null;
}

/**
 * 带工具定义的调用：模型可返回 tool_calls，由调用方执行后再回填。
 */
export async function callChatModelWithTools(
  env: Env,
  messages: LlmMessage[],
  tools: LlmToolDefinition[],
  maxTokens = 1000,
  timeoutMs = 30000,
): Promise<LlmToolResult | null> {
  const config = await readLlmConfig(env, env.DB);
  if (!config) return null;
  const payload = await postChat(config, {
    model: config.model,
    messages,
    max_tokens: maxTokens,
    temperature: 0.2,
    tools,
    tool_choice: "auto",
  }, timeoutMs);
  if (!payload) return null;
  const message = payload.choices?.[0]?.message;
  if (!message) return null;

  const toolCalls: LlmToolCall[] = Array.isArray(message.tool_calls)
    ? message.tool_calls
      .filter((call) => call?.function?.name)
      .map((call, index) => ({
        id: String(call.id || `call_${index}`),
        type: "function",
        function: {
          name: String(call.function?.name),
          arguments: typeof call.function?.arguments === "string"
            ? call.function.arguments
            : JSON.stringify(call.function?.arguments ?? {}),
        },
      }))
    : [];

  const content = typeof message.content === "string" && message.content.trim()
    ? message.content.trim()
    : null;
  return { content, toolCalls };
}
