import type { AdapterType, RawShopSnapshot, ShopRecord } from "../../types";

export interface ShopAdapter {
  readonly type: Exclude<AdapterType, "manual" | "push_ingest">;
  fetchSnapshot(shop: ShopRecord, env: Env): Promise<RawShopSnapshot>;
}

/**
 * 校验目标 URL 是否为安全的公网 HTTP(S) 地址，防止 SSRF 访问内网或元数据 IP
 */
export function assertSafePublicUrl(rawUrl: string): URL {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`不支持的协议类型: ${parsed.protocol}`);
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    throw new Error(`禁止请求内网或保留地址: ${host}`);
  }
  return parsed;
}

/**
 * 统一获取源站 HTTP Response（带公网地址校验与超时控制）
 */
export async function fetchUpstreamResponse(
  shop: ShopRecord,
  _env: Env,
): Promise<{ response: Response; finalUrl: string }> {
  assertSafePublicUrl(shop.shop_url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("Upstream fetch timeout"), 8000);
  try {
    const response = await fetch(shop.shop_url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LdxpDirectoryBot/1.0)",
        Accept: "application/json, text/html;q=0.9",
      },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status} from ${shop.shop_url}`);
    }
    return {
      response,
      finalUrl: response.url || shop.canonical_url || shop.shop_url,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 流式读取有界响应文本（最多 maxBytes 字节），避免对异常大包体使用 response.text() 触发内存限制
 */
export async function readBoundedSnippet(response: Response, maxBytes = 4096): Promise<string> {
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const merged = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.byteLength, merged.byteLength - offset);
    if (take <= 0) break;
    merged.set(chunk.subarray(0, take), offset);
    offset += take;
  }
  return new TextDecoder().decode(merged);
}

const RESERVED_TG_PATH_SEGMENTS = new Set([
  "share",
  "proxy",
  "socks",
  "addstickers",
  "addtheme",
  "addlist",
  "setlanguage",
  "joinchat",
  "contact",
  "confirm",
  "boost",
  "giftcode",
  "login",
  "iv",
  "blog",
  "faq",
  "tos",
  "privacy",
]);

const RESERVED_TG_SUBDOMAINS = new Set([
  "www",
  "telegram",
  "static",
  "core",
  "api",
  "web",
  "desktop",
  "macos",
]);

const URL_PATH_PREFIX_RE = /(?:https?:\/\/[^\s/]+(?:\/[^\s]*)?|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?::\d+)?(?:\/[^\s]*)?)\/$/;

/**
 * 规范化源站店铺简介：统一换行符并裁剪首尾空白，保留安全纯文本多行格式
 */
export function normalizeDescription(raw: unknown): string {
  if (typeof raw !== "string") {
    return "";
  }
  return raw.replace(/\r\n?/g, "\n").trim();
}

/**
 * 从公告、联系字段或外链文案中提取商家 Telegram 用户名或邀请链接
 */
export function extractTelegramHandle(text: string): string {
  const input = String(text || "");
  if (!input) {
    return "";
  }

  // 提取显式 @handle：排除邮箱（如 support@gmail.com）、非 TG URL 路径（如 youtube.com/@user）、纯数字和超长截断
  for (const match of input.matchAll(
    /(?<![a-zA-Z0-9._%+-])@(?=[0-9_]*[a-zA-Z])([a-zA-Z0-9_]{4,32})(?![a-zA-Z0-9_])(?![a-zA-Z0-9_.-]*\.[a-zA-Z]{2,})/g,
  )) {
    const before = input.slice(0, match.index ?? 0);
    if (URL_PATH_PREFIX_RE.test(before)) {
      continue;
    }
    return `@${match[1]}`;
  }

  // 支持 tg://resolve?domain=... 与 tg://join?invite=... 客户端协议链接
  for (const tgUriMatch of input.matchAll(
    /tg:\/\/(?:resolve\?(?:[^#\s]*&)?domain=(?=[0-9_]*[a-zA-Z])([a-zA-Z0-9_]{4,32})(?![a-zA-Z0-9_])|join\?(?:[^#\s]*&)?invite=([a-zA-Z0-9_-]{4,40})(?![a-zA-Z0-9_-]))/gi,
  )) {
    if (tgUriMatch[1] && !RESERVED_TG_PATH_SEGMENTS.has(tgUriMatch[1].toLowerCase())) {
      return `@${tgUriMatch[1]}`;
    }
    if (tgUriMatch[2]) {
      return `https://t.me/+${tgUriMatch[2]}`;
    }
  }

  for (const pathMatch of input.matchAll(
    /(?<![a-zA-Z0-9_.-])(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/(?:s\/(?=[0-9_]*[a-zA-Z])([a-zA-Z0-9_]{4,32})(?![a-zA-Z0-9_])(?!\.[a-zA-Z]{2,})|(\+[a-zA-Z0-9_-]{4,40})(?![a-zA-Z0-9_-])|(joinchat\/[a-zA-Z0-9_-]{4,40})(?![a-zA-Z0-9_-])|(?=[0-9_]*[a-zA-Z])([a-zA-Z0-9_]{4,32})(?![a-zA-Z0-9_])(?!\.[a-zA-Z]{2,}))/gi,
  )) {
    if (pathMatch[1] && !RESERVED_TG_PATH_SEGMENTS.has(pathMatch[1].toLowerCase())) {
      return `@${pathMatch[1]}`;
    }
    if (pathMatch[2]) {
      return `https://t.me/${pathMatch[2]}`;
    }
    if (pathMatch[3]) {
      return `https://t.me/${pathMatch[3]}`;
    }
    if (pathMatch[4] && !RESERVED_TG_PATH_SEGMENTS.has(pathMatch[4].toLowerCase())) {
      return `@${pathMatch[4]}`;
    }
  }

  // 支持 https://<user>.t.me 子域名格式
  for (const subMatch of input.matchAll(
    /(?<![a-zA-Z0-9_.@-])(?=[0-9_]*[a-zA-Z])([a-zA-Z0-9_]{4,32})\.(?:t\.me|telegram\.me|telegram\.dog)(?=[:/?#\s,，;；)）\]】"'<>!！?？。]|$)/gi,
  )) {
    const user = subMatch[1];
    if (!RESERVED_TG_SUBDOMAINS.has(user.toLowerCase())) {
      return `@${user}`;
    }
  }

  return "";
}

/**
 * 按候选字段顺序提取 Telegram 联系方式，避免跨字段拼接造成文本粘连误判
 */
export function extractTelegramFromSources(...sources: Array<string | null | undefined>): string {
  for (const source of sources) {
    if (!source) continue;
    const handle = extractTelegramHandle(source);
    if (handle) {
      return handle;
    }
  }
  return "";
}
