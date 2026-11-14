import { PRODUCT_GROUPS } from "../types";

export const SITE_ORIGIN = "https://parity.sirhao.top";
export const SITE_NAME = "棱镜比价";
export const SITE_ALT_NAME = "PRISM";
export const OPEN_STORE_URL = "https://parity.sirhao.top/go/open-store";

export interface BrandSeoProfile {
  group: string;
  slug: string;
  title: string;
  summary: string;
  officialPriceNote: string;
  compareTips: string;
  keywords: string[];
  faqs: Array<{ q: string; a: string }>;
}

export const BRAND_SEO_PROFILES: Readonly<Record<string, BrandSeoProfile>> = {
  ChatGPT: {
    group: "ChatGPT",
    slug: "ChatGPT",
    title: "ChatGPT 订阅与成品号卡网比价（Plus / Pro / Team / Go）",
    summary: "聚合多店公开报价，对比 ChatGPT Plus、ChatGPT Pro、ChatGPT Team / Business、Go 月卡及独享成品账号、代充与兑换码的参考价格。",
    officialPriceNote: "官网参考价：Plus \$20/月（约 ¥143）、Team \$25–30/座/月、Pro \$200/月（约 ¥1,430）。",
    compareTips: "比价时请区分独享成品号、拼车席位、官方代充、CDK 兑换码与接码普号，确认质保时长与是否支持改密。",
    keywords: ["ChatGPT", "ChatGPT Plus", "ChatGPT Pro", "ChatGPT Team", "OpenAI", "GPT 成品号", "GPT 代充"],
    faqs: [
      {
        q: "卡网上购买 ChatGPT Plus 和官方订阅有什么区别？",
        a: "卡网常见形态包括成品独享账号、官方代充、兑换码与多人拼车席位。成品号和拼车通常单价更低但需核实独享性与质保条款，官方代充可直充自有账号但价格更接近汇率成本。",
      },
      {
        q: "对比 ChatGPT 报价时重点看哪些规格？",
        a: "建议核对套餐（Free / Plus / Pro / Team）、有效期（日/周/月/年）、交付形式（成品账号/代充/兑换码）、是否已接码以及商家售后质保说明。",
      },
    ],
  },
  Codex: {
    group: "Codex",
    slug: "Codex",
    title: "Codex 账号、套餐额度与 API 中转卡网比价",
    summary: "汇聚各大公开卡网店铺的 Codex 相关成品账号、Plus/Pro 附带 Codex 额度、独立 Codex 代理/中转与 CLI 使用套餐报价。",
    officialPriceNote: "官网参考价：Codex 通常随 ChatGPT Plus（\$20/月）或 ChatGPT Pro（\$200/月）附带使用额度，或按 OpenAI API 用量计费。",
    compareTips: "请注意区分「ChatGPT 订阅附带 Codex 权限的账号」与「按量计费 API 中转 Key」，核实并发限额与封号质保。",
    keywords: ["Codex", "OpenAI Codex", "Codex CLI", "Codex 额度", "Codex 卡网比价"],
    faqs: [
      {
        q: "卡网中的 Codex 商品一般包含哪些类型？",
        a: "主要分为三类：带有 Codex CLI / Cloud 额度的 ChatGPT Plus/Pro 成品或代充账号、高倍率团队席位、以及兼容 Codex 工具链的 API 中转兑换额度。",
      },
      {
        q: "如何在棱镜比价快速筛选低价 Codex 店铺？",
        a: "可在本页按品牌「Codex」浏览，或返回首页选择 Codex 分类并按「最低价从低到高」排序，展开同款商品即可查看多家店铺报价并核实源站库存。",
      },
    ],
  },
  Claude: {
    group: "Claude",
    slug: "Claude",
    title: "Claude 订阅与 API 卡网比价（Pro / Max 5x / Max 20x / Team）",
    summary: "对比公开卡网店铺的 Claude Pro、Claude Max 5x、Claude Max 20x、Claude Code 相关额度、成品账号与代充报价。",
    officialPriceNote: "官网参考价：Pro \$20/月（约 ¥143）、Max 5x \$100/月（约 ¥715）、Max 20x \$200/月（约 ¥1,430）、Team \$25–30/座/月。",
    compareTips: "Claude 对登录环境与风控较敏感，购买前务必核实是否支持稳定原生 IP、是否包封号换新或按天折算质保。",
    keywords: ["Claude", "Claude Pro", "Claude Max", "Claude Code", "Anthropic", "Claude 卡网"],
    faqs: [
      {
        q: "Claude Pro 与 Max 5x / 20x 在比价时如何区分？",
        a: "官网 Pro 为 \$20/月基础额度，Max 5x（\$100/月）和 Max 20x（\$200/月）主要面向 Claude Code 与重度编码用户。棱镜比价已拆分 pro、pro5、pro20 规格标签方便横向对比。",
      },
    ],
  },
  Gemini: {
    group: "Gemini",
    slug: "Gemini",
    title: "Gemini / Google AI 订阅卡网比价（AI Pro / Ultra）",
    summary: "汇总各大公开卡网的 Gemini 成品号、Google AI Pro（2TB 存储与高级模型）、Google AI Ultra 及家庭组/学生认证代充报价。",
    officialPriceNote: "官网参考价：Google AI Pro \$19.99/月（约 ¥143）、Google AI Ultra \$249.99/月（约 ¥1,787）。",
    compareTips: "核实账号地区（如美区/日区/土耳其等）、是否含谷歌网盘空间、是否绑辅助邮箱以及质保周期。",
    keywords: ["Gemini", "Google AI Pro", "Google AI Ultra", "Gemini 成品号", "Gemini 代充"],
    faqs: [
      {
        q: "购买 Gemini 相关卡网商品需要注意什么？",
        a: "除价格外，需关注是个人独立会员、Google One 家庭组拼车还是限时活动认证号，并确认账号归属地区与售后政策。",
      },
    ],
  },
  Cursor: {
    group: "Cursor",
    slug: "Cursor",
    title: "Cursor Pro / Ultra / 额度卡网比价",
    summary: "汇总 Cursor Pro、Cursor Ultra、Teams 及高速额度账号的公开店铺参考报价。",
    officialPriceNote: "官网参考价：Pro \$20/月（约 ¥143）、Pro+ \$60/月、Ultra \$200/月（约 ¥1,430）。",
    compareTips: "核实快请求额度是否满额、是否为独享账号或无限续杯/单月质保版本。",
    keywords: ["Cursor", "Cursor Pro", "Cursor Ultra", "AI 编程比价"],
    faqs: [],
  },
  Grok: {
    group: "Grok",
    slug: "Grok",
    title: "Grok / SuperGrok 订阅与账号卡网比价",
    summary: "整理 xAI Grok、SuperGrok 月卡/年卡、成品账号与直充服务的公开店铺报价对比。",
    officialPriceNote: "官网参考价：SuperGrok 订阅约 \$30/月起（以 xAI/X 官网各地区实时定价为准）。",
    compareTips: "注意区分 X Premium+ 附带权限与独立 SuperGrok 订阅。",
    keywords: ["Grok", "SuperGrok", "xAI", "Grok 比价"],
    faqs: [],
  },
  DeepSeek: {
    group: "DeepSeek",
    slug: "DeepSeek",
    title: "DeepSeek API 额度与相关工具卡网比价",
    summary: "对比公开店铺收录的 DeepSeek API 余额兑换、镜像中转及周边开发服务报价。",
    officialPriceNote: "按官方开放平台 Token 用量计费，不同中转与镜像套餐计费倍率各异。",
    compareTips: "购买 API 兑换码前请先核实模型版本、并发限制和额度有效期。",
    keywords: ["DeepSeek", "DeepSeek API", "DeepSeek 中转"],
    faqs: [],
  },
  Antigravity: {
    group: "Antigravity",
    slug: "Antigravity",
    title: "Antigravity 相关账号与服务卡网比价",
    summary: "聚合收录公开店铺中的 Antigravity 相关账号、额度与配套数字商品参考价格。",
    officialPriceNote: "具体权益及额度规则以官方说明和源站店铺商品描述为准。",
    compareTips: "下单前核实所属地区、授权有效期和账号交付形式。",
    keywords: ["Antigravity", "Antigravity 账号"],
    faqs: [],
  },
  中转: {
    group: "中转",
    slug: "中转",
    title: "AI API 中转额度与兑换卡多店比价",
    summary: "汇总支持 OpenAI、ChatGPT、Codex、Claude、Gemini 等模型的按量计费 API 中转兑换码与充值卡报价。",
    officialPriceNote: "不同中转站按 USD 额度面值或人民币汇率折算（如 1 刀额度 / 10 元充值卡），费率与稳定性存在差异。",
    compareTips: "除面值单价外，请重点核实倍率（1:1 或分组倍率）、支持的模型清单、并发速率与店铺存活周期。",
    keywords: ["API中转", "中转额度", "One API", "New API", "AI 接口兑换码"],
    faqs: [],
  },
};

