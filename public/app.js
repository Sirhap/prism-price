/**
 * 主分类顺序（与服务端 PRODUCT_GROUPS 对齐）
 */
const BRAND_GROUP_ORDER = [
  "ChatGPT",
  "Codex",
  "Claude",
  "Gemini",
  "Grok",
  "Cursor",
  "Kiro",
  "Antigravity",
  "DeepSeek",
  "Muse",
  "千问",
  "AI视频",
  "AI绘图",
  "AI音乐",
  "AI创作",
  "中转",
  "虚拟卡",
  "代理IP",
  "邮箱账号",
  "平台账号",
  "工具教程",
  "手机卡",
  "游戏商品",
  "其它",
];

const GROUP_DISPLAY_NAMES = {
  AI创作: "AI 视频 / 创作",
  中转: "中转额度",
  代理IP: "代理 / IP",
  工具教程: "工具与教程",
};

const GROUP_CANONICAL_MAP = new Map([
  ...BRAND_GROUP_ORDER.map((group) => [group.toLowerCase(), group]),
  ["ai 视频 / 创作", "AI创作"],
  ["ai视频/创作", "AI创作"],
  ["中转额度", "中转"],
  ["代理 / ip", "代理IP"],
  ["代理/ip", "代理IP"],
  ["工具与教程", "工具教程"],
]);

/** 不存在订阅套餐概念的品牌分组 */
const NON_PLAN_GROUPS = new Set(["Muse", "AI视频", "AI绘图", "AI音乐", "手机卡", "游戏商品", "AI创作", "DeepSeek", "中转", "虚拟卡", "代理IP", "邮箱账号", "平台账号", "工具教程"]);

/** 不存在套餐周期概念的品牌分组 */
const NON_DURATION_GROUPS = new Set(["手机卡", "游戏商品", "虚拟卡", "邮箱账号", "平台账号", "中转", "工具教程"]);

/** 保留的商品筛选维度（已移除低覆盖/失真维度及“未标注”选项） */
const FILTER_DIMENSIONS = [
  {
    key: "type",
    shortLabel: "商品类型",
    options: [
      { value: "ready", label: "成品账号" },
      { value: "recharge", label: "代充 / 兑换码" },
      { value: "api", label: "API / 中转" },
      { value: "sms-service", label: "接码服务" },
    ],
  },
  {
    key: "plan",
    shortLabel: "套餐",
    options: [
      { value: "free", label: "Free 普号" },
      { value: "plus", label: "Plus" },
      { value: "pro", label: "Pro" },
      { value: "ultra", label: "Ultra" },
      { value: "team", label: "Team / Business" },
      { value: "pro5", label: "Pro / Max 5x" },
      { value: "pro20", label: "Pro / Max 20x" },
    ],
  },
  {
    key: "duration",
    shortLabel: "时长",
    options: [
      { value: "day", label: "日卡" },
      { value: "week", label: "周卡" },
      { value: "month", label: "月卡" },
      { value: "quarter", label: "季卡" },
      { value: "half-year", label: "半年" },
      { value: "year", label: "年卡" },
    ],
  },
];

const PRICE_OPTIONS = [
  { value: "under-10", label: "10 元以下" },
  { value: "10-50", label: "10 - 50 元" },
  { value: "50-150", label: "50 - 150 元" },
  { value: "150-500", label: "150 - 500 元" },
  { value: "500-plus", label: "500 元及以上" },
];

const SORT_OPTIONS = new Set(["relevance", "price-asc", "updated-desc"]);
const SHOP_SORT_OPTIONS = new Set(["default", "products-desc", "sales-desc", "updated-desc"]);
const TYPE_OPTION_SET = new Set(FILTER_DIMENSIONS[0].options.map((opt) => opt.value));
const PLAN_OPTION_SET = new Set(FILTER_DIMENSIONS[1].options.map((opt) => opt.value));
const DURATION_OPTION_SET = new Set(FILTER_DIMENSIONS[2].options.map((opt) => opt.value));
const PRICE_OPTION_SET = new Set(PRICE_OPTIONS.map((opt) => opt.value));

/** 首屏与后续加载使用相同的小批量，避免长列表集中渲染。 */
const LIST_PAGE_SIZE = 6;

const HOT_PRODUCT_QUERIES = ["Plus", "Pro", "Claude", "Codex", "Gemini", "API", "接码"];
const HOT_SHOP_QUERIES = ["源头", "对接码", "独角", "API"];

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #4f46e5, #7c3aed)",
  "linear-gradient(135deg, #0284c7, #06b6d4)",
  "linear-gradient(135deg, #7c3aed, #db2777)",
  "linear-gradient(135deg, #d97706, #f59e0b)",
  "linear-gradient(135deg, #2563eb, #4f46e5)",
  "linear-gradient(135deg, #0d9488, #06b6d4)",
];

const STORAGE_KEYS = {
  theme: "ldxp_theme",
  favorites: "ldxp_favorites_v1",
  compare: "ldxp_compare_v1",
  viewMode: "ldxp_view_mode_v1",
};

/** 18 个分类与品牌的专属主题色与矢量图标体系 */
const GROUP_VISUAL_META = {
  all: { color: "#4f46e5", bg: "rgba(79, 70, 229, 0.12)" },
  ChatGPT: { color: "#0d9488", bg: "rgba(13, 148, 136, 0.13)" },
  Codex: { color: "#6366f1", bg: "rgba(99, 102, 241, 0.13)" },
  Claude: { color: "#d97706", bg: "rgba(217, 119, 6, 0.13)" },
  Gemini: { color: "#2563eb", bg: "rgba(37, 99, 235, 0.13)" },
  Grok: { color: "#475569", bg: "rgba(71, 85, 105, 0.14)" },
  Cursor: { color: "#7c3aed", bg: "rgba(124, 58, 237, 0.13)" },
  Kiro: { color: "#9333ea", bg: "rgba(147, 51, 234, 0.13)" },
  Antigravity: { color: "#0891b2", bg: "rgba(8, 145, 178, 0.13)" },
  DeepSeek: { color: "#0284c7", bg: "rgba(2, 132, 199, 0.13)" },
  Muse: { color: "#7c3aed", bg: "rgba(124, 58, 237, 0.13)" },
  千问: { color: "#2563eb", bg: "rgba(37, 99, 235, 0.13)" },
  AI视频: { color: "#db2777", bg: "rgba(219, 39, 119, 0.13)" },
  AI绘图: { color: "#9333ea", bg: "rgba(147, 51, 234, 0.13)" },
  AI音乐: { color: "#e11d48", bg: "rgba(225, 29, 72, 0.13)" },
  手机卡: { color: "#0369a1", bg: "rgba(3, 105, 161, 0.13)" },
  游戏商品: { color: "#b45309", bg: "rgba(180, 83, 9, 0.13)" },
  AI创作: { color: "#db2777", bg: "rgba(219, 39, 119, 0.13)" },
  中转: { color: "#0369a1", bg: "rgba(3, 105, 161, 0.13)" },
  虚拟卡: { color: "#b45309", bg: "rgba(180, 83, 9, 0.13)" },
  代理IP: { color: "#059669", bg: "rgba(5, 150, 105, 0.13)" },
  邮箱账号: { color: "#ea580c", bg: "rgba(234, 88, 12, 0.13)" },
  平台账号: { color: "#4f46e5", bg: "rgba(79, 70, 229, 0.13)" },
  工具教程: { color: "#0f766e", bg: "rgba(15, 118, 110, 0.13)" },
  其它: { color: "#64748b", bg: "rgba(100, 116, 139, 0.13)" },
};

const GROUP_ICONS = {
  all: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15 9 22 12 15 15 12 22 9 15 2 12 9 9 12 2"/></svg>',
  ChatGPT: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2a4.5 4.5 0 0 1 4 6.5L12 11 8 8.5A4.5 4.5 0 0 1 12 2z"/><path d="M20.66 7a4.5 4.5 0 0 1-3.63 6.72L13 12l3-4.33A4.5 4.5 0 0 1 20.66 7z"/><path d="M20.66 17a4.5 4.5 0 0 1-7.63.22L12 13l4.66-.28A4.5 4.5 0 0 1 20.66 17z"/><path d="M12 22a4.5 4.5 0 0 1-4-6.5L12 13l4 2.5A4.5 4.5 0 0 1 12 22z"/><path d="M3.34 17a4.5 4.5 0 0 1 3.63-6.72L11 12l-3 4.33A4.5 4.5 0 0 1 3.34 17z"/><path d="M3.34 7a4.5 4.5 0 0 1 7.63-.22L12 11l-4.66.28A4.5 4.5 0 0 1 3.34 7z"/></svg>',
  Codex: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
  Claude: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>',
  Gemini: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c.5 4.5 4.5 8.5 9 9-4.5.5-8.5 4.5-9 9-.5-4.5-4.5-8.5-9-9 4.5-.5 8.5-4.5 9-9z"/></svg>',
  Grok: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/><line x1="4" y1="20" x2="20" y2="4"/></svg>',
  Cursor: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><polygon points="4 4 20 11 13 13 11 20 4 4"/></svg>',
  Kiro: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
  Antigravity: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-25 12 12)"/></svg>',
  DeepSeek: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12c2-4 6-7 11-7 4 0 7 2 9 5-2 3-5 5-9 5-5 0-9-3-11-3z"/><circle cx="15" cy="10" r="1"/></svg>',
  AI创作: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 9l5 3-5 3V9z"/></svg>',
  中转: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><path d="M8.5 7.5L10.5 15.5M15.5 7.5L13.5 15.5M9 6h6"/></svg>',
  虚拟卡: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
  代理IP: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8"/><path d="M12 3a13.5 13.5 0 0 1 0 18M12 3a13.5 13.5 0 0 0 0 18"/></svg>',
  邮箱账号: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22,6 12,13 2,6"/></svg>',
  平台账号: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  工具教程: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
  其它: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>',
};

function getGroupIconHtml(groupKey) {
  const aliases = { Muse: "ChatGPT", 千问: "DeepSeek", AI视频: "AI创作", AI绘图: "AI创作", AI音乐: "AI创作", 手机卡: "虚拟卡", 游戏商品: "其它" };
  return GROUP_ICONS[groupKey] || GROUP_ICONS[aliases[groupKey]] || GROUP_ICONS["其它"];
}

function getGroupBrandStyle(groupKey) {
  const meta = GROUP_VISUAL_META[groupKey] || GROUP_VISUAL_META["其它"];
  return `--brand-color:${meta.color};--brand-bg:${meta.bg};--card-brand-color:${meta.color};`;
}

/** 主流 AI 服务官网参考订阅定价（按站内统一参考汇率 1 USD ≈ ¥7.15 粗算，仅作成本参考） */
const OFFICIAL_REFERENCE_PRICES = {
  ChatGPT: {
    headline: "ChatGPT 官网参考价",
    plans: {
      free: "Free 可免费注册（有使用限额）",
      plus: "Plus $20/月（折合约 ¥143）",
      pro: "Pro $200/月（折合约 ¥1,430）",
      team: "Team/Business $25–30/座/月",
    },
    defaultSummary: "Plus $20/月（约 ¥143）· Team $25–30/座/月 · Pro $200/月（约 ¥1,430）",
  },
  Codex: {
    headline: "Codex 官网参考价",
    plans: {
      plus: "随 ChatGPT Plus $20/月 附带",
      pro: "随 ChatGPT Pro $200/月 附带高额度",
    },
    defaultSummary: "包含于 ChatGPT Plus ($20/月) / Pro ($200/月) 订阅内",
  },
  Claude: {
    headline: "Claude 官网参考价",
    plans: {
      free: "Free 可免费注册（有额度限制）",
      pro: "Pro $20/月（折合约 ¥143）",
      pro5: "Max 5x $100/月（折合约 ¥715）",
      pro20: "Max 20x $200/月（折合约 ¥1,430）",
      team: "Team $25–30/座/月",
    },
    defaultSummary: "Pro $20/月（约 ¥143）· Max 5x $100/月 · Max 20x $200/月",
  },
  Gemini: {
    headline: "Google AI / Gemini 官网参考价",
    plans: {
      pro: "Google AI Pro $19.99/月（折合约 ¥143）",
      ultra: "Google AI Ultra $249.99/月（折合约 ¥1,787）",
    },
    defaultSummary: "AI Pro $19.99/月（约 ¥143）· AI Ultra $249.99/月（约 ¥1,787）",
  },
  Cursor: {
    headline: "Cursor 官网参考价",
    plans: {
      free: "Hobby 可免费试用（有限额度）",
      pro: "Pro $20/月（折合约 ¥143）",
      ultra: "Ultra $200/月（折合约 ¥1,430）",
      team: "Teams $40/座/月",
    },
    defaultSummary: "Pro $20/月（约 ¥143）· Pro+ $60/月 · Ultra $200/月",
  },
  Grok: {
    headline: "Grok / xAI 官网参考价",
    plans: {},
    defaultSummary: "SuperGrok $30/月（折合约 ¥215）",
  },
};

/** 各操作触发零结果自愈时允许清理的下游维度（从最下游排到最上游） */
const DOWNSTREAM_CLEAN_SCOPES = {
  q: ["price", "duration", "plan", "type", "group"],
  group: ["price", "duration", "plan", "type"],
  type: ["price", "duration", "plan"],
  plan: ["price", "duration"],
  duration: ["price"],
};

/** 卡片徽章独立展示字典（与筛选维度配置彻底解耦） */
const CARD_BADGE_LABELS = {
  type: {
    ready: "成品账号",
    recharge: "代充 / 兑换码",
    cdk: "代充 / 兑换码",
    api: "API / 中转",
    "sms-service": "接码服务",
  },
  plan: {
    free: "Free 普号",
    plus: "Plus",
    pro: "Pro",
    ultra: "Ultra",
    team: "Team / Business",
    business: "Team / Business",
    pro5: "Pro / Max 5x",
    pro20: "Pro / Max 20x",
  },
  duration: {
    day: "日卡",
    week: "周卡",
    month: "月卡",
    quarter: "季卡",
    "half-year": "半年",
    year: "年卡",
  },
  sms: {
    done: "已接码",
    pending: "未接码",
  },
  region: {
    us: "美区",
    jp: "日区",
    hk: "港区",
    tw: "台区",
    uk: "英区",
    tr: "土区",
    ph: "菲区",
    random: "随机地区",
  },
};

const DIM_OPTION_LABEL_MAP = buildOptionLabelMap();

const SHOP_RISK_NOTICE_TEXT =
  "本站仅做公开店铺信息收录，不参与交易，也不对店铺商品、售后和风险负责。使用前请自行甄别。";

const SHOP_SORT_LABELS = {
  default: "综合推荐",
  "products-desc": "在售商品最多",
  "sales-desc": "参考销量优先",
  "updated-desc": "最近更新优先",
};

