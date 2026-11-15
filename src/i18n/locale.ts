import {
  extractClientIp,
  extractVisitorGeo,
  isNonPublicLookupIp,
  resolveVisitorGeo,
} from "../routes/admin";

export type Locale = "zh" | "en";
export type LocaleSource = "query" | "cookie" | "ip" | "accept-language" | "default";

export interface ResolvedLocale {
  locale: Locale;
  source: LocaleSource;
  country: string;
}

/** 默认展示简体中文的国家/地区代码（中国大陆及港澳台） */
export const CHINESE_LOCALE_COUNTRIES: ReadonlySet<string> = new Set(["CN", "HK", "MO", "TW"]);

/** 未知/匿名代理代码，不视为具体海外国家 */
const NON_COUNTRY_CODES = new Set(["", "XX", "T1", "LOCAL", "UNKNOWN"]);

const EN_PAGE_META: Record<string, { title: string; description: string }> = {
  "/": {
    title: "PRISM Parity | AI Subscriptions & Digital Store Price Comparison",
    description:
      "Compare ChatGPT, Codex, Claude, Gemini, and digital product prices across public online storefronts. Browse verified shops, integration codes, and store setup guides.",
  },
  "/about/": {
    title: "About PRISM Parity | Store Index, Integration Codes & Setup Guide",
    description:
      "Learn about PRISM Parity: browse AI subscription price directories for ChatGPT, Codex, Claude, and Gemini, search shop integration codes, and read store onboarding guides.",
  },
  "/guide/": {
    title: "AI Subscription Price Comparison Guide | PRISM Parity",
    description:
      "Learn how to compare ChatGPT, Codex, Claude, and Gemini offers across public storefronts, verify fulfillment formats, search integration codes, and submit stores.",
  },
  "/guide/ai-pricing/": {
    title: "ChatGPT, Codex, Claude & Gemini Pricing Comparison Guide | PRISM Parity",
    description:
      "Compare official pricing for ChatGPT Plus/Pro/Team, Codex, Claude Pro/Max 5x/20x, and Gemini AI Pro/Ultra with common storefront delivery formats and checklist.",
  },
  "/guide/integration-codes/": {
    title: "Store Integration Code Directory & Formatting Guide | PRISM Parity",
    description:
      "Learn how store integration and distributor codes work, how to filter and copy them one-click, and how merchants should format codes for automatic discovery.",
  },
  "/guide/open-store/": {
    title: "Store Onboarding & Indexing Guide | PRISM Parity",
    description:
      "Compare supported storefront systems, follow step-by-step store setup and product naming tips, and submit your public storefront URL to PRISM Parity.",
  },
  "/open-store-guide/": {
    title: "3-Step Store Setup & Supplier Connection Guide | PRISM Parity",
    description:
      "Visual 3-step guide: register your storefront, find and copy supplier integration codes, and connect suppliers in your merchant dashboard.",
  },
};

function normalizeLocaleValue(raw: string | null | undefined): Locale | null {
  const clean = String(raw || "").trim().toLowerCase();
  if (!clean) return null;
  if (clean === "zh" || clean.startsWith("zh-") || clean.startsWith("zh_")) return "zh";
  if (clean === "en" || clean.startsWith("en-") || clean.startsWith("en_")) return "en";
  return null;
}

function readLocaleCookie(req: Request): Locale | null {
  const cookieHeader = req.headers.get("Cookie") || "";
  const match = /(?:^|;\s*)ldxp_lang=([^;]+)/.exec(cookieHeader);
  return match ? normalizeLocaleValue(decodeURIComponent(match[1])) : null;
}

