import { describe, expect, it } from "vitest";
import { classifyBrand, createBrandClassifier } from "../src/collector/etl/brandClassifier";
import { detectBrandGroup } from "../src/collector/etl/cleaner";

/** 覆盖配置带来的行为，而不重复实现匹配算法。 */
describe("可配置品牌规则", () => {
  it("按显式优先级匹配，不依赖配置数组的位置", () => {
    const match = createBrandClassifier([
      { id: "generic", group: "ChatGPT", priority: 100, includeAny: ["plus"] },
      { id: "specific", group: "Codex", priority: 10, includeAny: ["codex"] },
    ]);
    expect(match("Codex Plus 月卡")).toBe("Codex");
  });

  it("包含条件可限定用途，排除条件会继续查找后续规则", () => {
    const match = createBrandClassifier([
      { id: "relay", group: "中转", priority: 10,
        includeAny: ["API", "中转"], includeAll: ["额度"], excludeAny: ["成品"] },
      { id: "account", group: "AI创作", priority: 20, includeAny: ["muse"] },
    ]);
    expect(match("Muse API 额度")).toBe("中转");
    expect(match("Muse API 成品号 额度")).toBe("AI创作");
    expect(match("Muse API 月卡")).toBe("AI创作");
    expect(match("无匹配商品")).toBeUndefined();
  });

  it("编辑数据即可改变分类，匹配器之间互不污染", () => {
    const original = createBrandClassifier([{ id: "test", group: "Claude", priority: 1, includeAny: ["sample"] }]);
    const revised = createBrandClassifier([{ id: "test", group: "Gemini", priority: 1, includeAny: ["sample"] }]);
    expect(original("sample")).toBe("Claude");
    expect(revised("sample")).toBe("Gemini");
    expect(original("sample")).toBe("Claude");
  });

  it.each([
    ["Claude Pro 成品号", "ChatGPT", "Claude"],
    ["Cluade Max 5x 月卡", "", "Claude"],
    ["未标品牌独享月卡", "Gemini", "Gemini"],
    ["未标品牌独享月卡", "未标分类", "其它"],
    ["未标品牌独享月卡", "G", "ChatGPT"],
    ["未标品牌独享月卡", "G-PRO", "ChatGPT"],
    ["Ｃｏｄｅｘ Plus 月卡", "ChatGPT", "Codex"],
    ["Antigravity Gemini 会员", "", "Gemini"],
    ["Muse 10亿token 成品号", "中转", "Muse"],
    ["VISA卡 支持 Claude Kiro", "", "虚拟卡"],
    ["OpenAI Claude 中转 API 额度", "", "中转"],
    ["Claude 成品号 支持反代", "", "Claude"],
    ["美卡", "", "虚拟卡"],
    ["0刀卡 虚拟VISA卡头", "", "虚拟卡"],
    // 清除通用 接马/接码 对 ChatGPT 的误分类污染
    ["千问 接马 美+1 15-30天", "千问接马", "千问"],
    ["eBay 接马 美+1", "", "平台账号"],
    ["Instagram/Threads 接马 美+1", "", "平台账号"],
    ["Google/Gmail/YouTube 接马 美+1", "谷歌接马", "邮箱账号"],
    ["ChatGPT 接码服务", "", "ChatGPT"],
    ["Codex 接马 美+1", "", "Codex"],
    // 零宽字符清理与边界穿透修复
    ["SuperGro\u200bk Heavy 月卡", "", "Grok"],
    ["G\u200bPT Plus 卡冲", "", "ChatGPT"],
    ["Cla\u200bude Pro 月卡", "", "Claude"],
    ["claudemax5【美区直充】", "", "Claude"],
    ["ClaudeUltra成品号", "", "Claude"],
    ["Supergrokheavy月卡", "", "Grok"],
    ["CDK 美+1codex 20-30天接马", "", "Codex"],
    ["Gcodex接马", "", "Codex"],
    ["Muse310亿成品号-微软邮箱交付", "", "Muse"],
    ["amuse 账号", "", "其它"],
    ["cursor200刀大额号", "", "Cursor"],
    ["10Xteam 长效车 谷歌邮箱", "", "ChatGPT"],
    ["Steam 充值卡", "", "游戏商品"],
    ["爱沙尼亚 eSIM 纯接卡", "", "手机卡"],
    ["Suno 音乐创作会员", "", "AI音乐"],
    ["Image2.0生图(100张)", "", "AI绘图"],
    ["地铁_至尊版_头像框自定义", "", "游戏商品"],
    ["50刀", "", "其它"],
    ["【100刀】Augmentcode续杯", "", "Augment"],
    ["Perplexity Pro max功能都有", "", "Perplexity"],
    ["哔哩哔哩 大会员 年卡", "", "影音会员"],
    ["华为视频 少儿会员 月卡", "", "影音会员"],
    ["霸王茶姬代金券100元", "", "生活优惠"],
    ["滴滴出行快车券10元", "", "生活优惠"],
    ["百度文库会员 年卡", "", "工具教程"],
    ["Image 2.5生图10000积分", "", "AI绘图"],
    ["智谱5.3最新的日卡服务", "对接中转", "智谱"],
    ["智铺 GLM 会员", "", "智谱"],
    ["【11.10新批次】Muse AI 10亿token成品号", "", "Muse"],
    ["腾讯视频 超级影视 年卡", "", "影音会员"],
    ["网易云音乐 黑胶VIP 月卡", "", "影音会员"],
    ["百度网盘 超级会员 年卡", "", "网盘服务"],
    ["美团外卖通用红包30元", "", "生活优惠"],
    ["GeminiPro 12个月", "", "Gemini"],
    ["Leonardo 8500分成品号 (有image2，gemini2图片模型)", "", "AI绘图"],
    ["Team 5x 长效车 额度500-1000刀", "", "ChatGPT"],
    // ch-?at 与 Teams 边界防误杀
    ["WeChat 微信账号", "", "平台账号"],
    ["SnapChat 账号", "", "其它"],
    ["ChatBox 客户端授权", "", "其它"],
    ["【Chat G Free号】微软邮箱+2FA", "", "ChatGPT"],
    ["【Ch-at Free号】微软邮箱", "", "ChatGPT"],
    ["300个用户 Office 365 商业版+Teams+1TB", "", "其它"],
    // 跨品牌模型名与三合一套餐归属修复
    ["gemini pro Antigravity 成品号反重力pro opus 3.6/5.5", "", "Gemini"],
    ["Gemini ultra 20X 独享opus，独享flow2.5w", "", "Gemini"],
    ["GroK Plus((GroK·X·Cursor 三合一订阅) ) 月卡", "", "Grok"],
    ["SupergroK 7-10天会员号--【带SSO-bot勿拍,cursor勿拍】", "", "Grok"],
    ["Super gr0k ultra月卡成品", "", "Grok"],
    ["Gr0k Ultra成品1个月", "", "Grok"],
    ["Gr-k Pro 成品号", "", "Grok"],
    ["Gork 月卡成品", "", "Grok"],
    ["gro 成品会员 4.1", "", "Grok"],
    ["gro free 微软邮箱 cpa/sub2 json反代", "", "Grok"],
    // Gemini 拼接与教程排除、OpenAI 避敏黑话与中转排除邮箱/账号
    ["地区随机|GeminiPro3或6个月|所有模型可用|家庭组共享反重力额度", "", "Gemini"],
    ["内部教程_Gemini3.1Pro如何开启家庭组？（仅图文教程）", "", "工具教程"],
    ["Gpro10X拼车两人车", "", "ChatGPT"],
    ["G Pro 5x 官充 CDK", "", "ChatGPT"],
    ["G10×Pro 月卡席位", "", "ChatGPT"],
    ["Pro 200(原来叫做Pro20x) 月卡", "", "ChatGPT"],
    ["pro500直充 官方充值", "", "ChatGPT"],
    ["PGT Plus 月卡直充", "", "ChatGPT"],
    ["C.h.a.t.g 官方直充", "", "ChatGPT"],
    ["G5.6 独享账号", "", "ChatGPT"],
    ["GO官冲 1个月", "", "ChatGPT"],
    ["G官方独享月卡", "", "ChatGPT"],
    ["微软邮箱长效-outlook/hotmail oauth2双令牌 refresh_token号", "", "邮箱账号"],
    ["SuperGrok 独享账号 一年会员 反代不保", "", "Grok"],
    ["Kiro ProMax 5000 积分账号 稳定大量供应中转", "", "Kiro"],
    // 新增 AI创作 / 代理IP / 中转余额 / 平台账号 / 工具教程 与防误杀测试
    ["即梦 AI 会员月卡 Seedance 视频生成", "", "AI视频"],
    ["可灵 AI 灵感值 算力点", "", "AI视频"],
    ["Canvas无限画布 InMind AI 账号", "", "AI创作"],
    ["美国🏠宽 双ISP 原生静态住宅IP 支持TikTok GPT", "", "代理IP"],
    ["Claude Pro 成品号 需美国住宅IP登录", "", "Claude"],
    ["ChatGPT Plus 成品号 美区IP注册", "", "ChatGPT"],
    ["OneAPI 站通用 API 余额兑换卡 100刀", "", "中转"],
    ["TikTok 美区千粉老号 TK账号", "", "平台账号"],
    ["美区 iOS 账号 小火箭 Shadowrocket", "", "平台账号"],
    ["推特 Twitte 推X账号 老号带Cookie", "", "平台账号"],
    ["英国 giffgaff 实卡号 接码用", "", "手机卡"],
    ["401全自动授权批量注册机脚本", "", "工具教程"],
    ["2000刀充值卡（找管理充值免手续费）", "兑换码", "中转"],
    ["CNY480=USD500", "MASSMORE兑换码", "中转"],
    ["1个月puls会员 CDK充值", "", "ChatGPT"],
    ["Supergro Heavy 成品/直充1个月", "", "Grok"],
    ["G接马，美国实卡", "G接马", "ChatGPT"],
    ["【自营】已接马 free | 提供json和账密 | 可批量自动401找回", "", "ChatGPT"],
    ["Google Voice GV永久号", "Google Voice", "平台账号"],
    ["Google 手机短信接ma", "接码", "邮箱账号"],
    ["接灰机会员代开/星星赠送", "", "平台账号"],
    ["visa 5刀卡！支持3ds！", "visa", "虚拟卡"],
    ["API 网站金额充值 ===10元一个亿", "", "中转"],
    ["生图站积分-100积分", "", "AI绘图"],
    ["G 20X 卡密充值一个月", "GP提 直充", "ChatGPT"],
    ["【官方充值】G皮T go（质保订阅）", "", "ChatGPT"],
    ["Go 月卡 菲区卡充 质保30天", "AI直充", "ChatGPT"],
    ["苹果微信分身-季卡", "", "平台账号"],
    ["G注册 卡密 1天", "工具卡密", "工具教程"],
    ["HelloAPI-10美金体验装", "最新API", "中转"],
    ["coedx 接马 （一次码）", "接马", "Codex"],
    ["GM 未接马free 质保下单1h内首登", "free", "ChatGPT"],
    ["Yahoo 接马 美+1 21-30天", "Yahoo接马", "邮箱账号"],
    ["X 接马 CDK激活 20-30天有效期", "其他业务接马", "平台账号"],
    ["纯科技 纯协议 日产万号注册鸡", "", "工具教程"],
  ])("默认配置保留 %s 的分类", (title, category, expected) => {
    expect(detectBrandGroup(title, category)).toBe(expected);
  });

  it("默认匹配器可重复使用，没有正则游标状态，且空输入安全", () => {
    for (let index = 0; index < 5; index += 1) {
      expect(classifyBrand("codex PLUS 月卡")).toBe("Codex");
      expect(classifyBrand("无匹配词")).toBeUndefined();
    }
    expect(classifyBrand("")).toBeUndefined();
    expect(classifyBrand("\u200B\u200C\uFEFF")).toBeUndefined();
  });

  it("拒绝重复 ID、未知分类、无效优先级及正则", () => {
    const rule = { id: "test", group: "Claude", priority: 1, includeAny: ["claude"] };
    expect(() => createBrandClassifier([rule, rule])).toThrow("ID");
    expect(() => createBrandClassifier([{ ...rule, group: "未知品牌" }])).toThrow("未知分类");
    expect(() => createBrandClassifier([{ ...rule, priority: Number.NaN }])).toThrow("优先级");
    expect(() => createBrandClassifier([{ ...rule, includeAny: ["("] }])).toThrow("无效表达式");
    expect(() => createBrandClassifier([{ ...rule, includeAny: [""] }])).toThrow("空表达式");
    expect(() => createBrandClassifier([{ ...rule, includeAny: [] }])).toThrow("缺少包含条件");
  });
});
