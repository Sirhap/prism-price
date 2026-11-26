/** 站点内置知识片段：用于指南类问题的规则回答，内容全部来自公开页面文案。 */
export interface KnowledgeSnippet {
  id: string;
  title: string;
  url: string;
  keywords: readonly string[];
  answer: string;
}

export const KNOWLEDGE_SNIPPETS: readonly KnowledgeSnippet[] = [
  {
    id: "open-store",
    title: "联动小铺开店与收录",
    url: "/guide/open-store/",
    keywords: ["开店", "入驻", "注册店铺", "开铺", "联动小铺", "怎么开店"],
    answer:
      "开店流程：① 前往联动小铺注册并完成店铺设置；② 在棱镜比价「看收录店铺」勾选「仅看有对接码」，复制合适店铺的对接码；③ 在商家后台选择「货源 → 我要对接货源」，粘贴对接码并搜索货源商完成关联。开店后在店铺简介单独一行标注「对接码：你的代码」，再到首页点「添加收录店铺」提交公网网址即可等待收录。",
  },
  {
    id: "integration-code",
    title: "对接码 / 分销码",
    url: "/guide/integration-codes/",
    keywords: ["对接码", "分销码", "货源", "对接", "对接代码"],
    answer:
      "对接码（也叫分销码）是联动小铺等发卡平台用于绑定上游货源的分销识别码。在首页切到「看收录店铺」并勾选「仅看有对接码」，或直接访问店铺对接码目录，就能浏览并一键复制公开对接码。系统会保留原始大小写、前导零和内部空格，不改写格式。",
  },
  {
    id: "submit-shop",
    title: "提交收录店铺",
    url: "/about/",
    keywords: ["收录", "提交店铺", "添加店铺", "收录店铺", "怎么收录"],
    answer:
      "点击首页导航的「添加收录店铺」，填写公开店铺网址即可；分销码 / 对接码为选填。联动小铺等支持的平台提交后会自动同步，其他店铺可能需要人工适配。提交前建议先在店铺简介中标注品牌、规格和对接码，便于识别。",
  },
  {
    id: "accuracy",
    title: "价格与库存准确性",
    url: "/about/",
    keywords: ["价格准", "准确", "实时", "误差", "库存", "数据来源", "同步"],
    answer:
      "页面数据基于公开店铺快照聚合生成，可能存在同步时间差，不是实时报价。本站只做信息收录与比价，不参与交易；下单前请务必前往源站店铺核实最新价格、库存与售后条款。",
  },
  {
    id: "compare-howto",
    title: "怎么比价与筛选",
    url: "/",
    keywords: ["比价", "对比", "筛选", "怎么用", "怎么比", "搜索"],
    answer:
      "在首页搜索框输入商品名称，或使用品牌与品类雷达、商品类型（成品账号 / 代充 / API 中转 / 接码）、套餐、时长、价格区间筛选；展开同款商品即可查看多家店铺参考报价，还能加入同台比价清单逐项对照。",
  },
  {
    id: "sponsor",
    title: "赞助推广投放",
    url: "/about/",
    keywords: ["赞助", "推广", "投放", "授权码", "PRISM", "广告"],
    answer:
      "赞助位分顶部轮播和 4 个固定位。需要先获取以 PRISM- 开头的授权码，每个授权码仅可使用一次；在「赞助推广」里选择投放方式、填写标题和可选跳转链接，上传 JPG/PNG/WebP 图片（最大 5 MB，按 4:3 裁剪）后提交，审批通过才开始展示并计算有效期。",
  },
  {
    id: "shop-systems",
    title: "收录哪些店铺与系统",
    url: "/about/",
    keywords: ["收录哪些", "支持哪些", "系统", "平台", "店铺类型", "哪些店"],
    answer:
      "目前收录联动小铺（wzyp.cn / pay.ldxp.cn）、云猫寄售（catfk.com）、16688 交易平台、独角数卡、二次元发卡及第三方自建卡网店铺，支持按系统类型、在售状态与店铺对接码筛选。",
  },
  {
    id: "brands",
    title: "支持比价的品牌",
    url: "/guide/ai-pricing/",
    keywords: ["ChatGPT", "Codex", "Claude", "Gemini", "Grok", "Cursor", "支持哪些品牌", "AI 订阅"],
    answer:
      "覆盖 ChatGPT、Codex、Claude、Gemini、Grok、Cursor、Kiro、DeepSeek、智谱、Perplexity、千问、MiniMax 等 AI 订阅与额度商品，也包括 AI 视频、绘图、音乐、中转额度、虚拟卡、接码、网盘会员等数字商品。",
  },
  {
    id: "safety",
    title: "交易与售后说明",
    url: "/about/",
    keywords: ["安全", "靠谱", "售后", "风险", "交易", "付款"],
    answer:
      "棱镜比价只做公开信息聚合与比价，不参与交易、不担保店铺履约。价格、库存与售后均以源站店铺页面为准，下单前请自行核实店铺资质与条款。",
  },
];

/** 面板初始展示的快捷问题 */
export const QUICK_QUESTIONS: readonly string[] = [
  "便宜的 Claude 月付",
  "ChatGPT 哪家最便宜",
  "对接码怎么用",
  "怎么开店",
  "价格是实时的吗",
];

/**
 * 按关键词命中数召回知识片段，命中数相同则保持原有顺序。
 */
export function matchKnowledge(question: string, limit = 2): KnowledgeSnippet[] {
  const text = question.normalize("NFKC").toLowerCase();
  const scored = KNOWLEDGE_SNIPPETS
    .map((snippet, index) => ({
      snippet,
      index,
      score: snippet.keywords.reduce((total, keyword) => (
        text.includes(keyword.toLowerCase()) ? total + 1 : total
      ), 0),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  if (scored.length === 0) return [];
  // 只保留与最高分相同的片段，避免通用疑问词（如「怎么用」）带出无关条目。
  const topScore = scored[0].score;
  return scored
    .filter((item) => item.score === topScore)
    .slice(0, limit)
    .map((item) => item.snippet);
}
