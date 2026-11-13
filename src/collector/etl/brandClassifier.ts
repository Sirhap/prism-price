import configuredRules from "../../config/brand-rules.json";
import { PRODUCT_GROUPS, type ProductGroup } from "../../types";

/** 配置只从随应用部署的文件读取，不接受请求提供的正则表达式。 */
export interface BrandRule {
  id: string;
  group: string;
  priority: number;
  description?: string;
  /** 至少命中一个表达式；与 includeAll 同时配置时，两组条件均需满足。 */
  includeAny?: readonly string[];
  /** 必须全部命中的表达式，可用于限定用途或商品规格。 */
  includeAll?: readonly string[];
  /** 命中任意表达式便排除当前规则，继续尝试下一条。 */
  excludeAny?: readonly string[];
}

interface CompiledBrandRule {
  group: ProductGroup;
  includeAny: RegExp[];
  includeAll: RegExp[];
  excludeAny: RegExp[];
}

/**
 * 常见零宽、双向控制符及不可见变体选择符（商家常用来防抓取或导致英文单词边界断裂）
 */
const ZERO_WIDTH_CHARS_RE = /[\u061C\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFE00-\uFE0F\uFEFF\u00AD\u034F\u180E]/g;

/**
 * 对待匹配文本执行 NFKC 归一化、零宽字符清理与小写转换
 */
export function normalizeMatchText(input: string): string {
  return String(input || "")
    .normalize("NFKC")
    .replace(ZERO_WIDTH_CHARS_RE, "")
    .toLowerCase();
}

/**
 * 编译并校验品牌规则。优先级数值越小越先匹配，同优先级沿用文件顺序。
 * 表达式只编译一次；固定使用 iu 标志，避免 g/y 导致跨请求匹配状态泄漏。
 */
export function createBrandClassifier(rules: readonly BrandRule[]): (text: string) => ProductGroup | undefined {
  const knownGroups: ReadonlySet<string> = new Set(PRODUCT_GROUPS);
  const ids = new Set<string>();
  const compiled: CompiledBrandRule[] = [...rules]
    .sort((a, b) => a.priority - b.priority)
    .map((rule) => {
      if (!rule.id.trim() || ids.has(rule.id)) throw new Error(`品牌规则 ID 为空或重复：${rule.id}`);
      ids.add(rule.id);
      if (!knownGroups.has(rule.group)) throw new Error(`品牌规则 ${rule.id} 使用未知分类：${rule.group}`);
      if (!Number.isFinite(rule.priority)) throw new Error(`品牌规则 ${rule.id} 的优先级必须为有限数字`);
      const compilePatterns = (values: readonly string[] = []): RegExp[] => values.map((pattern) => {
        if (!pattern.trim()) throw new Error(`品牌规则 ${rule.id} 包含空表达式`);
        try {
          return new RegExp(pattern, "iu");
        } catch {
          throw new Error(`品牌规则 ${rule.id} 包含无效表达式：${pattern}`);
        }
      });
      const includeAny = compilePatterns(rule.includeAny);
      const includeAll = compilePatterns(rule.includeAll);
      if (includeAny.length + includeAll.length === 0) throw new Error(`品牌规则 ${rule.id} 缺少包含条件`);
      return {
        group: rule.group as ProductGroup,
        includeAny,
        includeAll,
        excludeAny: compilePatterns(rule.excludeAny),
      };
    });

  return (input) => {
    const text = normalizeMatchText(input);
    for (const rule of compiled) {
      if (rule.excludeAny.some((pattern) => pattern.test(text))) continue;
      if (rule.includeAny.length > 0 && !rule.includeAny.some((pattern) => pattern.test(text))) continue;
      if (!rule.includeAll.every((pattern) => pattern.test(text))) continue;
      return rule.group;
    }
    return undefined;
  };
}

/** 部署时编译默认规则，所有请求复用只读匹配器。 */
export const classifyBrand = createBrandClassifier(configuredRules);