const state = {
  mode: "product",
  q: "",
  searchDraft: "",
  group: "all",
  type: "all",
  plan: "all",
  duration: "all",
  price: "all",
  minPrice: "",
  maxPrice: "",
  sort: "relevance",
  page: 1,
  shopPage: 1,
  shopSystemType: "all",
  shopSort: "default",
  shopOnlyInStock: false,
  shopHasIntegrationCode: false,
  shopSystemLabels: {},
  shopSystemFacets: {},
  shopTotal: 0,
  shopTotalAll: 0,
  shopTotalPages: 1,
  moreFiltersOpen: false,
  filterNotice: "",
  initialClearedLabels: [],
  catalogGroupCounts: null,
  catalogBaselineDirty: false,
  baselineController: null,
  expandedGroupKeys: new Set(),
  fullOffersCache: new Map(),
  loadingOfferKeys: new Set(),
  productsData: null,
  allItems: [],
  shopsData: [],
  requestSeq: 0,
  shopRequestSeq: 0,
  facetCache: new Map(),
  productController: null,
  shopController: null,
  productLoading: false,
  shopLoading: false,
  profileController: null,
  profileTrigger: null,
  workbenchTrigger: null,
  workbenchTab: "compare",
  favorites: loadFavoritesFromStorage(),
  compareItems: loadCompareFromStorage(),
  viewMode: loadViewModeFromStorage(),
};

const els = {
  workspaceSection: document.querySelector("#workspaceSection"),
  brandRail: document.querySelector("#brandRail"),
  viewLayoutSwitch: document.querySelector("#viewLayoutSwitch"),
  viewListBtn: document.querySelector("#viewListBtn"),
  viewGridBtn: document.querySelector("#viewGridBtn"),
  resultStatus: document.querySelector("#resultStatus"),
  requestMessage: document.querySelector("#requestMessage"),
  activeFilters: document.querySelector("#activeFilters"),
  shopControlsWrap: document.querySelector("#shopControlsWrap"),
  shopSystemSelect: document.querySelector("#shopSystemSelect"),
  shopSortSelect: document.querySelector("#shopSortSelect"),
  shopOnlyInStockInput: document.querySelector("#shopOnlyInStockInput"),
  shopHasIntegrationCodeInput: document.querySelector("#shopHasIntegrationCodeInput"),
  shopResetFiltersBtn: document.querySelector("#shopResetFiltersBtn"),
  shopCount: document.querySelector("#shopCount"),
  groupCount: document.querySelector("#groupCount"),
  offerCount: document.querySelector("#offerCount"),
  tabProductCount: document.querySelector("#tabProductCount"),
  tabShopCount: document.querySelector("#tabShopCount"),
  searchInput: document.querySelector("#searchInput"),
  clearSearchBtn: document.querySelector("#clearSearchBtn"),
  hotQueries: document.querySelector("#hotQueries"),
  sortSelect: document.querySelector("#sortSelect"),
  productControlsWrap: document.querySelector("#productControlsWrap"),
  customPriceWrap: document.querySelector(".custom-price-range"),
  customMinPrice: document.querySelector("#customMinPrice"),
  customMaxPrice: document.querySelector("#customMaxPrice"),
  applyCustomPriceBtn: document.querySelector("#applyCustomPriceBtn"),
  toggleMoreFiltersBtn: document.querySelector("#toggleMoreFiltersBtn"),
  resetFiltersBtn: document.querySelector("#resetFiltersBtn"),
  shareFiltersBtn: document.querySelector("#shareFiltersBtn"),
  primaryFilters: document.querySelector("#primaryFilters"),
  moreFiltersPanel: document.querySelector("#moreFiltersPanel"),
  facetNoteBar: document.querySelector("#facetNoteBar"),
  filterNoticeBar: document.querySelector("#filterNoticeBar"),
  brandChips: document.querySelector("#brandChips"),
  productView: document.querySelector("#productView"),
  shopView: document.querySelector("#shopView"),
  productList: document.querySelector("#productList"),
  loadMoreWrap: document.querySelector("#loadMoreWrap"),
  loadMoreBtn: document.querySelector("#loadMoreBtn"),
  productEmpty: document.querySelector("#productEmpty"),
  shopList: document.querySelector("#shopList"),
  shopLoadMoreWrap: document.querySelector("#shopLoadMoreWrap"),
  shopLoadMoreBtn: document.querySelector("#shopLoadMoreBtn"),
  shopEmpty: document.querySelector("#shopEmpty"),
  profileModal: document.querySelector("#profileModal"),
  profileBody: document.querySelector("#profileBody"),
  officialPriceAnchor: document.querySelector("#officialPriceAnchor"),
  themeToggleBtn: document.querySelector("#themeToggleBtn"),
  workbenchBtn: document.querySelector("#workbenchBtn"),
  workbenchBadge: document.querySelector("#workbenchBadge"),
  workbenchModal: document.querySelector("#workbenchModal"),
  workbenchBody: document.querySelector("#workbenchBody"),
  wbCompareCount: document.querySelector("#wbCompareCount"),
  wbFavCount: document.querySelector("#wbFavCount"),
  compareBar: document.querySelector("#compareBar"),
  compareDockItems: document.querySelector("#compareDockItems"),
  compareDockCount: document.querySelector("#compareDockCount"),
  openCompareModalBtn: document.querySelector("#openCompareModalBtn"),
  clearCompareBtn: document.querySelector("#clearCompareBtn"),
  backToTopBtn: document.querySelector("#backToTopBtn"),
  toastStack: document.querySelector("#toastStack"),
};

function buildOptionLabelMap() {
  const map = {};
  for (const dim of FILTER_DIMENSIONS) {
    map[dim.key] = {};
    for (const opt of dim.options) {
      map[dim.key][opt.value] = opt.label;
    }
  }
  return map;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || "").trim());
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.href;
    }
  } catch {
    // 忽略非法链接
  }
  return "";
}

function formatPrice(val) {
  if (val === null || val === undefined || val === "") return "待确认";
  const num = Number(val);
  return Number.isFinite(num) ? `¥${num.toFixed(2)}` : "待确认";
}

/**
 * 将 ISO 时间格式化为含年份的完整时间格式 YYYY-MM-DD HH:mm
 */
function formatFullDateTime(iso, emptyText = "未记录") {
  if (!iso) return emptyText;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatGroupLabel(groupKey) {
  return GROUP_DISPLAY_NAMES[groupKey] || groupKey;
}

function formatAdapterBadge(adapterType) {
  if (adapterType === "push_ingest") return "推送收录";
  if (adapterType === "manual") return "人工收录";
  return "接口收录";
}

function formatStockText(stockCount, stockStatus) {
  if (stockCount !== null && stockCount !== undefined) {
    if (Number(stockCount) <= 0) return "采集时缺货，库存以店铺为准";
    return `余 ${stockCount}`;
  }
  return "库存以店铺为准";
}

function normalizeGroupValue(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed || trimmed.toLowerCase() === "all") return "all";
  return GROUP_CANONICAL_MAP.get(trimmed.toLowerCase()) || "all";
}

/**
 * 解析自定义价格文本输入（有效非负有限数返回字符串，非法返空串）
 */
function sanitizeCustomPriceInput(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0 || num >= 1_000_000) return "";
  const rounded = Math.round(num * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function hasCustomPriceFilter() {
  return state.minPrice !== "" || state.maxPrice !== "";
}

function formatCustomPriceSummary() {
  if (state.minPrice !== "" && state.maxPrice !== "") {
    return `¥${state.minPrice} - ¥${state.maxPrice}`;
  }
  if (state.minPrice !== "") {
    return `≥ ¥${state.minPrice}`;
  }
  if (state.maxPrice !== "") {
    return `≤ ¥${state.maxPrice}`;
  }
  return "";
}

function filterValueLabel(key, value) {
  if (key === "group") return formatGroupLabel(value);
  if (key === "price") return PRICE_OPTIONS.find((opt) => opt.value === value)?.label || value;
  return DIM_OPTION_LABEL_MAP[key]?.[value] || value;
}

function describeClearedFilter(key, value) {
  if (key === "group") return `品牌（${formatGroupLabel(value)}）`;
  if (key === "price") return `价格（${value === "custom" ? formatCustomPriceSummary() : filterValueLabel("price", value)}）`;
  if (key === "shopSystemType") return `卡网系统（${state.shopSystemLabels[value] || value}）`;
  const dim = FILTER_DIMENSIONS.find((item) => item.key === key);
  const label = filterValueLabel(key, value);
  return dim ? `${dim.shortLabel}（${label}）` : label;
}

/**
 * 声明式上下文规则校验器：清理当前品牌或商品类型下不适用的套餐/时长条件
 */
function enforceProductContextConstraints() {
  const cleared = [];
  const allowsPlan = !NON_PLAN_GROUPS.has(state.group) && state.type !== "sms-service" && state.type !== "api";
  const allowsDuration = !NON_DURATION_GROUPS.has(state.group);

  if (!allowsPlan && state.plan !== "all") {
    cleared.push(describeClearedFilter("plan", state.plan));
    state.plan = "all";
  }
  if (!allowsDuration && state.duration !== "all") {
    cleared.push(describeClearedFilter("duration", state.duration));
    state.duration = "all";
  }
  return cleared;
}

/** 计算当前已选条件在首次加载或历史回退时允许自动清理的下游层级 */
function resolveInitialCleanScope() {
  if (state.q.trim()) return "q";
  if (state.group !== "all") return "group";
  if (state.type !== "all") return "type";
  if (state.plan !== "all") return "plan";
  if (state.duration !== "all") return "duration";
  return "none";
}

function setFilterNotice(message) {
  state.filterNotice = message || "";
  renderFilterNotice();
}

function renderFilterNotice() {
  if (!state.filterNotice) {
    els.filterNoticeBar.hidden = true;
    els.filterNoticeBar.innerHTML = "";
    return;
  }
  els.filterNoticeBar.hidden = false;
  els.filterNoticeBar.innerHTML = `<span>${escapeHtml(state.filterNotice)}</span><button type="button" class="filter-notice-close" aria-label="关闭提示">×</button>`;
}

/** 显示全局右上角轻提示（最多保留 2 条，避免遮挡操作区） */
function showToast(message) {
  if (!els.toastStack || !message) return;
  while (els.toastStack.children.length >= 2) {
    els.toastStack.firstElementChild?.remove();
  }
  const item = document.createElement("div");
  item.className = "toast-item";
  item.textContent = message;
  els.toastStack.appendChild(item);
  setTimeout(() => {
    item.remove();
  }, 2400);
}

/** 兼容旧版收藏及短缓存中的系统显示名称。 */
function formatShopSystemLabel(label) {
  return label || "第三方自建站（待确认）";
}

/** 旧版收藏仍可能含联系信息，展示时同样隐藏。 */
function hideSavedTelegram(text = "") {
  return String(text).replace(/(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/[^\s<>"'，。；）)]+/gi, "[联系方式已隐藏]")
    .replace(/(?<![\w.])@[A-Za-z0-9_]{4,32}\b/g, "[联系方式已隐藏]");
}

/** 对接码直接复制原始字符串，不附带标签或店名。 */
function renderIntegrationCodes(codes) {
  return (Array.isArray(codes) ? codes : []).map((code) =>
    `<button type="button" class="copy-inline-btn integration-code" aria-label="复制对接码 ${escapeHtml(code)}" data-copy-text="${escapeHtml(code)}" data-copy-label="对接码" title="点击复制对接码">对接码 <code>${escapeHtml(code)}</code> ⧉</button>`).join(" ");
}

/** 复制文本并给出反馈 */
async function copyTextWithFeedback(text, label = "内容") {
  const content = String(text || "").trim();
  if (!content) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(content);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = content;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) throw new Error("Copy rejected");
    }
    showToast(`已复制${label}`);
  } catch {
    showToast(`复制${label}失败，请手动复制`);
  }
}

/** 生成与店铺名称绑定的确定性渐变头像 */
function shopAvatarGradient(shopName) {
  const text = String(shopName || "店");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
}

function shopInitialChar(shopName) {
  const trimmed = String(shopName || "").trim();
  if (!trimmed) return "店";
  return trimmed.slice(0, 1).toUpperCase();
}

/* ==================== 主题、收藏夹与对比持久化 ==================== */
function loadFavoritesFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.favorites);
    if (!raw) return { products: [], shops: [] };
    const parsed = JSON.parse(raw);
    return {
      products: Array.isArray(parsed?.products) ? parsed.products : [],
      shops: Array.isArray(parsed?.shops) ? parsed.shops : [],
    };
  } catch {
    return { products: [], shops: [] };
  }
}

function saveFavoritesToStorage() {
  try {
    localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify(state.favorites));
  } catch {
    // 忽略无痕模式或配额异常
  }
}

function loadCompareFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.compare);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 4) : [];
  } catch {
    return [];
  }
}

function saveCompareToStorage() {
  try {
    localStorage.setItem(STORAGE_KEYS.compare, JSON.stringify(state.compareItems));
  } catch {
    // 忽略无痕模式或配额异常
  }
}

function isProductFavorited(id) {
  return state.favorites.products.some((item) => item.id === id);
}

function isShopFavorited(id) {
  return state.favorites.shops.some((item) => item.id === id);
}

function isProductCompared(id) {
  return state.compareItems.some((item) => item.id === id);
}

function compactProductRecord(item) {
  return {
    id: item.id,
    name: item.name,
    group: item.group,
    attributes: item.attributes || {},
    warrantyText: item.warrantyText || "",
    minPrice: item.minPrice,
    medianPrice: item.medianPrice,
    maxPrice: item.maxPrice,
    shopCount: item.shopCount,
    offerCount: item.offerCount,
    shopName: item.shopName,
    itemUrl: item.itemUrl,
    updatedAt: item.updatedAt,
  };
}

function toggleProductFavorite(productId) {
  const existingIdx = state.favorites.products.findIndex((p) => p.id === productId);
  if (existingIdx >= 0) {
    state.favorites.products.splice(existingIdx, 1);
    showToast("已取消收藏商品");
  } else {
    const found = state.allItems.find((p) => p.id === productId);
    if (!found) return;
    state.favorites.products.unshift(compactProductRecord(found));
    if (state.favorites.products.length > 60) state.favorites.products.length = 60;
    showToast("已收藏该商品");
  }
  saveFavoritesToStorage();
  renderWorkbenchIndicators();
  renderProductGroup(productId);
  if (!els.workbenchModal.hidden) renderWorkbenchBody();
}

function toggleShopFavorite(shopObj) {
  if (!shopObj?.id) return;
  const existingIdx = state.favorites.shops.findIndex((s) => s.id === shopObj.id);
  if (existingIdx >= 0) {
    state.favorites.shops.splice(existingIdx, 1);
    showToast("已取消收藏店铺");
  } else {
    state.favorites.shops.unshift({
      id: shopObj.id,
      shopName: shopObj.shopName,
      systemTypeLabel: shopObj.systemTypeLabel || "待识别",
      productCount: Number(shopObj.productCount || 0),
      integrationCodes: shopObj.integrationCodes || [],
    });
    if (state.favorites.shops.length > 60) state.favorites.shops.length = 60;
    showToast(`已收藏店铺：${shopObj.shopName}`);
  }
  saveFavoritesToStorage();
  renderWorkbenchIndicators();
  if (state.mode === "shop") renderShops();
  if (!els.workbenchModal.hidden) renderWorkbenchBody();
}

