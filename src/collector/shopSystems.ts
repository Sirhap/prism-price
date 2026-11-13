/** 店铺使用的发卡系统，与采集适配器相互独立。unknown 表示没有识别依据。 */
export const SHOP_SYSTEMS = {
  ldxp: "联动小铺",
  catfk: "云猫寄售",
  "16688": "16688交易平台",
  "acg-faka": "二次元发卡",
  dujiaoka: "独角数卡",
  other: "其它",
  unknown: "第三方自建站（待确认）",
} as const;

export type ShopSystemType = keyof typeof SHOP_SYSTEMS;

/** shops 表已迁移的可选字段能力矩阵（兼容 0004/0005 分步迁移状态）。 */
export interface ShopColumnCapabilities {
  systemType: boolean;
  description: boolean;
  createdAt: boolean;
}

/** 每次按需只读检测 shops 表所有可选字段是否已迁移，不跨请求缓存数据库状态。 */
export async function getShopColumnCapabilities(db: D1Database): Promise<ShopColumnCapabilities> {
  const { results } = await db.prepare("SELECT name FROM pragma_table_info('shops')").all<{ name: string }>();
  const names = new Set((results || []).map((row) => row.name));
  return {
    systemType: names.has("system_type"),
    description: names.has("description"),
    createdAt: names.has("created_at"),
  };
}

/** 每次请求只读检测字段是否已迁移，不跨请求缓存数据库状态。 */
export async function hasShopSystemColumn(db: D1Database): Promise<boolean> {
  const column = await db.prepare("SELECT name FROM pragma_table_info('shops') WHERE name = 'system_type'")
    .first<{ name: string }>();
  return column !== null;
}

/** 只读检测 shops.description 字段是否已迁移。 */
export async function hasShopDescriptionColumn(db: D1Database): Promise<boolean> {
  const column = await db.prepare("SELECT name FROM pragma_table_info('shops') WHERE name = 'description'")
    .first<{ name: string }>();
  return column !== null;
}

/** 只读检测 shops.created_at 字段是否已迁移。 */
export async function hasShopCreatedAtColumn(db: D1Database): Promise<boolean> {
  const column = await db.prepare("SELECT name FROM pragma_table_info('shops') WHERE name = 'created_at'")
    .first<{ name: string }>();
  return column !== null;
}

/**
 * 旧库以只读派生列补齐未迁移字段，迁移后直接读取持久表。
 * 仅识别确定的共享平台域名，LIKE 中的斜杠防止近似域名被误判。
 * 注意：传入 boolean 仅用于兼容旧调用方派生 system_type；需要读取 description 或 created_at 时请传入 getShopColumnCapabilities(db) 的结果。
 */
export function shopReadSource(source: boolean | ShopColumnCapabilities): string {
  const caps: ShopColumnCapabilities =
    typeof source === "boolean"
      ? { systemType: source, description: true, createdAt: true }
      : source;

  // 保留数据库原有 CHECK 枚举；新增平台只在读取时根据精确域名派生。
  const matchesHosts = (hosts: string[]) => ["shop_url", "canonical_url"].flatMap((column) =>
    hosts.flatMap((host) => ["http", "https"].flatMap((scheme) => {
      const base = `${scheme}://${host}`;
      return ["", "/%", "?%", "#%", ":80/%", ":443/%"].map((suffix) =>
        suffix ? `lower(${column}) LIKE '${base}${suffix}'` : `lower(${column}) = '${base}'`);
    })),
  ).join(" OR ");
  const stored = caps.systemType ? "system_type" : "'unknown'";
  const effective = `CASE
    WHEN ${matchesHosts(["pay.ldxp.cn", "wzyp.cn"])} THEN 'ldxp'
    WHEN ${matchesHosts(["catfk.com", "www.catfk.com"])} THEN 'catfk'
    WHEN ${matchesHosts(["16688.com.cn", "www.16688.com.cn"])} THEN '16688'
    ELSE ${stored} END`;
  const extraColumns: string[] = [`${effective} AS effective_system_type`];
  if (!caps.systemType) extraColumns.push("'unknown' AS system_type");
  if (!caps.description) {
    extraColumns.push("'' AS description");
  }
  if (!caps.createdAt) {
    extraColumns.push("NULL AS created_at");
  }

  if (extraColumns.length === 0) {
    return "shops";
  }
  return `(SELECT shops.*, ${extraColumns.join(", ")} FROM shops) AS shops_read`;
}

/** 接受规范枚举和显示名称；未支持的输入由调用方决定拒绝或忽略。 */
export function normalizeShopSystem(value: unknown): ShopSystemType | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  for (const [key, label] of Object.entries(SHOP_SYSTEMS)) {
    if (normalized === key || normalized === label) return key as ShopSystemType;
  }
  if (normalized === "链动小铺" || normalized === "联动小铺") return "ldxp";
  if (normalized === "其他") return "other";
  if (normalized === "待识别") return "unknown";
  // 兼容外部目录使用的系统标识，不将它们当作本项目的采集适配器。
  if (normalized === "lizhi") return "acg-faka";
  if (normalized === "dujiao") return "dujiaoka";
  if (normalized === "jsonld") return "other";
  return undefined;
}

/** 只识别项目已确认的共享平台域名，不凭自定义域名或采集方式猜测系统。 */
export function inferShopSystem(...urls: string[]): ShopSystemType {
  const hosts = new Set<string>();
  for (const url of urls) {
    try { hosts.add(new URL(url).hostname.toLowerCase()); } catch { /* 无效 URL 由入站接口处理 */ }
  }
  if (["pay.ldxp.cn", "wzyp.cn"].some((host) => hosts.has(host))) return "ldxp";
  if (["catfk.com", "www.catfk.com"].some((host) => hosts.has(host))) return "catfk";
  if (["16688.com.cn", "www.16688.com.cn"].some((host) => hosts.has(host))) return "16688";
  return "unknown";
}

/** 数据库旧版 CHECK 不包含派生平台；平台身份由 URL 读取时识别。 */
export function persistedShopSystem(value: ShopSystemType): "ldxp" | "acg-faka" | "dujiaoka" | "other" | "unknown" {
  return value === "catfk" || value === "16688" ? "unknown" : value;
}
