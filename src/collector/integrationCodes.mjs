import config from "../config/shop-integration-codes.json" with { type: "json" };

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const labels = [...config.labels.map(escapeRegex), ...config.colonLabels.map((label) => `${escapeRegex(label)}(?=\\s*[:：∶=])`)];
const labelPattern = new RegExp(`(?:${labels.join("|")})(?:\\s*[（(][^\\n）)]{0,20}[）)])?\\s*(?:为|是|為)?\\s*[:：∶=]?\\s*`, "gu");
const atom = "[A-Za-z0-9][A-Za-z0-9_-]*";
const validCode = new RegExp(`^${atom}(?:[ \\t]+${atom})*$`);
const standalone = new RegExp(`^(${atom}(?:[ \\t]+${atom})*)(?:[ \\t]*)$`);
const token = new RegExp(`^(${atom})(?![A-Za-z0-9_/@.:-])`);
const quotes = { '"': '"', "'": "'", "`": "`", "「": "」", "『": "』", "【": "】", "[": "]", "“": "”", "‘": "’" };
const rejected = /^(?:https?|telegram|undefined|null|sk-[A-Za-z0-9_-]+)$/i;

/** 对明确标签后的值进行识别；多词码要求完整独立行或引号，不吞入后续说明。 */
export function extractIntegrationCodes(...texts) {
  const codes = new Set();
  for (const text of texts) {
    if (typeof text !== "string") continue;
    // 每段原文独立扫描，禁止前一字段的标签吸收下一字段的内容。
    for (const match of text.matchAll(labelPattern)) {
      const rest = text.slice(match.index + match[0].length);
      const line = rest.split(/\r?\n/, 1)[0];
      let code = "";
      const close = quotes[line[0]];
      if (close) {
        const end = line.indexOf(close, 1);
        if (end > 1) code = line.slice(1, end).trim();
      } else {
        const lineStart = text.lastIndexOf("\n", match.index - 1) + 1;
        const prefix = text.slice(lineStart, match.index).trim();
        // 仅“标签：完整值”行允许未加引号的空格；店名内联标签采用单 token。
        code = (!prefix ? standalone.exec(line)?.[1] : "") || token.exec(line)?.[1] || "";
      }
      if (code.length <= 128 && validCode.test(code) && !rejected.test(code)) codes.add(code);
    }
  }
  return [...codes];
}

/** 仅规范化已知平台地址用于匹配；对接码本身绝不转数字或改写大小写。 */
export function normalizeIntegrationShopUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!["http:", "https:"].includes(url.protocol) || url.port || url.username || url.password) return "";
    if (!["wzyp.cn", "pay.ldxp.cn"].includes(url.hostname.toLowerCase())) return "";
    const match = url.pathname.match(/^\/shop\/([A-Za-z0-9_-]+)\/?$/i);
    return match ? `https://wzyp.cn/shop/${match[1].toLowerCase()}` : "";
  } catch {
    return "";
  }
}

const fallbackByUrl = new Map(config.fallbacks.map(({ shopUrl, code }) => [normalizeIntegrationShopUrl(shopUrl), code]));

/** 店名、简介公开标注优先；只有完全没有公开码时才采用用户维护的配置。 */
export function resolveIntegrationCodes(shop) {
  const publicCodes = extractIntegrationCodes(shop.shop_name, shop.description);
  if (publicCodes.length) return { codes: publicCodes, source: "public" };
  for (const address of [shop.canonical_url, shop.shop_url]) {
    const fallback = fallbackByUrl.get(normalizeIntegrationShopUrl(address));
    if (fallback) return { codes: [fallback], source: "manual" };
  }
  return { codes: [], source: "none" };
}

/** 与解析器共用标签来源的候选过滤；平台地址候选由同一个解析入口最终验证，兼容查询串、旧域名和大小写。 */
export function integrationCodeCandidateFilter() {
  const needles = [...new Set([...config.labels, ...config.colonLabels])];
  const clauses = needles.flatMap(() => ["INSTR(shop_name, ?) > 0", "INSTR(description, ?) > 0"]);
  // 此处只传输 id/名称/简介/地址小字段；宽松平台候选避免 SQL 与 URL 规范化行为不一致。
  for (const column of ["shop_url", "canonical_url"]) {
    clauses.push(`LOWER(${column}) LIKE '%wzyp.cn/shop/%'`, `LOWER(${column}) LIKE '%pay.ldxp.cn/shop/%'`);
  }
  return { sql: `(${clauses.join(" OR ")})`, params: needles.flatMap((label) => [label, label]) };
}