function toggleProductCompare(productId) {
  const existingIdx = state.compareItems.findIndex((p) => p.id === productId);
  if (existingIdx >= 0) {
    state.compareItems.splice(existingIdx, 1);
    showToast("已移出对比清单");
  } else {
    if (state.compareItems.length >= 4) {
      showToast("最多支持同时对比 4 款商品，请先清理 1 项");
      return;
    }
    const found = state.allItems.find((p) => p.id === productId) || state.favorites.products.find((p) => p.id === productId);
    if (!found) return;
    state.compareItems.push(compactProductRecord(found));
    showToast("已加入同台对比");
  }
  saveCompareToStorage();
  renderWorkbenchIndicators();
  renderProductGroup(productId);
  if (!els.workbenchModal.hidden) renderWorkbenchBody();
}

function renderWorkbenchIndicators() {
  const compareCount = state.compareItems.length;
  const favCount = state.favorites.products.length + state.favorites.shops.length;
  const totalCount = compareCount + favCount;

  if (els.workbenchBadge) {
    els.workbenchBadge.hidden = totalCount === 0;
    els.workbenchBadge.textContent = String(totalCount);
  }
  if (els.wbCompareCount) els.wbCompareCount.textContent = String(compareCount);
  if (els.wbFavCount) els.wbFavCount.textContent = String(favCount);

  if (els.compareBar) {
    els.compareBar.hidden = compareCount === 0;
    els.compareDockCount.textContent = String(compareCount);
    els.compareDockItems.textContent = state.compareItems.map((item) => item.name).join(" · ");
  }
}

function applyTheme(theme) {
  const isDark = theme === "dark";
  if (isDark) {
    document.documentElement.dataset.theme = "dark";
  } else {
    delete document.documentElement.dataset.theme;
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", isDark ? "#090b14" : "#4f46e5");
  try {
    localStorage.setItem(STORAGE_KEYS.theme, isDark ? "dark" : "light");
  } catch {
    // 忽略
  }
}

function toggleTheme() {
  const currentDark = document.documentElement.dataset.theme === "dark";
  const next = currentDark ? "light" : "dark";
  applyTheme(next);
  showToast(next === "dark" ? "已切换深色黑曜石模式" : "已切换浅色极光模式");
}

function loadViewModeFromStorage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.viewMode);
    if (saved === "grid" || saved === "list") return saved;
  } catch {
    // 忽略
  }
  return "list";
}

function applyViewMode(viewMode) {
  const isGrid = viewMode === "grid";
  state.viewMode = isGrid ? "grid" : "list";
  els.productList?.classList.toggle("is-grid-view", isGrid);
  if (els.viewListBtn) {
    els.viewListBtn.classList.toggle("is-active", !isGrid);
    els.viewListBtn.setAttribute("aria-pressed", !isGrid ? "true" : "false");
  }
  if (els.viewGridBtn) {
    els.viewGridBtn.classList.toggle("is-active", isGrid);
    els.viewGridBtn.setAttribute("aria-pressed", isGrid ? "true" : "false");
  }
}

function setViewMode(viewMode) {
  applyViewMode(viewMode);
  try {
    localStorage.setItem(STORAGE_KEYS.viewMode, state.viewMode);
  } catch {
    // 忽略
  }
}

/* ==================== URL 状态读取与同步 ==================== */
function readStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");
  state.mode = mode === "shop" ? "shop" : "product";
  state.q = (params.get("q") || "").trim();
  state.searchDraft = state.q;

  const rawGroup = params.get("group");
  state.group = normalizeGroupValue(rawGroup);

  const rawType = (params.get("type") || "").trim().toLowerCase();
  const rawSms = (params.get("sms") || "").trim().toLowerCase();
  let nextType = rawType === "cdk" ? "recharge" : rawType;
  if (!TYPE_OPTION_SET.has(nextType)) nextType = "all";
  if (nextType === "all" && rawSms === "service") nextType = "sms-service";
  state.type = nextType;

  const rawPlan = (params.get("plan") || "").trim().toLowerCase();
  const mappedPlan = rawPlan === "business" ? "team" : rawPlan;
  state.plan = PLAN_OPTION_SET.has(mappedPlan) ? mappedPlan : "all";

  const rawDuration = (params.get("duration") || "").trim().toLowerCase();
  state.duration = DURATION_OPTION_SET.has(rawDuration) ? rawDuration : "all";

  let minPrice = sanitizeCustomPriceInput(params.get("minPrice"));
  let maxPrice = sanitizeCustomPriceInput(params.get("maxPrice"));
  if (minPrice !== "" && maxPrice !== "" && Number(minPrice) > Number(maxPrice)) {
    [minPrice, maxPrice] = [maxPrice, minPrice];
  }
  state.minPrice = minPrice;
  state.maxPrice = maxPrice;

  const rawPrice = (params.get("price") || "").trim().toLowerCase();
  state.price = !hasCustomPriceFilter() && PRICE_OPTION_SET.has(rawPrice) ? rawPrice : "all";

  const rawSort = (params.get("sort") || "").trim().toLowerCase();
  const mappedSort = rawSort === "shop-desc" ? "relevance" : rawSort;
  state.sort = SORT_OPTIONS.has(mappedSort) ? mappedSort : "relevance";
  state.shopSort = SHOP_SORT_OPTIONS.has(rawSort) ? rawSort : "default";

  state.shopSystemType = (params.get("systemType") || "").trim() || "all";
  const isFlagOn = (key) => ["1", "true", "yes"].includes((params.get(key) || "").trim().toLowerCase());
  state.shopOnlyInStock = isFlagOn("onlyInStock") || isFlagOn("hasProducts");
  state.shopHasIntegrationCode = isFlagOn("hasIntegrationCode");

  const clearedByContext = enforceProductContextConstraints();
  const discardedParams = [];
  if (rawGroup && rawGroup.trim().toLowerCase() !== "all" && state.group === "all") discardedParams.push(`品牌（${rawGroup}）`);
  if (rawType && rawType !== "all" && rawType !== "cdk" && state.type === "all") discardedParams.push(`商品类型（${rawType}）`);
  if (rawPlan && rawPlan !== "all" && rawPlan !== "business" && state.plan === "all") discardedParams.push(`套餐（${rawPlan}）`);
  if (rawDuration && rawDuration !== "all" && state.duration === "all") discardedParams.push(`时长（${rawDuration}）`);
  if (rawPrice && rawPrice !== "all" && !hasCustomPriceFilter() && state.price === "all") discardedParams.push(`价格（${rawPrice}）`);
  for (const deprecatedKey of ["warranty", "region"]) {
    const val = (params.get(deprecatedKey) || "").trim();
    if (val && val !== "all") discardedParams.push(`${deprecatedKey}=${val}`);
  }
  if (rawSms && rawSms !== "all" && (rawSms !== "service" || (rawType && rawType !== "all" && rawType !== "sms-service"))) {
    discardedParams.push(`sms=${rawSms}`);
  }

  const allCleared = [...new Set([...clearedByContext, ...discardedParams])];
  state.initialClearedLabels = state.mode === "product" ? allCleared : [];
  state.filterNotice =
    state.mode === "product" && allCleared.length > 0
      ? `已自动忽略或清除无效/冲突的筛选条件：${allCleared.join("、")}`
      : "";

  state.page = 1;
  state.shopPage = 1;
}

/**
 * 视图参数隔离：找商品与看店铺模式下仅往 URL 同步当前模式参数，互不污染
 */
function syncStateToUrl() {
  const params = new URLSearchParams();
  if (state.mode === "shop") {
    params.set("mode", "shop");
    if (state.q.trim()) params.set("q", state.q.trim());
    if (state.shopSystemType !== "all") params.set("systemType", state.shopSystemType);
    if (state.shopSort !== "default") params.set("sort", state.shopSort);
    if (state.shopOnlyInStock) params.set("onlyInStock", "1");
    if (state.shopHasIntegrationCode) params.set("hasIntegrationCode", "1");
  } else {
    if (state.q.trim()) params.set("q", state.q.trim());
    if (state.group !== "all") params.set("group", state.group);
    if (state.type !== "all") params.set("type", state.type);
    if (state.plan !== "all") params.set("plan", state.plan);
    if (state.duration !== "all") params.set("duration", state.duration);
    if (hasCustomPriceFilter()) {
      if (state.minPrice !== "") params.set("minPrice", state.minPrice);
      if (state.maxPrice !== "") params.set("maxPrice", state.maxPrice);
    } else if (state.price !== "all") {
      params.set("price", state.price);
    }
    if (state.sort !== "relevance") params.set("sort", state.sort);
  }

  const queryString = params.toString();
  const nextUrl = queryString ? `${window.location.pathname}?${queryString}` : window.location.pathname;
  window.history.replaceState(null, "", nextUrl);
}

function syncSearchInputHelpers() {
  const val = els.searchInput.value.trim();
  if (els.clearSearchBtn) {
    els.clearSearchBtn.hidden = val.length === 0;
  }
  renderHotQueries();
}

function renderHotQueries() {
  if (!els.hotQueries) return;
  const list = state.mode === "shop" ? HOT_SHOP_QUERIES : HOT_PRODUCT_QUERIES;
  const activeQuery = state.searchDraft.trim().toLowerCase();
  els.hotQueries.innerHTML =
    '<span class="hot-queries-label">热门搜：</span>' +
    list
      .map((word) => {
        const isActive = activeQuery === word.toLowerCase();
        return `<button type="button" class="hot-query-chip${isActive ? " is-active" : ""}" data-hot-query="${escapeHtml(word)}">${escapeHtml(word)}</button>`;
      })
      .join("");
}

function syncControlsFromState() {
  if (document.activeElement !== els.searchInput) els.searchInput.value = state.searchDraft;
  els.sortSelect.value = state.sort;
  if (els.customMinPrice && document.activeElement !== els.customMinPrice) els.customMinPrice.value = state.minPrice;
  if (els.customMaxPrice && document.activeElement !== els.customMaxPrice) els.customMaxPrice.value = state.maxPrice;
  if (els.customPriceWrap) els.customPriceWrap.classList.toggle("is-active", hasCustomPriceFilter());

  const hasProductFilters =
    state.type !== "all" ||
    state.plan !== "all" ||
    state.duration !== "all" ||
    state.price !== "all" ||
    hasCustomPriceFilter() ||
    state.group !== "all" ||
    Boolean(state.q.trim());
  els.resetFiltersBtn.hidden = !hasProductFilters;

  els.shopOnlyInStockInput.checked = state.shopOnlyInStock;
  if (els.shopHasIntegrationCodeInput) els.shopHasIntegrationCodeInput.checked = state.shopHasIntegrationCode;
  if (els.shopSortSelect) els.shopSortSelect.value = state.shopSort;

  const hasShopFilters =
    state.shopSystemType !== "all" ||
    state.shopSort !== "default" ||
    state.shopOnlyInStock ||
    state.shopHasIntegrationCode ||
    Boolean(state.q.trim());
  els.shopResetFiltersBtn.hidden = !hasShopFilters;

  syncSearchInputHelpers();
  renderFilterNotice();
  renderActiveFilters();
}

function cancelPendingLists() {
  ++state.requestSeq;
  ++state.shopRequestSeq;
  state.productController?.abort();
  state.shopController?.abort();
  state.productLoading = false;
  state.shopLoading = false;
  els.productView.setAttribute("aria-busy", "false");
  els.shopView.setAttribute("aria-busy", "false");
  els.loadMoreBtn.disabled = false;
  els.shopLoadMoreBtn.disabled = false;
}

function switchMode(mode) {
  cancelPendingLists();
  state.mode = mode === "shop" ? "shop" : "product";
  document.querySelectorAll(".mode-tab").forEach((btn) => {
    const active = btn.dataset.mode === state.mode;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });

  const isProduct = state.mode === "product";
  els.searchInput.placeholder = isProduct
    ? "搜索 ChatGPT Plus、Claude Pro、Codex、美区，或输入店铺名称…"
    : "搜索店铺名称、主营类别、系统类型或网址…";
  els.sortSelect.hidden = !isProduct;
  els.activeFilters.hidden = false;
  els.requestMessage.hidden = true;
  updateResultStatus();
  els.productView.hidden = !isProduct;
  els.shopView.hidden = isProduct;
  els.shopControlsWrap.hidden = isProduct;
  els.productControlsWrap.hidden = !isProduct;
  els.brandChips.hidden = !isProduct;
  els.workspaceSection?.classList.toggle("is-shop-mode", !isProduct);
  if (els.brandRail) els.brandRail.hidden = !isProduct;
  if (els.viewLayoutSwitch) els.viewLayoutSwitch.hidden = !isProduct;
  if (!isProduct) {
    els.moreFiltersPanel.hidden = true;
    els.facetNoteBar.hidden = true;
    renderShopSystemControls();
    syncControlsFromState();
  } else {
    renderFilterControls();
  }
  renderHotQueries();
  syncStateToUrl();
}

function getFacetCount(facets, key, value) {
  if (!facets || !value || value === "all") return 0;
  if (key === "group") return Number(facets.groups?.[value] || 0);
  if (key === "price") return Number(facets.prices?.[value] || 0);
  return Number(facets.options?.[key]?.[value] || 0);
}

function hasFacetAlternative(facets, key) {
  if (!facets) return false;
  const bucket = key === "group" ? facets.groups : key === "price" ? facets.prices : facets.options?.[key];
  return Object.values(bucket || {}).some((count) => Number(count) > 0);
}

/**
 * 在首次以窄条件进入页面或刷新后，静默更新全目录品牌分布基线，避免其它品牌芯片“蒸发”
 */
