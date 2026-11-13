export { extractIntegrationCodes, resolveIntegrationCodes, integrationCodeCandidateFilter } from "./integrationCodes.mjs";

/** 公开展示时隐藏 Telegram 链接、客户端地址及独立用户名；数据库原文留作采集依据。 */
export function hideTelegramContacts(text = ""): string {
  return text
    .replace(/(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/[^\s<>"'，。；）)]+/gi, "[联系方式已隐藏]")
    .replace(/\b(?:[A-Za-z0-9_]+)\.t\.me\b(?:\/[^\s<>]*)?/gi, "[联系方式已隐藏]")
    .replace(/tg:\/\/[^\s<>"'，。；]+/gi, "[联系方式已隐藏]")
    .replace(/(?<![\w.])@[A-Za-z0-9_]{4,32}\b/g, "[联系方式已隐藏]")
    .replace(/(?:TG|Telegram|电报|電報)\s*(?:联系|聯繫|客服|群组|群組|频道|頻道|账号|帳號|号|號)?\s*[:：]\s*[A-Za-z][A-Za-z0-9_]{3,31}/gi, "[联系方式已隐藏]");
}
