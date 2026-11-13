import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import config from "../src/config/shop-integration-codes.json" with { type: "json" };
import { normalizeIntegrationShopUrl, resolveIntegrationCodes } from "../src/collector/integrationCodes.mjs";

// 此工具只读线上目录并生成本地核对/待导入文件，绝不提交远端变更。
const args = process.argv.slice(2);
const arg = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(arg("--output") || path.join(root, "output/releases/2026-11-12-integration-codes"));
const additions = JSON.parse(await fs.readFile(path.join(root, "data/shops.integration-additions.json"), "utf8")).shops;
let rows;
let source;
if (arg("--snapshot")) {
  source = path.resolve(arg("--snapshot"));
  const snapshot = JSON.parse(await fs.readFile(source, "utf8"));
  rows = Array.isArray(snapshot) ? snapshot : snapshot.shops;
  if (!Array.isArray(rows)) throw new Error("快照必须是数组或包含 shops 数组");
} else {
  source = arg("--api") || "https://parity.sirhao.top";
  const readPage = (page) => {
    const url = new URL("/api/shops", source);
    url.searchParams.set("page", String(page));
    url.searchParams.set("pageSize", "100");
    return JSON.parse(execFileSync("curl", ["-fsS", "--max-time", "25", url.href], { maxBuffer: 8 * 1024 * 1024, encoding: "utf8" }));
  };
  const first = readPage(1);
  rows = first.shops;
  for (let page = 2; page <= first.totalPages; page += 1) rows.push(...readPage(page).shops);
  if (rows.length !== first.total) throw new Error(`目录在读取时发生变化或不完整：${rows.length}/${first.total}；请重试`);
}
const inputFor = (row) => ({ shop_name: row.shopName, description: row.description, shop_url: row.shopUrl, canonical_url: row.canonicalUrl });
const byUrl = new Map();
for (const row of rows) {
  for (const address of [row.shopUrl, row.canonicalUrl]) {
    const key = normalizeIntegrationShopUrl(address);
    if (key) {
      if (byUrl.has(key) && byUrl.get(key).id !== row.id) throw new Error(`已收录目录出现重复地址：${key}`);
      byUrl.set(key, row);
    }
  }
}
const pending = [];
const report = config.fallbacks.map((entry) => {
  const key = normalizeIntegrationShopUrl(entry.shopUrl);
  const found = byUrl.get(key);
  const addition = !found ? additions.find((shop) => normalizeIntegrationShopUrl(shop.canonicalUrl) === key) : undefined;
  if (!found && !addition) throw new Error(`缺少店铺且没有补录准备记录：${entry.shopUrl}`);
  if (addition) {
    if (rows.some((row) => row.id === addition.id)) throw new Error(`新增店铺 ID 已被其他地址使用：${addition.id}`);
    pending.push(addition);
  }
  const input = found ? inputFor(found) : addition;
  const resolved = resolveIntegrationCodes(found ? input : {
    shop_name: addition.shopName, description: addition.description, shop_url: addition.shopUrl, canonical_url: addition.canonicalUrl,
  });
  return { shopUrl: entry.shopUrl, shopName: found?.shopName || addition.shopName,
    status: found ? "已收录" : "新增（待导入）", suppliedCode: entry.code, codes: resolved.codes, source: resolved.source,
    conflict: resolved.source === "public" && !resolved.codes.includes(entry.code),
    note: entry.shopUrl.endsWith("/ainice") ? "原店简介自述已停用、迁至 niceai；保留用户指定原地址，不自动另收录新地址" : "" };
});
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, "directory-snapshot.json"), JSON.stringify(rows, null, 2));
await fs.writeFile(path.join(output, "pending-shops.json"), JSON.stringify({ shops: pending }, null, 2));
await fs.writeFile(path.join(output, "audit.json"), JSON.stringify({ checkedAt: new Date().toISOString(), source, directoryTotal: rows.length, report }, null, 2));
const cell = (text) => String(text).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const lines = report.map((row) => `| ${cell(row.shopUrl)} | ${cell(row.shopName)} | ${row.status} | ${cell(row.codes.join(" / "))} | ${row.source === "public" ? "店铺公开标注" : "人工兜底"} | ${row.conflict ? `用户提供 ${cell(row.suppliedCode)}，采用公开码` : "无"} |`);
await fs.writeFile(path.join(output, "audit.md"), `# 36 家店铺与对接码核对\n\n目录来源：${source}；目录共 ${rows.length} 家。以下“新增”仅为本地补录准备，尚未写入生产。\n\n| 地址 | 店名 | 收录状态 | 最终采用码 | 来源 | 冲突 |\n|---|---|---|---|---|---|\n${lines.join("\n")}\n\nainice 原店简介自述已停用、迁至 niceai；保留用户给出的原地址和公告，不自动收录新地址。\n`);
console.log(JSON.stringify({ checked: report.length, existing: report.filter((row) => row.status === "已收录").length,
  pending: pending.map((shop) => shop.id), conflicts: report.filter((row) => row.conflict).map(({shopUrl, suppliedCode, codes}) => ({shopUrl, suppliedCode, codes})), output }, null, 2));