async function ensureCatalogGroupBaseline(force = false) {
  if ((!force && state.catalogGroupCounts && !state.catalogBaselineDirty) || state.baselineController) return;
  const controller = new AbortController();
  state.baselineController = controller;
  try {
    const res = await fetch("/api/products?pageSize=1", {
      signal: controller.signal,
      cache: force ? "reload" : "default",
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data?.facets?.groups) {
      state.catalogGroupCounts = { ...data.facets.groups };
      state.catalogBaselineDirty = false;
      if (state.mode === "product") {
        renderBrandChips();
      }
    }
  } catch {
    // 基线仅用于防止窄条件品牌蒸发，失败时静默降级
  } finally {
    if (state.baselineController === controller) {
      state.baselineController = null;
    }
  }
}

function buildProductApiParams(reuseFacets = false) {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set("q", state.q.trim());
  if (state.group !== "all") params.set("group", state.group);
  if (state.type !== "all") params.set("type", state.type);
  if (state.plan !== "all") params.set("plan", state.plan);
  if (state.duration !== "all") params.set("duration", state.duration);
  if (hasCustomPriceFilter()) {
    if (state.minPrice !== "") params.set("minPrice", state.minPrice);
    if (state.maxPrice !== "") params.set("maxPrice", state.maxPrice);
  } else if (state.price !== "all") {
    params.set("price", state.price);
  }
  params.set("sort", state.sort);
  params.set("page", String(state.page));
  params.set("pageSize", String(LIST_PAGE_SIZE));
  if (reuseFacets) params.set("facets", "0");
  return params;
}

function currentFacetScopeKey() {
  return JSON.stringify([
    state.q.trim(),
    state.group,
    ...FILTER_DIMENSIONS.map((dim) => state[dim.key]),
    state.price,
    state.minPrice,
    state.maxPrice,
  ]);
}

function applyAppliedFilters(data) {
  if (!data?.appliedFilters) return;
  const previousQuery = state.q;
  state.q = data.appliedFilters.q ?? state.q;
  if (state.searchDraft.trim() === previousQuery) state.searchDraft = state.q;
  state.group = data.appliedFilters.group || "all";
  state.type = data.appliedFilters.type || "all";
  state.plan = data.appliedFilters.plan || "all";
  state.duration = data.appliedFilters.duration || "all";
  state.price = data.appliedFilters.price || "all";
  state.sort = SORT_OPTIONS.has(data.appliedFilters.sort) ? data.appliedFilters.sort : "relevance";
  if (data.appliedPriceRange) {
    const { minPrice, maxPrice } = data.appliedPriceRange;
    state.minPrice = minPrice !== null && minPrice !== undefined ? String(minPrice) : "";
    state.maxPrice = maxPrice !== null && maxPrice !== undefined ? String(maxPrice) : "";
  }
}

/** 统一识别查询受限与缓存副本，避免客户端自动反复重试。 */
async function readPublicJson(response) {
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const error = new Error(`HTTP ${response.status}`);
    error.code = payload?.code || "";
    throw error;
  }
  const data = await response.json();
  if (data && typeof data === "object") data._stale = response.headers.get("X-Data-Stale") === "1";
  return data;
}

async function fetchProductSnapshot(signal, reuseFacets = false) {
  const params = buildProductApiParams(reuseFacets);
  const res = await fetch(`/api/products?${params.toString()}`, {
    signal,
    cache: "default",
  });
  return readPublicJson(res);
}

/**
 * 零结果自愈校验器（上游优先保真、下游严格收敛）：
 * 1. 若仅清除最下游 1 个备选值非空的维度即可恢复 > 0，则直接最小改动收敛；
 * 2. 否则先试探清空所有下游条件，若上游自身依然为 0（如错拼搜索词），保留原筛选不误删；
 * 3. 若上游存在商品，则从上游到下游逐层验证恢复兼容的筛选并剔除真正冲突项。
 */
async function reconcileZeroProductResult(initialData, cleanScope, signal, seq) {
  if (cleanScope === "none" || Number(initialData.total || 0) > 0 || !initialData.facets) {
    return { data: initialData, clearedLabels: [] };
  }
  const candidates = DOWNSTREAM_CLEAN_SCOPES[cleanScope] || [];
  const activeCandidates = candidates.filter((key) =>
    key === "price" ? state.price !== "all" || hasCustomPriceFilter() : state[key] !== "all",
  );
  if (activeCandidates.length === 0) {
    return { data: initialData, clearedLabels: [] };
  }

  // 快速路径：最下游是价格（预设或自定义）或存在备选分面，尝试直接清空最下游 1 个维度
  const lowestKey = activeCandidates[0];
  if (lowestKey === "price" || hasFacetAlternative(initialData.facets, lowestKey)) {
    const clearedLabels = [
      lowestKey === "price" && hasCustomPriceFilter()
        ? describeClearedFilter("price", "custom")
        : describeClearedFilter(lowestKey, state[lowestKey]),
    ];
    if (lowestKey === "price") {
      state.price = "all";
      state.minPrice = "";
      state.maxPrice = "";
    } else {
      state[lowestKey] = "all";
    }
    clearedLabels.push(...enforceProductContextConstraints());
    const nextData = await fetchProductSnapshot(signal);
    if (seq !== state.requestSeq) return null;
    if (Number(nextData.total || 0) > 0) {
      applyAppliedFilters(nextData);
      return { data: nextData, clearedLabels };
    }
  }

  // 探针路径：暂存当前下游条件并仅保留上游，确认上游条件自身是否真的有结果
  const savedValues = Object.fromEntries(activeCandidates.map((key) => [key, state[key]]));
  const savedCustomMin = state.minPrice;
  const savedCustomMax = state.maxPrice;
  for (const key of activeCandidates) {
    if (key === "price") {
      state.price = "all";
      state.minPrice = "";
      state.maxPrice = "";
    } else {
      state[key] = "all";
    }
  }
  const baseData = await fetchProductSnapshot(signal);
  if (seq !== state.requestSeq) return null;

  if (Number(baseData.total || 0) === 0) {
    for (const [key, value] of Object.entries(savedValues)) {
      state[key] = value;
    }
    state.minPrice = savedCustomMin;
    state.maxPrice = savedCustomMax;
    return { data: initialData, clearedLabels: [] };
  }

  applyAppliedFilters(baseData);
  let bestData = baseData;
  const clearedLabels = [];
  const upstreamToDownstream = [...activeCandidates].reverse();

  for (const key of upstreamToDownstream) {
    if (key === "price") {
      const hadCustom = savedCustomMin !== "" || savedCustomMax !== "";
      const candidateVal = savedValues.price;
      if (hadCustom) {
        state.minPrice = savedCustomMin;
        state.maxPrice = savedCustomMax;
        const tryData = await fetchProductSnapshot(signal);
        if (seq !== state.requestSeq) return null;
        if (Number(tryData.total || 0) > 0) {
          bestData = tryData;
          applyAppliedFilters(tryData);
        } else {
          clearedLabels.push(`价格（${savedCustomMin || "0"} - ${savedCustomMax || "∞"}）`);
          state.minPrice = "";
          state.maxPrice = "";
        }
        continue;
      }
      if (getFacetCount(bestData.facets, "price", candidateVal) <= 0) {
        clearedLabels.push(describeClearedFilter("price", candidateVal));
        continue;
      }
      state.price = candidateVal;
      const tryData = await fetchProductSnapshot(signal);
      if (seq !== state.requestSeq) return null;
      if (Number(tryData.total || 0) > 0) {
        bestData = tryData;
        applyAppliedFilters(tryData);
      } else {
        state.price = "all";
        clearedLabels.push(describeClearedFilter("price", candidateVal));
      }
      continue;
    }

    const candidateVal = savedValues[key];
    const allowsPlan = !NON_PLAN_GROUPS.has(state.group) && state.type !== "sms-service" && state.type !== "api";
    const allowsDuration = !NON_DURATION_GROUPS.has(state.group);
    if ((key === "plan" && !allowsPlan) || (key === "duration" && !allowsDuration)) {
      clearedLabels.push(describeClearedFilter(key, candidateVal));
      continue;
    }
    if (getFacetCount(bestData.facets, key, candidateVal) <= 0) {
      clearedLabels.push(describeClearedFilter(key, candidateVal));
      continue;
    }
    state[key] = candidateVal;
    const tryData = await fetchProductSnapshot(signal);
    if (seq !== state.requestSeq) return null;
    if (Number(tryData.total || 0) > 0) {
      bestData = tryData;
      applyAppliedFilters(tryData);
    } else {
      state[key] = "all";
      clearedLabels.push(describeClearedFilter(key, candidateVal));
    }
  }

  return { data: bestData, clearedLabels };
}

function renderSkeletonList(target, isGrid = false, count = 5) {
  if (!target) return;
  const html = Array.from({ length: count }, () => '<div class="skeleton-card" aria-hidden="true"></div>').join("");
  if (isGrid) {
    target.innerHTML = html;
  } else {
    target.innerHTML = `<div class="skeleton-list">${html}</div>`;
  }
}

async function fetchProducts(append = false, reuseStats = false, options = {}) {
  const cleanScope = options.cleanScope || "none";
  const allowAutoClean = !append && !reuseStats && cleanScope !== "none";
  const carriedClearedLabels = Array.isArray(options.carriedClearedLabels)
    ? [...options.carriedClearedLabels]
    : [];

  const seq = ++state.requestSeq;
  state.productController?.abort();
  state.productController = new AbortController();
  const signal = state.productController.signal;
  state.productLoading = true;
  els.productView.setAttribute("aria-busy", "true");
  els.requestMessage.hidden = true;
  updateResultStatus();
  if (!append) {
    state.page = 1;
    if (state.allItems.length === 0) {
      els.productEmpty.hidden = true;
      renderSkeletonList(els.productList, false, 5);
    }
  }

  const initialFacetScope = currentFacetScopeKey();
  const cachedFacets = state.facetCache.get(initialFacetScope);
  const reuseFacets = (append || reuseStats) && cachedFacets && Date.now() - cachedFacets.at < 30_000;

  if (append) {
    els.loadMoreBtn.disabled = true;
    els.loadMoreBtn.textContent = "加载中...";
  }

  try {
    let data = await fetchProductSnapshot(signal, reuseFacets);
    if (seq !== state.requestSeq) return;

    if (reuseFacets) {
      data.facets = cachedFacets.value;
    }
    applyAppliedFilters(data);

    let reconciledCleared = [];
    if (!data._stale && allowAutoClean && Number(data.total || 0) === 0 && data.facets) {
      const result = await reconcileZeroProductResult(data, cleanScope, signal, seq);
      if (!result || seq !== state.requestSeq) return;
      data = result.data;
      reconciledCleared = result.clearedLabels;
    }

    if (data.facets) {
      const finalFacetScope = currentFacetScopeKey();
      if (state.facetCache.size >= 20) state.facetCache.delete(state.facetCache.keys().next().value);
      state.facetCache.set(finalFacetScope, { at: Date.now(), value: data.facets });
    }

    const isUnfilteredCatalog =
      !state.q.trim() &&
      state.type === "all" &&
      state.plan === "all" &&
      state.duration === "all" &&
      state.price === "all" &&
      !hasCustomPriceFilter();
    if (data.catalogGroups) {
      state.catalogGroupCounts = { ...data.catalogGroups };
      state.catalogBaselineDirty = false;
    } else if (isUnfilteredCatalog && data.facets?.groups) {
      state.catalogGroupCounts = { ...data.facets.groups };
      state.catalogBaselineDirty = false;
    } else if (!data._stale && (!state.catalogGroupCounts || state.catalogBaselineDirty)) {
      ensureCatalogGroupBaseline(state.catalogBaselineDirty);
    }

    const combinedCleared = [...new Set([...carriedClearedLabels, ...reconciledCleared])];
    if (reconciledCleared.length > 0) {
      setFilterNotice(`已自动清除当前条件下不适用的筛选：${combinedCleared.join("、")}`);
    } else if (carriedClearedLabels.length > 0) {
      if (!(options.preserveNotice && state.filterNotice)) {
        setFilterNotice(`已自动清除当前条件下不适用的筛选：${combinedCleared.join("、")}`);
      }
    } else if (!options.preserveNotice) {
      setFilterNotice("");
    }

    state.productsData = data;
    state.page = data.page;
    if (!append) {
      state.fullOffersCache.clear();
      state.expandedGroupKeys.clear();
    }
    els.shopCount.textContent = String(data.shopCount || 0);
    els.tabShopCount.textContent = String(data.shopCount || 0);
    if (append) {
      const existingIds = new Set(state.allItems.map((i) => i.id));
      for (const item of data.items || []) {
        if (!existingIds.has(item.id)) {
          state.allItems.push(item);
        }
      }
    } else {
      state.allItems = [...(data.items || [])];
    }

    syncStateToUrl();
    renderProductHeaderMetrics();
    renderFilterControls();
    renderBrandChips();
    renderOfficialPriceAnchor();
    renderProducts(append);
    if (data._stale) showRequestError("当前展示缓存信息，请到店铺核实价格和库存。", false, true);
  } catch (err) {
    if (err.name === "AbortError" || seq !== state.requestSeq) return;
    if (append) state.page = Math.max(1, state.page - 1);
    else if (state.allItems.length === 0) els.productList.innerHTML = "";
    showRequestError(err.code === "D1_DAILY_LIMIT" ? "今日数据查询暂时受限，可直接进入店铺核实，稍后再试。" : "商品加载失败，请重试。当前结果可能不是最新的。", err.code !== "D1_DAILY_LIMIT");
    console.error("加载商品数据失败:", err);
  } finally {
    if (seq === state.requestSeq) {
      state.productLoading = false;
      els.productView.setAttribute("aria-busy", "false");
      els.loadMoreBtn.disabled = false;
      els.loadMoreBtn.textContent = "显示更多商品";
      updateResultStatus();
    }
  }
}

async function fetchShops(append = false, options = {}) {
  const autoClean = !append && Boolean(options.allowAutoClean);
  const seq = ++state.shopRequestSeq;
  state.shopController?.abort();
  state.shopController = new AbortController();
  state.shopLoading = true;
  els.shopView.setAttribute("aria-busy", "true");
  els.requestMessage.hidden = true;
  updateResultStatus();
  if (!append) {
    state.shopPage = 1;
    if (state.shopsData.length === 0) {
      els.shopEmpty.hidden = true;
      renderSkeletonList(els.shopList, true, 6);
    }
  }

  const requestedSystemType = state.shopSystemType;
  const params = new URLSearchParams();
  params.set("page", String(state.shopPage));
  params.set("pageSize", String(LIST_PAGE_SIZE));
  if (state.shopSystemType !== "all") params.set("systemType", state.shopSystemType);
  if (state.shopSort !== "default") params.set("sort", state.shopSort);
  if (state.shopOnlyInStock) params.set("onlyInStock", "1");
  if (state.shopHasIntegrationCode) params.set("hasIntegrationCode", "1");
  if (state.q.trim()) {
    params.set("q", state.q.trim());
  }

  if (append) {
    els.shopLoadMoreBtn.disabled = true;
    els.shopLoadMoreBtn.textContent = "加载中...";
  }

  try {
    const res = await fetch(`/api/shops?${params.toString()}`, {
      signal: state.shopController.signal,
      cache: "default",
    });
    const data = await readPublicJson(res);
    if (seq !== state.shopRequestSeq) return;

    state.shopSystemLabels = Object.fromEntries(Object.entries(data.systemTypes || {}).map(([key, label]) => [key, formatShopSystemLabel(label)]));
    state.shopSystemFacets = data.facets?.systemTypes || {};
    state.shopSystemType = data.appliedSystemType || "all";
    state.shopSort = SHOP_SORT_OPTIONS.has(data.appliedSort) ? data.appliedSort : "default";
    state.shopOnlyInStock = Boolean(data.appliedOnlyInStock);
    state.shopHasIntegrationCode = Boolean(data.appliedHasIntegrationCode);

    if (requestedSystemType !== "all" && state.shopSystemType === "all") {
      setFilterNotice(`卡网系统参数“${requestedSystemType}”无效，已自动重置为全部系统`);
    } else if (
      autoClean && !data._stale &&
      Number(data.total ?? 0) === 0 &&
      state.shopSystemType !== "all" &&
      Number(state.shopSystemFacets[state.shopSystemType] || 0) === 0 &&
      Object.values(state.shopSystemFacets).some((cnt) => Number(cnt) > 0)
    ) {
      const clearedLabel = describeClearedFilter("shopSystemType", state.shopSystemType);
      state.shopSystemType = "all";
      setFilterNotice(`已自动清除当前条件下无匹配店铺的筛选：${clearedLabel}`);
      syncControlsFromState();
      syncStateToUrl();
      return fetchShops(false, { allowAutoClean: false, preserveNotice: true });
    } else if (!options.preserveNotice) {
      setFilterNotice("");
    }

    renderShopSystemControls();
    syncControlsFromState();
    syncStateToUrl();
    state.shopPage = data.page || 1;
    const incoming = data.shops || [];
    if (append) {
      const existing = new Set(state.shopsData.map((s) => s.id));
      for (const s of incoming) {
        if (!existing.has(s.id)) {
          state.shopsData.push(s);
        }
      }
    } else {
      state.shopsData = [...incoming];
    }

    state.shopTotal = Number(data.total ?? state.shopsData.length);
    state.shopTotalAll = Number(data.totalAll ?? state.shopTotal);
    state.shopTotalPages = Number(data.totalPages ?? 1);

    els.shopCount.textContent = String(state.shopTotalAll);
    els.tabShopCount.textContent = String(state.shopTotalAll);
    renderShops(append);
    if (data._stale) showRequestError("当前展示缓存信息，请到店铺核实价格和库存。", false, true);
  } catch (err) {
    if (err.name === "AbortError" || seq !== state.shopRequestSeq) return;
    if (append) state.shopPage = Math.max(1, state.shopPage - 1);
    else if (state.shopsData.length === 0) els.shopList.innerHTML = "";
    showRequestError(err.code === "D1_DAILY_LIMIT" ? "今日数据查询暂时受限，可直接进入店铺核实，稍后再试。" : "店铺加载失败，请重试。当前结果可能不是最新的。", err.code !== "D1_DAILY_LIMIT");
    console.error("加载店铺列表失败:", err);
  } finally {
    if (seq === state.shopRequestSeq) {
      state.shopLoading = false;
      els.shopView.setAttribute("aria-busy", "false");
      els.shopLoadMoreBtn.disabled = false;
      els.shopLoadMoreBtn.textContent = "显示更多店铺";
      updateResultStatus();
    }
  }
}