function detectAcceptLanguageLocale(header: string | null): Locale | null {
  if (!header || !header.trim()) return null;
  const entries = header
    .split(",")
    .map((part) => {
      const [langRaw, ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const q = qParam ? Number(qParam.split("=")[1]) : 1;
      return { lang: langRaw.trim().toLowerCase(), q: Number.isFinite(q) ? q : 0 };
    })
    .filter((entry) => entry.lang && entry.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const entry of entries) {
    if (entry.lang.startsWith("zh")) return "zh";
    if (entry.lang.startsWith("en")) return "en";
  }
  return null;
}

function canonicalHtmlPath(pathname: string): string | null {
  const clean = pathname.replace(/\/index\.html$/i, "/");
  if (clean === "/" || clean === "") return "/";
  const normalized = clean.endsWith("/") ? clean : `${clean}/`;
  return Object.prototype.hasOwnProperty.call(EN_PAGE_META, normalized) ? normalized : null;
}

export function isLocalizedHtmlPath(pathname: string): boolean {
  return canonicalHtmlPath(pathname) !== null;
}

/**
 * 解析当前请求的界面语言（仅支持 zh / en）：
 * 1. URL 参数 ?lang=
 * 2. Cookie ldxp_lang=
 * 3. IP 归属国家（CN/HK/MO/TW -> zh，其余已知国家 -> en）
 * 4. 浏览器 Accept-Language 兜底
 * 5. 默认简体中文
 */
export async function resolveRequestLocale(
  req: Request,
  options: { lookupPublicIp?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<ResolvedLocale> {
  const url = new URL(req.url);
  const queryLang = normalizeLocaleValue(url.searchParams.get("lang"));
  if (queryLang) {
    return { locale: queryLang, source: "query", country: "" };
  }

  const cookieLang = readLocaleCookie(req);
  if (cookieLang) {
    return { locale: cookieLang, source: "cookie", country: "" };
  }

  const ip = extractClientIp(req);
  let geo = extractVisitorGeo(req, ip);
  let code = String(geo.countryCode || "").trim().toUpperCase();

  if (NON_COUNTRY_CODES.has(code) && options.lookupPublicIp !== false && !isNonPublicLookupIp(ip)) {
    geo = await resolveVisitorGeo(req, ip, options.fetchImpl);
    code = String(geo.countryCode || "").trim().toUpperCase();
  }

  if (!NON_COUNTRY_CODES.has(code) && /^[A-Z]{2}$/.test(code)) {
    return {
      locale: CHINESE_LOCALE_COUNTRIES.has(code) ? "zh" : "en",
      source: "ip",
      country: code,
    };
  }

  // 若代理未提供两位代码但已解析出具体国家名称，同样按中文区 / 海外区分流
  const countryLabel = String(geo.country || "").trim();
  if (countryLabel && countryLabel !== "LOCAL" && countryLabel !== "未知地区") {
    const isChineseRegion = ["中国", "中国香港", "中国澳门", "中国台湾"].includes(countryLabel);
    return {
      locale: isChineseRegion ? "zh" : "en",
      source: "ip",
      country: countryLabel,
    };
  }

  const acceptLang = detectAcceptLanguageLocale(req.headers.get("Accept-Language"));
  if (acceptLang) {
    return { locale: acceptLang, source: "accept-language", country: "" };
  }

  return { locale: "zh", source: "default", country: "" };
}

function escapeAttr(val: string): string {
  return val
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function appendVary(headers: Headers, value: string): void {
  const existing = headers.get("Vary");
  const list = existing
    ? existing.split(",").map((item) => item.trim()).filter(Boolean)
    : [];
  for (const part of value.split(",")) {
    const clean = part.trim();
    if (clean && !list.some((item) => item.toLowerCase() === clean.toLowerCase())) {
      list.push(clean);
    }
  }
  if (list.length > 0) headers.set("Vary", list.join(", "));
}

/**
 * 为静态前端页面附加按 Cookie/IP 隔离的缓存头与边缘初始语言标记；
 * 当判定为英文访问时，同步改写 <html lang>、元信息并注入防闪烁守卫。
 */
export function applyHtmlLocale(response: Response, pathname: string, resolved: ResolvedLocale): Response {
  const routeKey = canonicalHtmlPath(pathname);
  if (!routeKey) return response;

  const contentType = response.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("text/html") || response.status !== 200) {
    return response;
  }

  const headers = new Headers(response.headers);
  appendVary(headers, "Cookie, CF-IPCountry, Accept-Language");
  headers.set("Cache-Control", "private, no-cache");

  const meta = EN_PAGE_META[routeKey];
  const baseResponse = new Response(response.body, { status: response.status, headers });

  if (resolved.locale === "zh") {
    return new HTMLRewriter()
      .on("head", {
        element(el) {
          el.append(
            `<meta name="prism-locale" content="zh"><meta name="prism-locale-source" content="${escapeAttr(resolved.source)}"><meta name="prism-locale-country" content="${escapeAttr(resolved.country)}">`,
            { html: true },
          );
        },
      })
      .transform(baseResponse);
  }

  return new HTMLRewriter()
    .on("html", {
      element(el) {
        el.setAttribute("lang", "en");
        el.setAttribute("data-lang", "en");
        const cls = (el.getAttribute("class") || "").trim();
        el.setAttribute("class", cls ? `${cls} i18n-pending` : "i18n-pending");
      },
    })
    .on("title", {
      element(el) {
        if (meta) el.setInnerContent(meta.title);
      },
    })
    .on('meta[name="description"]', {
      element(el) {
        if (meta) el.setAttribute("content", meta.description);
      },
    })
    .on('meta[property="og:locale"]', {
      element(el) {
        el.setAttribute("content", "en_US");
      },
    })
    .on('meta[property="og:site_name"]', {
      element(el) {
        el.setAttribute("content", "PRISM Parity");
      },
    })
    .on('meta[property="og:title"]', {
      element(el) {
        if (meta) el.setAttribute("content", meta.title);
      },
    })
    .on('meta[property="og:description"]', {
      element(el) {
        if (meta) el.setAttribute("content", meta.description);
      },
    })
    .on("head", {
      element(el) {
        el.append(
          `<meta name="prism-locale" content="en"><meta name="prism-locale-source" content="${escapeAttr(resolved.source)}"><meta name="prism-locale-country" content="${escapeAttr(resolved.country)}"><style id="prism-i18n-guard">html.i18n-pending body{opacity:0}html body{transition:opacity .12s ease}</style><script>setTimeout(function(){document.documentElement.classList.remove("i18n-pending")},450)</script>`,
          { html: true },
        );
      },
    })
    .transform(baseResponse);
}

/** 处理 /api/locale 读取与手动切换 Cookie 持久化 */
export async function handleLocaleApi(req: Request): Promise<Response> {
  if (req.method === "GET") {
    const resolved = await resolveRequestLocale(req, { lookupPublicIp: true });
    return Response.json(resolved, {
      headers: {
        "Cache-Control": "no-store",
        Vary: "Cookie, CF-IPCountry, Accept-Language",
      },
    });
  }

  if (req.method === "POST") {
    let nextLocale: Locale | null = null;
    try {
      const payload = await req.json() as { locale?: string };
      nextLocale = normalizeLocaleValue(payload?.locale);
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    if (!nextLocale) {
      return Response.json({ error: "Unsupported locale" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const isHttps = new URL(req.url).protocol === "https:";
    const cookieStr = `ldxp_lang=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax${isHttps ? "; Secure" : ""}`;
    return Response.json(
      { locale: nextLocale, source: "cookie" },
      {
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": cookieStr,
        },
      },
    );
  }

  return new Response("Method Not Allowed", { status: 405, headers: { "Cache-Control": "no-store" } });
}
