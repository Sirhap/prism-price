import { GROUP_DISPLAY_NAMES } from "../routes/search";

export { extractIntegrationCodes, resolveIntegrationCodes, integrationCodeCandidateFilter } from "./integrationCodes.mjs";

export interface ShopMainCategory {
  group: string;
  label: string;
  count: number;
}

/** 公开展示时隐藏 Telegram 链接、客户端地址及独立用户名；数据库原文留作采集依据。 */
export function hideTelegramContacts(text = ""): string {
  return text
    .replace(/(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/[^\s<>"'，。；）)]+/gi, "[联系方式已隐藏]")
    .replace(/\b(?:[A-Za-z0-9_]+)\.t\.me\b(?:\/[^\s<>]*)?/gi, "[联系方式已隐藏]")
    .replace(/tg:\/\/[^\s<>"'，。；]+/gi, "[联系方式已隐藏]")
    .replace(/(?<![\w.])@[A-Za-z0-9_]{4,32}\b/g, "[联系方式已隐藏]")
    .replace(/(?:TG|Telegram|电报|電報)\s*(?:联系|聯繫|客服|群组|群組|频道|頻道|账号|帳號|号|號)?\s*[:：]\s*[A-Za-z][A-Za-z0-9_]{3,31}/gi, "[联系方式已隐藏]");
}

/**
 * 从 product_summary_json 提取并按数量降序排列店铺主营类别分布；
 * 对空数组、损坏 JSON 或仅含手工商品参考的扁平回退数组安全返回空数组，绝不编造分类。
 */
export function extractMainCategories(productSummaryJson: string): ShopMainCategory[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(productSummaryJson || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return [];
  }

  const counts = new Map<string, number>();
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.group !== "string") continue;
    const group = record.group.trim();
    const count = Number(record.count);
    if (!group || !Number.isFinite(count) || count <= 0) continue;
    counts.set(group, (counts.get(group) || 0) + Math.floor(count));
  }

  return [...counts.entries()]
    .map(([group, count]) => ({
      group,
      label: GROUP_DISPLAY_NAMES[group] || group,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.group.localeCompare(b.group, "zh-Hans-CN"));
}