async function fetchFullOffersForGroup(groupKey) {
  if (state.loadingOfferKeys.has(groupKey)) return;
  state.loadingOfferKeys.add(groupKey);
  renderProductGroup(groupKey);

  try {
    const res = await fetch(`/api/products?offerKey=${encodeURIComponent(groupKey)}`);
    const data = await readPublicJson(res);
    if (data._stale) showRequestError("当前展示缓存信息，请到店铺核实价格和库存。", false, true);
    const matched = (data.items || [])[0];
    if (matched && Array.isArray(matched.offers)) {
      if (state.fullOffersCache.size >= 50) state.fullOffersCache.delete(state.fullOffersCache.keys().next().value);
      state.fullOffersCache.set(groupKey, matched.offers);
    }
  } catch (err) {
    showRequestError("完整报价加载失败，可点击展开按钮重试。");
    console.error("展开完整报价失败:", err);
  } finally {
    state.loadingOfferKeys.delete(groupKey);
    renderProductGroup(groupKey);
  }
}

function renderProductHeaderMetrics() {
  const data = state.productsData;
  if (!data) return;
  els.groupCount.textContent = String(data.total || 0);
  els.offerCount.textContent = String(data.offerTotal || 0);
  els.tabProductCount.textContent = String(data.total || 0);
}

function regionLabel(type = "") {
  return type === "sms-service" ? "号码地区" : type ? "账号地区" : "账号 / 号码地区";
}

/**
 * 渲染商品维度下拉框（统一隐藏计数为 0 的选项，仅保留全部与当前选中项，且不含“未标注”）
 */
function createDimensionSelectHtml(dim, facetCounts) {
  const current = state[dim.key] || "all";
  const choices = dim.options.filter((opt) => Number(facetCounts[opt.value] || 0) > 0 || current === opt.value);
  const options = [
    `<option value="all"${current === "all" ? " selected" : ""}>全部</option>`,
    ...choices.map((opt) => {
      const count = Number(facetCounts[opt.value] || 0);
      return `<option value="${escapeHtml(opt.value)}"${current === opt.value ? " selected" : ""}>${escapeHtml(opt.label)} (${count})</option>`;
    }),
  ];
  const cls = current !== "all" ? ' class="is-selected"' : "";
  return `<label class="filter-field"><span>${escapeHtml(dim.shortLabel)}</span><select data-filter-key="${dim.key}"${cls} aria-label="${escapeHtml(dim.shortLabel)}筛选">${options.join("")}</select></label>`;
}

/**
 * 渲染价格区间下拉框（统一隐藏计数为 0 的选项，仅保留全部价格与当前选中项）
 */
function createPriceSelectHtml() {
  const prices = state.productsData?.facets?.prices || {};
  const visiblePrices = PRICE_OPTIONS.filter(
    (opt) => Number(prices[opt.value] || 0) > 0 || state.price === opt.value,
  );
  if (visiblePrices.length === 0 && state.price === "all") {
    return "";
  }
  const options = [
    `<option value="all"${state.price === "all" ? " selected" : ""}>全部价格</option>`,
    ...visiblePrices.map((opt) => {
      const count = Number(prices[opt.value] || 0);
      return `<option value="${opt.value}"${state.price === opt.value ? " selected" : ""}>${opt.label} (${count})</option>`;
    }),
  ];
  const cls = state.price !== "all" ? ' class="is-selected"' : "";
  return `<label class="filter-field"><span>预设价格</span><select data-filter-key="price"${cls} aria-label="价格筛选" title="区间含下限、不含上限；500元及以上无上限">${options.join("")}</select></label>`;
}

function renderFilterControls() {
  if (state.mode !== "product") return;
  const options = state.productsData?.facets?.options || {};
  const allowsPlan = !NON_PLAN_GROUPS.has(state.group) && state.type !== "sms-service" && state.type !== "api";
  const allowsDuration = !NON_DURATION_GROUPS.has(state.group);
  const primary = [];
  const more = [];

  for (const dim of FILTER_DIMENSIONS) {
    if (dim.key === "plan" && !allowsPlan) continue;
    if (dim.key === "duration" && !allowsDuration) continue;
    const counts = options[dim.key] || {};
    const hasValues = dim.options.some((opt) => Number(counts[opt.value] || 0) > 0);
    if (!hasValues && state[dim.key] === "all") continue;
    const html = createDimensionSelectHtml(dim, counts);
    (dim.key === "type" || dim.key === "plan" ? primary : more).push(html);
  }

  const priceHtml = createPriceSelectHtml();
  if (priceHtml) primary.push(priceHtml);

  // 无更多筛选子项时同步复位 moreFiltersOpen，避免切换品牌时面板突然滞后弹出
  if (more.length === 0) {
    state.moreFiltersOpen = false;
  }

  els.primaryFilters.innerHTML = primary.join("");
  els.moreFiltersPanel.innerHTML = more.join("");
  els.moreFiltersPanel.hidden = !state.moreFiltersOpen || more.length === 0;
  els.toggleMoreFiltersBtn.hidden = more.length === 0;
  els.toggleMoreFiltersBtn.textContent = state.moreFiltersOpen ? "收起时长" : "时长筛选";
  els.toggleMoreFiltersBtn.classList.toggle("is-active", state.moreFiltersOpen || state.duration !== "all");
  els.toggleMoreFiltersBtn.setAttribute("aria-expanded", String(state.moreFiltersOpen && more.length > 0));
  els.facetNoteBar.hidden = false;
  els.facetNoteBar.textContent =
    "计数：保留其他条件、替换本项后的商品组数；切换品牌或类型会自动清除不兼容筛选。预设价格区间含下限、不含上限。";
  syncControlsFromState();
}

function updateResultStatus() {
  const product = state.mode === "product";
  const loading = product ? state.productLoading : state.shopLoading;
  els.resultStatus.textContent = loading
    ? "正在查找，请稍候…"
    : product
      ? `找到 ${state.productsData?.total ?? 0} 组商品 · 已展示 ${state.allItems.length} 组`
      : `找到 ${state.shopTotal} 家店铺 · 已展示 ${state.shopsData.length} 家`;
}

function showRequestError(message, retryable = true, informational = false) {
  els.requestMessage.hidden = false;
  els.requestMessage.classList.toggle("is-notice", informational);
  els.requestMessage.setAttribute("role", informational ? "status" : "alert");
  document.querySelector("#retryBtn").hidden = !retryable;
  els.requestMessage.querySelector("span").textContent = message;
}

function renderActiveFilters() {
  const tags = [];
  if (state.q.trim()) {
    tags.push(["q", `搜索：${state.q.trim()}`]);
  }
  if (state.mode === "shop") {
    if (state.shopSystemType !== "all") {
      tags.push(["shopSystemType", `系统：${state.shopSystemLabels[state.shopSystemType] || state.shopSystemType}`]);
    }
    if (state.shopSort !== "default") {
      tags.push(["shopSort", `排序：${SHOP_SORT_LABELS[state.shopSort] || state.shopSort}`]);
    }
    if (state.shopOnlyInStock) {
      tags.push(["shopOnlyInStock", "仅看有在售商品"]);
    }
    if (state.shopHasIntegrationCode) {
      tags.push(["shopHasIntegrationCode", "仅看有对接码"]);
    }
  } else {
    if (state.group !== "all") {
      tags.push(["group", formatGroupLabel(state.group)]);
    }
    for (const dim of FILTER_DIMENSIONS) {
      if (state[dim.key] !== "all") {
        tags.push([dim.key, filterValueLabel(dim.key, state[dim.key])]);
      }
    }
    if (hasCustomPriceFilter()) {
      tags.push(["customPrice", `自定义价：${formatCustomPriceSummary()}`]);
    } else if (state.price !== "all") {
      tags.push(["price", filterValueLabel("price", state.price)]);
    }
  }
  els.activeFilters.innerHTML = tags
    .map(
      ([key, label]) =>
        `<button class="active-filter" type="button" data-remove-filter="${escapeHtml(key)}" aria-label="移除${escapeHtml(label)}">${escapeHtml(label)} <span aria-hidden="true">×</span></button>`,
    )
    .join("");
}

/**
 * 渲染品牌分组芯片：始终保留全部活跃目录品牌，不因当前窄筛选过滤导致按钮“蒸发”或被禁用锁死
 */
function renderBrandChips() {
  const facets = state.productsData?.facets?.groups || {};
  const baseline = state.catalogGroupCounts;
  const totalAll = Object.values(facets).reduce((sum, n) => sum + Number(n || 0), 0);
  const sections = [
    ["AI 对话与编程", BRAND_GROUP_ORDER.slice(0, 11)],
    ["AI 视频与创作", BRAND_GROUP_ORDER.slice(11, 15)],
    ["数字账号与基建", BRAND_GROUP_ORDER.slice(15)],
  ];
  const hasNonQueryFilters =
    state.type !== "all" ||
    state.plan !== "all" ||
    state.duration !== "all" ||
    state.price !== "all" ||
    hasCustomPriceFilter();
  const chip = (g, label, count) => {
    const isZeroFiltered = g !== "all" && count === 0 && state.group !== g;
    const titleAttr = isZeroFiltered
      ? hasNonQueryFilters
        ? ' title="当前筛选条件下暂无匹配，点击将切换品牌并自动清除冲突条件"'
        : ' title="当前搜索词下该品牌暂无匹配，点击将切换至此品牌"'
      : "";
    return `<button type="button" class="chip ${state.group === g ? "is-active" : ""}${isZeroFiltered ? " is-filtered-zero" : ""}" style="${getGroupBrandStyle(g)}" data-group="${escapeHtml(g)}" aria-pressed="${state.group === g}"${titleAttr}><span class="chip-icon" aria-hidden="true">${getGroupIconHtml(g)}</span><span class="chip-label">${escapeHtml(label)}</span><small>${count}</small></button>`;
  };

  els.brandChips.innerHTML =
    `<div class="brand-section">${chip("all", "全部品类", totalAll)}</div>` +
    sections
      .map(([label, groups]) => {
        const visibleGroups = groups.filter((g) => {
          if (state.group === g) return true;
          if (Number(facets[g] || 0) > 0) return true;
          if (baseline) return Number(baseline[g] || 0) > 0;
          return true;
        });
        if (visibleGroups.length === 0) return "";
        return `<div class="brand-section"><span class="brand-section-label">${label}</span>${visibleGroups
          .map((g) => chip(g, formatGroupLabel(g), Number(facets[g] || 0)))
          .join("")}</div>`;
      })
      .join("");
}

/**
 * 独立构建商品卡片属性徽章（与 FILTER_DIMENSIONS 解耦，保留地区、接码状态与原始售后文本）
 */
function buildAttributeBadges(item) {
  const attrs = item.attributes || {};
  const tags = [];

  if (attrs.type && CARD_BADGE_LABELS.type[attrs.type]) {
    tags.push(`<span class="badge">${escapeHtml(CARD_BADGE_LABELS.type[attrs.type])}</span>`);
  }
  if (attrs.plan && CARD_BADGE_LABELS.plan[attrs.plan]) {
    tags.push(`<span class="badge">${escapeHtml(CARD_BADGE_LABELS.plan[attrs.plan])}</span>`);
  }
  if (attrs.duration && CARD_BADGE_LABELS.duration[attrs.duration]) {
    tags.push(`<span class="badge">${escapeHtml(CARD_BADGE_LABELS.duration[attrs.duration])}</span>`);
  }
  if (attrs.sms && CARD_BADGE_LABELS.sms[attrs.sms]) {
    tags.push(`<span class="badge">${escapeHtml(CARD_BADGE_LABELS.sms[attrs.sms])}</span>`);
  }
  if (attrs.region && CARD_BADGE_LABELS.region[attrs.region]) {
    tags.push(`<span class="badge">${escapeHtml(regionLabel(attrs.type))}：${escapeHtml(CARD_BADGE_LABELS.region[attrs.region])}</span>`);
  }
  if (item.warrantyText) {
    tags.push(`<span class="badge badge-warranty" title="标题原始售后条款">原文：${escapeHtml(item.warrantyText)}</span>`);
  }
  return tags.join("");
}