export interface ShopSystemGuideItem {
  key: string;
  label: string;
  summary: string;
}

export const SHOP_SYSTEM_GUIDES: readonly ShopSystemGuideItem[] = [
  {
    key: "ldxp",
    label: "联动小铺",
    summary: "支持公开店铺页面与标准商品接口（wzyp.cn / pay.ldxp.cn），支持设置店铺对接码（分销码）与自动分类聚合收录，适合快速开店与分销对接。",
  },
  {
    key: "catfk",
    label: "云猫寄售",
    summary: "常见数字商品自动发卡寄售平台（catfk.com），支持标准化店铺快照采集与商品入库比价。",
  },
  {
    key: "16688",
    label: "16688交易平台",
    summary: "支持通过平台店铺页抓取商品与价格，适合源头货源及多品类数字商品商家收录。",
  },
  {
    key: "dujiaoka",
    label: "独角数卡",
    summary: "开源自建数字商品发卡系统，商家通常绑定独立域名运营，可通过结构化数据或人工提交方式接入收录。",
  },
  {
    key: "acg-faka",
    label: "二次元发卡",
    summary: "自建发卡系统之一，支持自定义模板与分销体系，提交公网地址后可纳入店铺索引。",
  },
];

export const CORE_SEO_FAQS: ReadonlyArray<{ q: string; a: string }> = [
  {
    q: "棱镜比价收录哪些卡网系统和店铺？",
    a: "棱镜比价已收录联动小铺（wzyp.cn / pay.ldxp.cn）、云猫寄售（catfk.com）、16688交易平台、独角数卡、二次元发卡及各类第三方自建站。用户可以在「看收录店铺」模式下按卡网系统类型、在售状态与对接码进行筛选。",
  },
  {
    q: "如何在棱镜比价比较 ChatGPT、Codex、Claude、Gemini 等商品价格？",
    a: "在首页「找商品比价」模式输入关键词（如 Codex、ChatGPT Plus、Claude Pro、Gemini）或点击左侧品牌导航，即可按商品类型（成品账号、代充/兑换码、API 中转、接码服务）、套餐、时长和价格区间筛选，展开同款商品即可横向比较多家卡网店铺报价。",
  },
  {
    q: "什么是店铺对接码（分销码），怎么查找？",
    a: "店铺对接码（也称分销码、对接代码）是联动小铺等卡网平台用于分销货源绑定与代理对接的标识代码。在本站切换至「看收录店铺」并勾选「仅看有对接码」，或直接访问「店铺对接码目录」(/catalog/integration-codes/)，即可浏览并一键复制公开对接码。",
  },
  {
    q: "我想在联动小铺开店，开店后如何被棱镜比价收录？",
    a: "可通过页面顶部或底部的「我想开店 / 店铺开店入驻」入口注册联动小铺商家账号；上架商品时建议在标题写明品牌与规格（如 ChatGPT Plus 月卡、Codex、Claude Max 等），并在店名或简介中规范标注「对接码：您的代码」。开店后在首页点击「提交店铺」填入公网店铺链接即可加入收录列表。",
  },
  {
    q: "展示的价格和库存是实时的吗？交易安全由谁负责？",
    a: "本站仅做公开店铺信息聚合与参考价格对比，展示结果可能存在同步时间差，不参与任何交易或资金流转。下单前请务必点击前往源站店铺核实实时价格、剩余库存、交付方式与售后条款。",
  },
];

export function getBrandProfile(group: string): BrandSeoProfile {
  if (BRAND_SEO_PROFILES[group]) {
    return BRAND_SEO_PROFILES[group];
  }
  const exists = PRODUCT_GROUPS.includes(group as (typeof PRODUCT_GROUPS)[number]);
  const safeName = exists ? group : "数字商品";
  return {
    group: safeName,
    slug: safeName,
    title: `${safeName} 卡网商品收录与多店比价`,
    summary: `浏览棱镜比价收录的公开卡网店铺中与「${safeName}」相关的商品报价与规格信息，对比不同店铺参考价格。`,
    officialPriceNote: "具体价格与适用规则请结合源站店铺商品说明自行核实。",
    compareTips: "下单前请确认交付方式、账号/服务有效期以及售后说明。",
    keywords: [safeName, `${safeName} 比价`, "卡网比价", "店铺收录"],
    faqs: [],
  };
}