function renderOfferPanel(item) {
  const offers = state.fullOffersCache.get(item.id) || item.offers || [];
  const isLoadedFull = state.fullOffersCache.has(item.id);
  const isLoading = state.loadingOfferKeys.has(item.id);
  const remaining = Math.max(0, Number(item.offerCount || 0) - offers.length);

  const rowsHtml = offers
    .map((offer, idx) => {
      const link = safeUrl(offer.itemUrl);
      const shopLink = safeUrl(offer.shopUrl);
      const isBest = idx === 0 && offers.length > 1;
      const shopNameHtml = offer.shopId
        ? `<button type="button" class="offer-shop-btn" data-open-shop="${escapeHtml(offer.shopId)}" title="点击查看店铺信息与风险提示">
             <span>${escapeHtml(offer.shopName)}</span>
             <span class="offer-shop-intro-pill">店铺信息</span>
           </button>`
        : `<strong>${escapeHtml(offer.shopName)}</strong>`;

      return `
        <div class="offer-row">
          <div class="offer-shop-cell">
            ${shopNameHtml}
            ${isBest ? `<span class="offer-tag is-best">★ 当前最低</span>` : ""}
            <span class="offer-hint">${escapeHtml(formatStockText(offer.stockCount, offer.stockStatus))}</span>
          </div>
          <div class="offer-price-cell">${formatPrice(offer.price)}</div>
          <div class="offer-action-cell">
            ${
              link
                ? `<a class="offer-action-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">前往购买 →</a>`
                : `<span class="offer-hint">暂无商品直链</span>`
            }
            ${
              shopLink
                ? `<a class="offer-action-link offer-shop-link" href="${escapeHtml(shopLink)}" target="_blank" rel="noopener noreferrer" title="进入店铺核实库存及商品状态">进入店铺 ↗</a>`
                : `<span class="offer-hint">暂无店铺链接</span>`
            }
          </div>
        </div>
      `;
    })
    .join("");

  const expandHtml =
    !isLoadedFull && item.offersTruncated && remaining > 0
      ? `<div class="offer-expand-wrap">
           <button type="button" class="btn btn-secondary btn-compact" data-load-offers="${escapeHtml(item.id)}"${isLoading ? " disabled" : ""}>
             ${isLoading ? "正在加载完整报价..." : `展开剩余报价 (${remaining})`}
           </button>
         </div>`
      : "";

  return `<div class="offer-panel">${rowsHtml}${expandHtml}</div>`;
}

function renderProductRow(item) {
  const expanded = state.expandedGroupKeys.has(item.id);
  const isFaved = isProductFavorited(item.id);
  const isCompared = isProductCompared(item.id);
  const rangeNote =
    item.minPrice !== item.maxPrice
      ? `<small>均 ${formatPrice(item.medianPrice)} ~ ${formatPrice(item.maxPrice)}</small>`
      : "";
  const spreadDiff = Number(item.maxPrice) - Number(item.minPrice);
  const savePill =
    item.offerCount > 1 && Number.isFinite(spreadDiff) && spreadDiff >= 1
      ? `<span class="price-save-pill">立省 ¥${spreadDiff.toFixed(0)}</span>`
      : "";
  const multiShopBadge =
    item.shopCount > 1
      ? `<span class="badge badge-brand">${item.shopCount} 家同款比价</span>`
      : `<span class="badge">${escapeHtml(item.shopName)}</span>`;
  const itemLink = safeUrl(item.itemUrl);
  const titleHtml = itemLink
    ? `<a class="product-title" href="${escapeHtml(itemLink)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.name)}</a>`
    : `<span class="product-title">${escapeHtml(item.name)}</span>`;
  const brandStyle = getGroupBrandStyle(item.group);

  return `
    <article class="product-row" style="${brandStyle}" data-product-key="${escapeHtml(item.id)}">
      <div class="product-summary">
        <div class="product-main-cell">
          <div>
            <div class="product-badges">
              <span class="badge badge-group-brand" style="${brandStyle}">
                ${getGroupIconHtml(item.group)}
                <span>${escapeHtml(formatGroupLabel(item.group))}</span>
              </span>
              ${multiShopBadge}
              ${buildAttributeBadges(item)}
            </div>
            ${titleHtml}
          </div>
          <div class="product-meta-actions">
            <button type="button" class="group-toggle" aria-expanded="${expanded}" data-toggle-key="${escapeHtml(item.id)}">
              ${
                item.offerCount > 1
                  ? `${expanded ? "▾ 收起报价" : "▸ 展开比价"}（${item.offerCount} 个报价 · ${item.shopCount} 家店铺）`
                  : `${expanded ? "▾ 收起明细" : "▸ 查看店铺与库存"}`
              }
            </button>
            <div class="row-mini-actions">
              <button type="button" class="mini-icon-btn${isFaved ? " is-active" : ""}" data-fav-product="${escapeHtml(item.id)}" aria-pressed="${isFaved}">
                ${isFaved ? "★ 已收藏" : "☆ 收藏"}
              </button>
              <button type="button" class="mini-icon-btn${isCompared ? " is-active" : ""}" data-compare-product="${escapeHtml(item.id)}" aria-pressed="${isCompared}">
                ${isCompared ? "✓ 已加对比" : "⚖ 对比"}
              </button>
            </div>
          </div>
        </div>
        <div class="price-ticket">
          <div class="price-col">
            ${formatPrice(item.minPrice)}
            ${rangeNote}
            ${savePill}
          </div>
          <div class="lead-shop-col">
            ${item.shopName ? `<span class="offer-hint" title="最低报价店铺">领衔：${escapeHtml(item.shopName)}</span>` : ""}
          </div>
        </div>
      </div>
      ${expanded ? renderOfferPanel(item) : ""}
    </article>
  `;
}

/** 只更新被展开/操作的商品，保留其余列表节点与滚动位置。 */
function renderProductGroup(key) {
  const item = state.allItems.find((entry) => entry.id === key);
  const row = els.productList.querySelector(`[data-product-key="${CSS.escape(key)}"]`);
  if (!item || !row) return;
  const focusedAttr = document.activeElement?.closest("[data-toggle-key],[data-fav-product],[data-compare-product]");
  const refocusSelector = focusedAttr?.hasAttribute("data-toggle-key")
    ? `[data-toggle-key="${CSS.escape(key)}"]`
    : focusedAttr?.hasAttribute("data-fav-product")
      ? `[data-fav-product="${CSS.escape(key)}"]`
      : focusedAttr?.hasAttribute("data-compare-product")
        ? `[data-compare-product="${CSS.escape(key)}"]`
        : "";
  row.outerHTML = renderProductRow(item);
  if (refocusSelector) els.productList.querySelector(refocusSelector)?.focus({ preventScroll: true });
}

/**
 * 渲染主流 AI 品牌的官网公开月费对照提示（辅助识别异常低价与共享拼车）
 */
function renderOfficialPriceAnchor() {
  if (!els.officialPriceAnchor) return;
  const entry = OFFICIAL_REFERENCE_PRICES[state.group];
  if (
    state.mode !== "product" ||
    !entry ||
    state.type === "sms-service" ||
    state.type === "api"
  ) {
    els.officialPriceAnchor.hidden = true;
    els.officialPriceAnchor.innerHTML = "";
    return;
  }

  const planHint = state.plan !== "all" ? entry.plans?.[state.plan] : "";
  const summary = planHint || entry.defaultSummary;
  els.officialPriceAnchor.innerHTML = `
    <span class="ref-price-label">${escapeHtml(entry.headline)}</span>
    <span class="ref-price-value">${escapeHtml(summary)}</span>
    <span class="ref-price-note">按站内参考汇率 1 USD ≈ ¥7.15 粗算；远低于官方直购价多为拼车共享、短期体验或促销渠道，请按需甄别</span>
  `;
  els.officialPriceAnchor.hidden = false;
}

function renderProducts(append = false) {
  const items = state.allItems;
  const total = Number(state.productsData?.total ?? 0);
  const totalPages = Number(state.productsData?.totalPages ?? 1);

  if (items.length === 0) {
    els.productList.innerHTML = "";
    els.productEmpty.hidden = false;
    els.loadMoreWrap.hidden = true;
    return;
  }

  els.productEmpty.hidden = true;
  if (append) {
    const rendered = new Set(Array.from(els.productList.children, (row) => row.dataset.productKey));
    els.productList.insertAdjacentHTML("beforeend", items.filter((item) => !rendered.has(item.id)).map(renderProductRow).join(""));
  } else {
    els.productList.innerHTML = items.map(renderProductRow).join("");
  }

  if (state.page < totalPages && items.length < total) {
    els.loadMoreWrap.hidden = false;
    els.loadMoreBtn.textContent = `显示更多商品（已展示 ${items.length} / ${total} 组）`;
  } else {
    els.loadMoreWrap.hidden = true;
  }
}

/** 访客仅展示商品记录，不展示后台采集状态。 */
function buildShopStatusBadge(shop) {
  if (Number(shop.productCount || 0) > 0) {
    return `<span class="badge badge-success">商品 ${Number(shop.productCount)} 件</span>`;
  }
  return '<span class="badge">暂无商品记录</span>';
}

function hasValidCount(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function formatShopSellSummary(shop) {
  if (hasValidCount(shop.shopSellCount)) {
    return `参考总销量 ${Number(shop.shopSellCount)}`;
  }
  return "源站未公开总销量";
}

function formatSalesTrendText(shop) {
  const trend = shop.salesTrend;
  if (trend) {
    if (trend.status === "init") {
      return `${trend.currentCount}（首日观测，待连续对比）`;
    }
    if (trend.status === "growing") {
      return `${trend.firstCount} → ${trend.currentCount}（+${trend.change}）`;
    }
    if (trend.status === "flat") {
      return `${trend.firstCount} → ${trend.currentCount}（0）`;
    }
    return `${trend.firstCount} → ${trend.currentCount}（${trend.change}）`;
  }
  if (hasValidCount(shop.shopSellCount)) {
    return `参考总销量 ${Number(shop.shopSellCount)}（暂无连续趋势）`;
  }
  return "源站未公开销量";
}

/** 渲染店铺系统下拉（统一隐藏计数为 0 的系统项，保留全部系统与当前选中项） */
function renderShopSystemControls() {
  const selected = state.shopSystemType;
  const options = ['<option value="all">全部系统</option>'];
  const entries = Object.entries(state.shopSystemLabels);
  if (entries.length === 0 && selected !== "all") {
    options.push(`<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)}</option>`);
  }
  for (const [key, label] of entries) {
    const count = Number(state.shopSystemFacets[key] || 0);
    if (count <= 0 && key !== selected) continue;
    options.push(`<option value="${escapeHtml(key)}"${key === selected ? " selected" : ""}>${escapeHtml(label)} (${count})</option>`);
  }
  els.shopSystemSelect.innerHTML = options.join("");
  els.shopSystemSelect.value = selected;
  els.shopSystemSelect.classList.toggle("is-selected", selected !== "all");
  if (els.shopSortSelect) {
    els.shopSortSelect.classList.toggle("is-selected", state.shopSort !== "default");
  }
}

function renderMainCategoryBadges(mainCategories, productCount, maxCount = 5) {
  if (!Array.isArray(mainCategories) || mainCategories.length === 0) {
    return Number(productCount || 0) > 0
      ? "<span class='badge'>暂无主营类别统计</span>"
      : "<span class='badge'>暂无在售商品</span>";
  }
  const visible = maxCount > 0 ? mainCategories.slice(0, maxCount) : mainCategories;
  const badges = visible.map(
    (cat) =>
      `<span class="badge badge-category" style="${getGroupBrandStyle(cat.group)}">${getGroupIconHtml(cat.group)}<span>${escapeHtml(cat.label || formatGroupLabel(cat.group))} (${Number(cat.count || 0)})</span></span>`,
  );
  if (maxCount > 0 && mainCategories.length > maxCount) {
    badges.push(`<span class="badge">+${mainCategories.length - maxCount} 类</span>`);
  }
  return badges.join("");
}

/** 加载更多时只追加新店铺，保留已展示卡片及其焦点。 */
function renderShops(append = false) {
  const shops = state.shopsData;
  const total = Number(state.shopTotal ?? shops.length);
  const totalPages = Number(state.shopTotalPages ?? 1);

  if (shops.length === 0) {
    els.shopList.innerHTML = "";
    els.shopEmpty.hidden = false;
    els.shopLoadMoreWrap.hidden = true;
    return;
  }

  els.shopEmpty.hidden = true;
  const renderedIds = append
    ? new Set(Array.from(els.shopList.children, (card) => card.dataset.shopKey))
    : new Set();
  const cardsHtml = shops
    .filter((shop) => !renderedIds.has(shop.id))
    .map((s) => {
      const shopLink = safeUrl(s.canonicalUrl) || safeUrl(s.shopUrl);
      const displayUrl = shopLink || s.canonicalUrl || s.shopUrl || "未记录网址";
      const depositMoney = Number(s.ldxpProfile?.depositMoney || 0);
      const depositText = depositMoney > 0 ? ` · 保证金 ¥${escapeHtml(depositMoney)}` : "";
      const categoryBadges = renderMainCategoryBadges(s.mainCategories, s.productCount, 5);
      const isFaved = isShopFavorited(s.id);
      const avatarGrad = shopAvatarGradient(s.shopName);

      return `
        <article class="shop-card" data-shop-key="${escapeHtml(s.id)}" style="--shop-accent:${avatarGrad}">
          <div class="shop-card-top">
            <div class="shop-identity">
              <span class="shop-avatar" style="background:${avatarGrad}" aria-hidden="true">${escapeHtml(shopInitialChar(s.shopName))}</span>
              <div class="shop-title-wrap">
                <h3>${escapeHtml(hideSavedTelegram(s.shopName))}</h3>
                ${renderIntegrationCodes(s.integrationCodes)}
                <div class="shop-badges">
                  <span class="badge badge-system" title="卡网系统类型">${escapeHtml(formatShopSystemLabel(s.systemTypeLabel))}</span>
                  <span class="badge">${escapeHtml(formatAdapterBadge(s.adapterType))}</span>
                  ${buildShopStatusBadge(s)}
                </div>
              </div>
            </div>
            <div class="shop-quick-actions">
              ${shopLink ? `<a class="mini-icon-btn shop-visit-link" href="${escapeHtml(shopLink)}" target="_blank" rel="noopener noreferrer" aria-label="进入店铺：${escapeHtml(hideSavedTelegram(s.shopName))}" title="进入店铺（新标签打开）">↗</a>` : ""}
              <button type="button" class="mini-icon-btn${isFaved ? " is-active" : ""}" data-fav-shop="${escapeHtml(s.id)}" aria-pressed="${isFaved}" title="收藏店铺">
                ${isFaved ? "★" : "☆"}
              </button>
            </div>
          </div>
          <div class="shop-meta">
            <div class="shop-meta-line">
              <span class="shop-url-text" title="${escapeHtml(displayUrl)}">${escapeHtml(displayUrl)}</span>
              ${
                displayUrl !== "未记录网址"
                  ? `<button type="button" class="copy-inline-btn" data-copy-text="${escapeHtml(displayUrl)}" data-copy-label="店铺网址">复制</button>`
                  : ""
              }
            </div>
            <span>${escapeHtml(formatShopSellSummary(s))}${depositText}</span>
          </div>
          <div class="shop-preview-list" aria-label="主营类别">${categoryBadges}</div>
          <div class="shop-card-actions">
            <button type="button" class="btn btn-secondary" data-open-shop="${escapeHtml(s.id)}">查看店铺信息 →</button>
          </div>
        </article>
      `;
    })
    .join("");

  if (append) {
    els.shopList.insertAdjacentHTML("beforeend", cardsHtml);
  } else {
    els.shopList.innerHTML = cardsHtml;
  }

  if (state.shopPage < totalPages && shops.length < total) {
    els.shopLoadMoreWrap.hidden = false;
    els.shopLoadMoreBtn.textContent = `显示更多店铺（已展示 ${shops.length} / ${total} 家）`;
  } else {
    els.shopLoadMoreWrap.hidden = true;
  }
}


async function openShopProfile(shopId) {
  state.profileController?.abort();
  const controller = new AbortController();
  state.profileController = controller;
  state.profileTrigger = document.activeElement;
  els.profileBody.innerHTML = '<h2 id="profileModalTitle">正在加载店铺信息…</h2>';
  els.profileModal.hidden = false;
  document.body.style.overflow = "hidden";
  els.profileModal.querySelector(".modal-close").focus();

  try {
    const res = await fetch(`/api/shops/${encodeURIComponent(shopId)}`, { signal: controller.signal });
    const data = await readPublicJson(res);
    if (controller.signal.aborted || state.profileController !== controller) return;
    const s = data.shop;
    if (!s) {
      els.profileBody.innerHTML = '<h2 id="profileModalTitle">未找到该店铺信息</h2><p>请关闭后重试。</p>';
      return;
    }

    const sig = s.shopSignals || {};
    const shopLink = safeUrl(s.canonicalUrl || s.shopUrl);
    const displayUrl = shopLink || s.canonicalUrl || s.shopUrl || "未记录网址";
    const hasCategories = Array.isArray(s.mainCategories) && s.mainCategories.length > 0;
    const depositMoney = Number(s.ldxpProfile?.depositMoney || 0);

    const observeText =
      Number(sig.observedDays || 0) > 0
        ? `已采样 ${sig.observedDays} 天（有货 ${sig.activeDayStreak || 0} 天 · 全店无货 ${sig.outOfStockDays || 0} 天）`
        : "暂无每日观察记录";

    const visitControlHtml = shopLink
      ? `<a class="btn btn-primary profile-visit-btn" href="${escapeHtml(shopLink)}" target="_blank" rel="noopener noreferrer">前往店铺 <span aria-hidden="true">↗</span></a>`
      : `<button type="button" class="btn btn-primary profile-visit-btn" disabled>前往店铺（暂无有效链接）</button>`;

    const copyUrlBtnHtml =
      displayUrl !== "未记录网址"
        ? `<button type="button" class="btn btn-compact" data-copy-text="${escapeHtml(displayUrl)}" data-copy-label="店铺网址">复制网址</button>`
        : "";

    els.profileBody.innerHTML = `
      <div class="profile-header">
        <div class="profile-header-top">
          <span class="shop-avatar" style="background:${shopAvatarGradient(s.shopName)}" aria-hidden="true">${escapeHtml(shopInitialChar(s.shopName))}</span>
          <div>
            <h2 id="profileModalTitle">${escapeHtml(hideSavedTelegram(s.shopName))}</h2>
            ${renderIntegrationCodes(s.integrationCodes)}
            <p class="profile-url-line">源站地址：${escapeHtml(displayUrl)}</p>
          </div>
        </div>
        <div class="profile-meta-badges">
          <span class="badge badge-system">${escapeHtml(formatShopSystemLabel(s.systemTypeLabel))}</span>
          <span class="badge">${escapeHtml(formatAdapterBadge(s.adapterType))}</span>
          ${buildShopStatusBadge(s)}
        </div>
      </div>

      ${data._stale ? '<div class="profile-alert-banner is-warn" role="status">当前展示缓存信息，请到店铺核实价格和库存。</div>' : ""}

      <section class="profile-section" aria-label="主营类别">
        <h3 class="profile-section-title">主营类别</h3>
        ${
          hasCategories
            ? `<div class="profile-categories-list">${renderMainCategoryBadges(s.mainCategories, s.productCount, 0)}</div>`
            : `<p class="profile-empty-note" style="margin:0;font-size:13px;">${
                Number(s.productCount || 0) > 0 ? "暂无主营类别统计" : "暂无在售商品，暂无法统计主营类别"
              }</p>`
        }
      </section>

      <div class="signal-grid">
        <div class="signal-box">
          <span>店铺系统</span>
          <strong>${escapeHtml(formatShopSystemLabel(s.systemTypeLabel))}</strong>
        </div>
        <div class="signal-box">
          <span>在售商品</span>
          <strong>${Number(s.productCount || 0)} 件</strong>
        </div>
        <div class="signal-box">
          <span>收录时间</span>
          <strong>${escapeHtml(s.createdAt ? formatFullDateTime(s.createdAt, "未记录（早期收录）") : "未记录（早期收录）")}</strong>
        </div>
        <div class="signal-box">
          <span>总销量观察趋势</span>
          <strong>${escapeHtml(formatSalesTrendText(s))}</strong>
        </div>
        <div class="signal-box">
          <span>每日观察（30天窗口）</span>
          <strong>${escapeHtml(observeText)}</strong>
        </div>
        ${
          depositMoney > 0
            ? `<div class="signal-box">
                <span>源站保证金</span>
                <strong>¥${escapeHtml(depositMoney)}</strong>
              </div>`
            : ""
        }
      </div>

      <div class="profile-action-box">
        <p class="profile-risk-notice" role="note">${escapeHtml(SHOP_RISK_NOTICE_TEXT)}</p>
        <div class="profile-visit-row">
          ${visitControlHtml}
          ${copyUrlBtnHtml}
          <span class="profile-visit-hint">实际选购与下单将在第三方店铺页面完成</span>
        </div>
      </div>
    `;
  } catch (error) {
    if (error.name !== "AbortError") {
      els.profileBody.innerHTML = error.code === "D1_DAILY_LIMIT"
        ? '<h2 id="profileModalTitle">店铺信息暂不可用</h2><p>今日数据查询暂时受限，可通过店铺卡片右上角直接进店核实。</p>'
        : '<h2 id="profileModalTitle">加载店铺信息失败</h2><p>请关闭后重试。</p>';
    }
  }
}

function closeShopProfile() {
  state.profileController?.abort();
  els.profileModal.hidden = true;
  if (els.workbenchModal.hidden) {
    document.body.style.overflow = "";
  }
  state.profileTrigger?.focus({ preventScroll: true });
}

/* ==================== 我的收藏与同台比价工作台弹窗 ==================== */
function openWorkbenchModal(defaultTab = "compare") {
  state.workbenchTab = defaultTab === "favorites" ? "favorites" : "compare";
  state.workbenchTrigger = document.activeElement;
  els.workbenchModal.hidden = false;
  document.body.style.overflow = "hidden";
  renderWorkbenchBody();
  els.workbenchModal.querySelector(".modal-close").focus();
}

function closeWorkbenchModal() {
  els.workbenchModal.hidden = true;
  if (els.profileModal.hidden) {
    document.body.style.overflow = "";
  }
  state.workbenchTrigger?.focus({ preventScroll: true });
}

function renderWorkbenchBody() {
  els.workbenchModal.querySelectorAll("[data-wb-tab]").forEach((btn) => {
    const active = btn.dataset.wbTab === state.workbenchTab;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });

  if (state.workbenchTab === "compare") {
    const list = state.compareItems;
    if (list.length === 0) {
      els.workbenchBody.innerHTML =
        '<p class="empty-tip">暂无待对比商品。在商品列表点击「⚖ 对比」，即可最多加入 4 款商品进行横向比价。</p>';
      return;
    }

    const validPrices = list.map((i) => Number(i.minPrice)).filter((p) => Number.isFinite(p));
    const bestMin = validPrices.length > 0 ? Math.min(...validPrices) : null;

    const headCells = list
      .map(
        (item) =>
          `<td class="compare-col-head">
             <div>${escapeHtml(item.name)}</div>
             <button type="button" class="mini-icon-btn" style="margin-top:6px" data-wb-remove-compare="${escapeHtml(item.id)}">移出对比</button>
           </td>`,
      )
      .join("");

    const makeRow = (label, fn) =>
      `<tr><th>${label}</th>${list.map((item) => `<td>${fn(item)}</td>`).join("")}</tr>`;

    els.workbenchBody.innerHTML = `
      <div class="compare-table-wrap">
        <table class="compare-table">
          <thead>
            <tr><th>对比维度</th>${headCells}</tr>
          </thead>
          <tbody>
            ${makeRow("最低报价", (item) => {
              const isBest = bestMin !== null && Number(item.minPrice) === bestMin;
              return `<span class="${isBest ? "compare-best-cell" : ""}">${formatPrice(item.minPrice)}${isBest && list.length > 1 ? "（本组最低）" : ""}</span>`;
            })}
            ${makeRow("均价 / 最高", (item) => `${formatPrice(item.medianPrice)} / ${formatPrice(item.maxPrice)}`)}
            ${makeRow("在售店铺数", (item) => `${Number(item.shopCount || 0)} 家（${Number(item.offerCount || 0)} 条报价）`)}
            ${makeRow("主分类", (item) => escapeHtml(formatGroupLabel(item.group || "其它")))}
            ${makeRow("商品类型", (item) => escapeHtml(CARD_BADGE_LABELS.type[item.attributes?.type] || "—"))}
            ${makeRow("套餐 / 时长", (item) => {
              const p = CARD_BADGE_LABELS.plan[item.attributes?.plan] || "—";
              const d = CARD_BADGE_LABELS.duration[item.attributes?.duration] || "—";
              return `${escapeHtml(p)} · ${escapeHtml(d)}`;
            })}
            ${makeRow("售后原文", (item) => escapeHtml(item.warrantyText || "—"))}
            ${makeRow("领衔店铺", (item) => escapeHtml(item.shopName || "—"))}
            ${makeRow("直达购买", (item) => {
              const url = safeUrl(item.itemUrl);
              return url
                ? `<a class="offer-action-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">前往查看 ↗</a>`
                : "暂无直链";
            })}
          </tbody>
        </table>
      </div>
    `;
    return;
  }

  // 我的收藏 Tab
  const { products, shops } = state.favorites;
  if (products.length === 0 && shops.length === 0) {
    els.workbenchBody.innerHTML =
      '<p class="empty-tip">暂无收藏内容。在商品或店铺卡片点击「☆ 收藏」，可保存到本地浏览器方便下次直达。</p>';
    return;
  }

  const productCards =
    products.length > 0
      ? `<section class="fav-section">
           <h3>已收藏商品 (${products.length})</h3>
           <div class="fav-list">
             ${products
               .map((item) => {
                 const link = safeUrl(item.itemUrl);
                 const compared = isProductCompared(item.id);
                 return `
                   <article class="fav-item-card">
                     <strong>${escapeHtml(item.name)}</strong>
                     <div class="fav-item-meta">${escapeHtml(formatGroupLabel(item.group || ""))} · 最低 ${formatPrice(item.minPrice)} · ${Number(item.shopCount || 0)} 店在售</div>
                     <div class="fav-item-actions">
                       ${
                         link
                           ? `<a class="offer-action-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">前往 ↗</a>`
                           : ""
                       }
                       <button type="button" class="mini-icon-btn${compared ? " is-active" : ""}" data-wb-compare-fav="${escapeHtml(item.id)}">${compared ? "✓ 已在对比" : "⚖ 加入对比"}</button>
                       <button type="button" class="mini-icon-btn" data-wb-remove-fav-product="${escapeHtml(item.id)}">移除</button>
                     </div>
                   </article>
                 `;
               })
               .join("")}
           </div>
         </section>`
      : "";

  const shopCards =
    shops.length > 0
      ? `<section class="fav-section">
           <h3>已收藏店铺 (${shops.length})</h3>
           <div class="fav-list">
             ${shops
               .map(
                 (s) => `
                   <article class="fav-item-card">
                     <strong>${escapeHtml(hideSavedTelegram(s.shopName))}</strong>
                     <div class="fav-item-meta">${escapeHtml(formatShopSystemLabel(s.systemTypeLabel))} · 在售 ${Number(s.productCount || 0)} 件</div>
                     <div class="fav-item-actions">
                       <button type="button" class="btn btn-secondary btn-compact" data-wb-open-shop="${escapeHtml(s.id)}">店铺信息</button>
                       <button type="button" class="mini-icon-btn" data-wb-remove-fav-shop="${escapeHtml(s.id)}">移除</button>
                     </div>
                   </article>
                 `,
               )
               .join("")}
           </div>
         </section>`
      : "";

  els.workbenchBody.innerHTML = `${productCards}${shopCards}`;
}

/** 首次进入页面只读取已收录数据；源站采集由受鉴权的管理接口执行。 */
async function loadInitialResults() {
  const carried = [...state.initialClearedLabels];
  state.initialClearedLabels = [];
  await fetchCurrentView({
    preserveNotice: Boolean(state.filterNotice),
    cleanScope: resolveInitialCleanScope(),
    carriedClearedLabels: carried,
    allowAutoClean: true,
  });
}

function fetchCurrentView(options = {}) {
  return state.mode === "shop" ? fetchShops(false, options) : fetchProducts(false, false, options);
}

let composing = false;

/** 仅显式提交才把输入草稿用于查询；同词在途请求不重复提交。 */
function submitSearch() {
  if (composing) return;
  const nextQuery = els.searchInput.value.trim();
  const loading = state.mode === "shop" ? state.shopLoading : state.productLoading;
  if (loading && nextQuery === state.q) return;
  state.q = nextQuery;
  state.searchDraft = nextQuery;
  syncControlsFromState();
  syncStateToUrl();
  fetchCurrentView({ cleanScope: "q", allowAutoClean: true });
}

function applyCustomPriceFilter() {
  let minVal = sanitizeCustomPriceInput(els.customMinPrice.value);
  let maxVal = sanitizeCustomPriceInput(els.customMaxPrice.value);
  if (minVal !== "" && maxVal !== "" && Number(minVal) > Number(maxVal)) {
    [minVal, maxVal] = [maxVal, minVal];
    showToast("最低价高于最高价，已自动交换范围");
  }
  state.minPrice = minVal;
  state.maxPrice = maxVal;
  if (hasCustomPriceFilter()) {
    state.price = "all";
  }
  setFilterNotice("");
  syncControlsFromState();
  syncStateToUrl();
  fetchProducts(false, false, { cleanScope: "none" });
}

function resetProductFilters() {
  state.q = "";
  state.searchDraft = "";
  els.searchInput.value = "";
  state.group = "all";
  state.type = "all";
  state.plan = "all";
  state.duration = "all";
  state.price = "all";
  state.minPrice = "";
  state.maxPrice = "";
  state.moreFiltersOpen = false;
  setFilterNotice("");
  syncControlsFromState();
  syncStateToUrl();
  fetchProducts(false);
}

function resetShopFilters() {
  state.q = "";
  state.searchDraft = "";
  els.searchInput.value = "";
  state.shopSystemType = "all";
  state.shopSort = "default";
  state.shopOnlyInStock = false;
  state.shopHasIntegrationCode = false;
  setFilterNotice("");
  syncControlsFromState();
  syncStateToUrl();
  fetchShops(false);
}

function trapModalFocus(modalEl, event) {
  if (event.key !== "Tab" || modalEl.hidden) return false;
  const focusables = Array.from(
    modalEl.querySelectorAll(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]',
    ),
  );
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (!modalEl.contains(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
  return true;
}

function bindEvents() {
  els.themeToggleBtn?.addEventListener("click", toggleTheme);

  els.workbenchBtn?.addEventListener("click", () => {
    const defaultTab = state.compareItems.length > 0 ? "compare" : "favorites";
    openWorkbenchModal(defaultTab);
  });

  els.openCompareModalBtn?.addEventListener("click", () => openWorkbenchModal("compare"));

  els.clearCompareBtn?.addEventListener("click", () => {
    state.compareItems = [];
    saveCompareToStorage();
    renderWorkbenchIndicators();
    if (state.mode === "product" && state.allItems.length > 0) renderProducts(false);
    showToast("已清空对比清单");
  });

  els.shareFiltersBtn?.addEventListener("click", () => {
    copyTextWithFeedback(window.location.href, "当前筛选链接");
  });

  document.querySelectorAll(".mode-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      setFilterNotice("");
      switchMode(btn.dataset.mode);
      if (state.mode === "shop") {
        fetchShops(false, { allowAutoClean: true });
      } else {
        fetchProducts(false, false, { cleanScope: resolveInitialCleanScope() });
      }
    });
  });

  els.searchInput.addEventListener("compositionstart", () => {
    composing = true;
  });
  els.searchInput.addEventListener("compositionend", () => {
    composing = false;
    state.searchDraft = els.searchInput.value;
    syncSearchInputHelpers();
  });
  els.searchInput.addEventListener("input", () => {
    state.searchDraft = els.searchInput.value;
    syncSearchInputHelpers();
  });
  els.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (composing || event.isComposing || event.keyCode === 229)) {
      event.preventDefault();
    }
  });
  els.clearSearchBtn?.addEventListener("click", () => {
    state.searchDraft = "";
    els.searchInput.value = "";
    syncSearchInputHelpers();
    els.searchInput.focus();
  });
  els.hotQueries?.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-hot-query]");
    if (!chip) return;
    const word = chip.dataset.hotQuery || "";
    const next = state.searchDraft.trim().toLowerCase() === word.toLowerCase() ? "" : word;
    state.searchDraft = next;
    els.searchInput.value = next;
    syncSearchInputHelpers();
    els.searchInput.focus();
  });

  document.querySelector("#searchForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!composing) submitSearch();
  });
  document.querySelector("#retryBtn").addEventListener("click", () => fetchCurrentView());

  els.filterNoticeBar.addEventListener("click", (event) => {
    if (event.target.closest(".filter-notice-close")) {
      setFilterNotice("");
    }
  });

  els.activeFilters.addEventListener("click", (event) => {
    const key = event.target.closest("[data-remove-filter]")?.dataset.removeFilter;
    if (!key) return;
    if (key === "q") {
      state.q = "";
      state.searchDraft = "";
      els.searchInput.value = "";
    } else if (key === "shopOnlyInStock") {
      state.shopOnlyInStock = false;
    } else if (key === "shopHasIntegrationCode") {
      state.shopHasIntegrationCode = false;
    } else if (key === "shopSort") {
      state.shopSort = "default";
    } else if (key === "shopSystemType") {
      state.shopSystemType = "all";
    } else if (key === "customPrice") {
      state.minPrice = "";
      state.maxPrice = "";
    } else {
      state[key] = "all";
      enforceProductContextConstraints();
    }
    setFilterNotice("");
    syncControlsFromState();
    syncStateToUrl();
    fetchCurrentView();
  });

  els.shopSystemSelect.addEventListener("change", () => {
    state.shopSystemType = els.shopSystemSelect.value;
    setFilterNotice("");
    syncControlsFromState();
    syncStateToUrl();
    fetchShops(false);
  });

  els.shopSortSelect?.addEventListener("change", () => {
    state.shopSort = SHOP_SORT_OPTIONS.has(els.shopSortSelect.value) ? els.shopSortSelect.value : "default";
    setFilterNotice("");
    syncControlsFromState();
    syncStateToUrl();
    fetchShops(false);
  });

  els.shopOnlyInStockInput.addEventListener("change", () => {
    state.shopOnlyInStock = els.shopOnlyInStockInput.checked;
    setFilterNotice("");
    syncControlsFromState();
    syncStateToUrl();
    fetchShops(false, { allowAutoClean: true });
  });

  els.shopHasIntegrationCodeInput?.addEventListener("change", () => {
    state.shopHasIntegrationCode = els.shopHasIntegrationCodeInput.checked;
    setFilterNotice("");
    syncControlsFromState();
    syncStateToUrl();
    fetchShops(false, { allowAutoClean: true });
  });


  els.shopResetFiltersBtn.addEventListener("click", resetShopFilters);

  els.sortSelect.addEventListener("change", () => {
    state.sort = SORT_OPTIONS.has(els.sortSelect.value) ? els.sortSelect.value : "relevance";
    syncStateToUrl();
    fetchProducts(false, true, { preserveNotice: true });
  });

  els.applyCustomPriceBtn?.addEventListener("click", applyCustomPriceFilter);
  [els.customMinPrice, els.customMaxPrice].forEach((input) => {
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applyCustomPriceFilter();
      }
    });
  });

  const handleFilterChange = (event) => {
    const target = event.target;
    if (!target || target.tagName !== "SELECT") return;
    const key = target.dataset.filterKey;
    if (!key) return;
    state[key] = target.value;
    if (key === "price" && target.value !== "all") {
      state.minPrice = "";
      state.maxPrice = "";
    }
    const staticCleared = enforceProductContextConstraints();
    if (staticCleared.length > 0) {
      setFilterNotice(`已自动清除当前条件下不适用的筛选：${staticCleared.join("、")}`);
    } else {
      setFilterNotice("");
    }
    syncControlsFromState();
    syncStateToUrl();
    fetchProducts(false, false, {
      cleanScope: key,
      carriedClearedLabels: staticCleared,
    });
  };

  els.primaryFilters.addEventListener("change", handleFilterChange);
  els.moreFiltersPanel.addEventListener("change", handleFilterChange);

  els.toggleMoreFiltersBtn.addEventListener("click", () => {
    state.moreFiltersOpen = !state.moreFiltersOpen;
    renderFilterControls();
  });

  els.resetFiltersBtn.addEventListener("click", resetProductFilters);

  els.brandChips.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-group]");
    if (!btn) return;
    const nextGroup = btn.dataset.group || "all";
    if (nextGroup === state.group) return;
    state.group = nextGroup;
    const staticCleared = enforceProductContextConstraints();
    if (staticCleared.length > 0) {
      setFilterNotice(`已自动清除当前条件下不适用的筛选：${staticCleared.join("、")}`);
    } else {
      setFilterNotice("");
    }
    syncControlsFromState();
    syncStateToUrl();
    fetchProducts(false, false, {
      cleanScope: "group",
      carriedClearedLabels: staticCleared,
    });
  });

  els.productList.addEventListener("click", (event) => {
    const toggleBtn = event.target.closest("[data-toggle-key]");
    if (toggleBtn) {
      const key = toggleBtn.dataset.toggleKey;
      if (state.expandedGroupKeys.has(key)) {
        state.expandedGroupKeys.delete(key);
      } else {
        state.expandedGroupKeys.add(key);
      }
      renderProductGroup(key);
      return;
    }

    const loadMoreOffersBtn = event.target.closest("[data-load-offers]");
    if (loadMoreOffersBtn) {
      const offerKey = loadMoreOffersBtn.dataset.loadOffers;
      if (offerKey) fetchFullOffersForGroup(offerKey);
      return;
    }

    const openShopBtn = event.target.closest("[data-open-shop]");
    if (openShopBtn) {
      openShopProfile(openShopBtn.dataset.openShop);
      return;
    }

    const favBtn = event.target.closest("[data-fav-product]");
    if (favBtn) {
      toggleProductFavorite(favBtn.dataset.favProduct);
      return;
    }

    const compareBtn = event.target.closest("[data-compare-product]");
    if (compareBtn) {
      toggleProductCompare(compareBtn.dataset.compareProduct);
    }
  });

  els.loadMoreBtn.addEventListener("click", () => {
    if (state.productLoading) return;
    state.page += 1;
    fetchProducts(true, false, { preserveNotice: true });
  });

  els.shopLoadMoreBtn.addEventListener("click", () => {
    if (state.shopLoading) return;
    state.shopPage += 1;
    fetchShops(true, { preserveNotice: true });
  });

  els.shopList.addEventListener("click", (event) => {
    const copyBtn = event.target.closest("[data-copy-text]");
    if (copyBtn) {
      copyTextWithFeedback(copyBtn.dataset.copyText, copyBtn.dataset.copyLabel || "内容");
      return;
    }
    const favBtn = event.target.closest("[data-fav-shop]");
    if (favBtn) {
      const shopObj = state.shopsData.find((s) => s.id === favBtn.dataset.favShop);
      if (shopObj) toggleShopFavorite(shopObj);
      return;
    }
    const btn = event.target.closest("[data-open-shop]");
    if (btn) openShopProfile(btn.dataset.openShop);
  });

  els.profileBody.addEventListener("click", (event) => {
    const copyBtn = event.target.closest("[data-copy-text]");
    if (copyBtn) {
      copyTextWithFeedback(copyBtn.dataset.copyText, copyBtn.dataset.copyLabel || "内容");
    }
  });

  document.querySelectorAll("[data-close-modal]").forEach((el) => {
    el.addEventListener("click", closeShopProfile);
  });

  document.querySelectorAll("[data-close-workbench]").forEach((el) => {
    el.addEventListener("click", closeWorkbenchModal);
  });

  els.workbenchModal?.addEventListener("click", (event) => {
    const tabBtn = event.target.closest("[data-wb-tab]");
    if (tabBtn) {
      state.workbenchTab = tabBtn.dataset.wbTab === "favorites" ? "favorites" : "compare";
      renderWorkbenchBody();
      return;
    }

    const rmCompare = event.target.closest("[data-wb-remove-compare]");
    if (rmCompare) {
      toggleProductCompare(rmCompare.dataset.wbRemoveCompare);
      return;
    }

    const cmpFav = event.target.closest("[data-wb-compare-fav]");
    if (cmpFav) {
      toggleProductCompare(cmpFav.dataset.wbCompareFav);
      return;
    }

    const rmFavProd = event.target.closest("[data-wb-remove-fav-product]");
    if (rmFavProd) {
      toggleProductFavorite(rmFavProd.dataset.wbRemoveFavProduct);
      return;
    }

    const rmFavShop = event.target.closest("[data-wb-remove-fav-shop]");
    if (rmFavShop) {
      const target = state.favorites.shops.find((s) => s.id === rmFavShop.dataset.wbRemoveFavShop);
      if (target) toggleShopFavorite(target);
      return;
    }

    const openShop = event.target.closest("[data-wb-open-shop]");
    if (openShop) {
      closeWorkbenchModal();
      openShopProfile(openShop.dataset.wbOpenShop);
    }
  });

  window.addEventListener(
    "scroll",
    () => {
      if (els.backToTopBtn) {
        els.backToTopBtn.hidden = window.scrollY < 360;
      }
    },
    { passive: true },
  );

  els.backToTopBtn?.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  els.viewLayoutSwitch?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-view-mode]");
    if (!btn) return;
    setViewMode(btn.dataset.viewMode);
  });

  document.addEventListener("keydown", (event) => {
    if (!els.profileModal.hidden) {
      if (trapModalFocus(els.profileModal, event)) return;
      if (event.key === "Escape") {
        closeShopProfile();
        return;
      }
    }
    if (!els.workbenchModal.hidden) {
      if (trapModalFocus(els.workbenchModal, event)) return;
      if (event.key === "Escape") {
        closeWorkbenchModal();
        return;
      }
    }
    const tag = document.activeElement?.tagName;
    if (
      event.key === "/" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      tag !== "INPUT" &&
      tag !== "TEXTAREA" &&
      tag !== "SELECT" &&
      !document.activeElement?.isContentEditable
    ) {
      event.preventDefault();
      els.searchInput?.focus();
      els.searchInput?.select();
    }
  });

  window.addEventListener("popstate", () => {
    if (!els.profileModal.hidden) {
      state.profileTrigger = null;
      closeShopProfile();
    }
    if (!els.workbenchModal.hidden) {
      state.workbenchTrigger = null;
      closeWorkbenchModal();
    }
    readStateFromUrl();
    syncControlsFromState();
    switchMode(state.mode);
    const carried = [...state.initialClearedLabels];
    state.initialClearedLabels = [];
    fetchCurrentView({
      preserveNotice: Boolean(state.filterNotice),
      cleanScope: resolveInitialCleanScope(),
      carriedClearedLabels: carried,
      allowAutoClean: true,
    });
  });
}

readStateFromUrl();
applyViewMode(state.viewMode);
syncControlsFromState();
renderWorkbenchIndicators();
bindEvents();
switchMode(state.mode);
loadInitialResults();

// 彩蛋只响应主动点击或空白处口令，不访问网络、不写存储、不播放声音。
const KUN_EGG_LINES = [
  "🐔 鸡哥上线：练习两年半，比价有一手。",
  "🏀 坤坤运球中：价格可以跳，预算不能超。",
  "🕶️ 小黑子，露出鸡脚了吧！先去店铺核实库存。",
  "👖 背带裤已就位，今天也要理性比价。",
  "🎤 唱、跳、rap、篮球，挑店还得看售后。",
  "🐣 真爱粉与小黑子都能进，钱包由自己守护。",
];
let kunEggIndex = 0;
let lastKunEggAt = 0;

/** 彩蛋只保留一个短暂动画，并限制连点，避免堆积装饰节点。 */
function triggerKunEgg(secret = false) {
  if (Date.now() - lastKunEggAt < 350) return;
  lastKunEggAt = Date.now();
  showToast(secret ? "🏀 IKUN 隐藏练习室已解锁！小黑子也欢迎围观。" : KUN_EGG_LINES[kunEggIndex++ % KUN_EGG_LINES.length]);
  const button = document.querySelector("#kunEggBtn");
  button?.classList.remove("kun-bounce");
  if (button) {
    void button.offsetWidth;
    button.classList.add("kun-bounce");
  }
  document.querySelector(".kun-court")?.remove();
  const court = document.createElement("div");
  court.className = "kun-court";
  court.setAttribute("aria-hidden", "true");
  court.textContent = "🐔 🏀";
  document.body.appendChild(court);
  setTimeout(() => court.remove(), 1800);
}

document.querySelector("#kunEggBtn")?.addEventListener("click", () => triggerKunEgg());
let kunSecretBuffer = "";
let lastKunKeyAt = 0;
document.addEventListener("keydown", (event) => {
  const target = event.target;
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || event.isComposing ||
      target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || "") ||
      !els.profileModal.hidden || !els.workbenchModal.hidden) {
    kunSecretBuffer = "";
    return;
  }
  if (!/^[a-z]$/i.test(event.key)) {
    kunSecretBuffer = "";
    return;
  }
  if (Date.now() - lastKunKeyAt > 2000) kunSecretBuffer = "";
  lastKunKeyAt = Date.now();
  kunSecretBuffer = (kunSecretBuffer + event.key.toLowerCase()).slice(-4);
  if (kunSecretBuffer === "ikun") {
    triggerKunEgg(true);
    kunSecretBuffer = "";
  }
});
