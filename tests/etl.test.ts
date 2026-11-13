import { describe, expect, it } from "vitest";
import {
  buildGroupKey,
  calculateMedian,
  cleanProductName,
  detectBrandGroup,
  extractAttributes,
  extractWarrantyText,
  normalizeOffer,
} from "../src/collector/etl/cleaner";

describe("ETL 清洗、分类与同款聚合测试", () => {
  it("应正确剥离 emoji、免责口癖与多余标点", () => {
    const raw = "🔥【独享】Cursor Pro 月卡 成品号 会用，知道干啥用的拍，相反的勿拍！！";
    const cleaned = cleanProductName(raw);
    expect(cleaned).toBe("【独享】Cursor Pro 月卡 成品号 ！！");
    expect(cleaned).not.toContain("🔥");
    expect(cleaned).not.toContain("相反的勿拍");
  });

  it("应准确识别 12 个主品牌分类", () => {
    expect(detectBrandGroup("ChatGPT Plus 独享月卡", "AI账号")).toBe("ChatGPT");
    expect(detectBrandGroup("Codex 500 点数 API", "编程")).toBe("Codex");
    expect(detectBrandGroup("Claude Pro 月卡成品", "Anthropic")).toBe("Claude");
    expect(detectBrandGroup("OpenAI / Claude 通用中转 API 额度 100刀", "中转")).toBe("中转");
    expect(detectBrandGroup("2025 Gmail 高权重老邮箱", "邮箱")).toBe("邮箱账号");
  });

  it("应从非标标题中提取多维度属性标签", () => {
    const attrs = extractAttributes(
      "🔥美+1长效接马codex绑定注册通用20-30天【质保不来码】PLUS接马",
      "接码",
    );
    expect(attrs.attrPlan).toBe("plus");
    expect(attrs.attrDuration).toBe("month");
    expect(attrs.attrWarranty).toBe("yes");
    expect(attrs.attrType).toBe("sms-service");
    expect(attrs.attrSms).toBe("");
    expect(attrs.attrRegion).toBe("us");
  });

  it("不同商家售卖同款商品应生成相同的聚合键并正确计算中位价", () => {
    const offer1 = normalizeOffer(
      "shop-1",
      {
        itemKey: "a",
        rawName: "🔥美+1长效接马codex绑定注册通用20-30天【质保不来码】",
        shopCategory: "接码",
        price: 2.53,
        stockCount: 10,
        stockStatus: "normal",
        itemUrl: "https://example.com/1",
      },
      "2026-11-11T00:00:00.000Z",
    );
    const offer2 = normalizeOffer(
      "shop-2",
      {
        itemKey: "b",
        rawName: "美+1长效接马codex绑定注册通用20-30天【质保不来码】",
        shopCategory: "Codex接码",
        price: 2.9,
        stockCount: null,
        stockStatus: "sufficient",
        itemUrl: "https://example.com/2",
      },
      "2026-11-11T00:00:00.000Z",
    );

    expect(offer1.groupKey).toBe(offer2.groupKey);
    expect(offer2.groupKey.endsWith(buildGroupKey(offer1.cleanName))).toBe(true);
    expect(calculateMedian([2.53, 2.68, 2.9])).toBe(2.68);
    expect(calculateMedian([2.53, 2.9])).toBe(2.72);
  });

  it.each([
    ["Codex Plus 月卡", "ChatGPT", "Codex"],
    ["Codex Pro 5x", "AI账号", "Codex"],
    ["Gmail 邮箱", "Claude", "邮箱账号"],
    ["Claude Pro 月卡", "ChatGPT Plus", "Claude"],
    ["Muse 10亿token 成品号", "账号", "Muse"],
    ["即梦 AI 视频月卡", "AI", "AI视频"],
    ["Antigravity 成品号", "AI", "Antigravity"],
    ["DeepSeek API", "AI", "DeepSeek"],
    ["美国双ISP家宽住宅IP 30天", "代理", "代理IP"],
    ["VISA卡 支持 Kiro GPT", "虚拟卡", "虚拟卡"],
    ["通用中转 OpenAI Claude 100刀", "AI", "中转"],
    ["1个月独享成品号", "G", "ChatGPT"],
    ["全套自动化注册机源码图文教程", "综合", "工具教程"],
  ])("标题 %s 应正确分类（店铺分类 %s -> %s）", (name, category, expected) => {
    expect(detectBrandGroup(name, category)).toBe(expected);
  });

  it("套餐、金额、质保和时长应独立识别", () => {
    expect(extractAttributes("Claude API 200刀额度", "").attrPlan).toBe("");
    expect(extractAttributes("Claude Max 20x", "").attrPlan).toBe("pro20");
    expect(extractAttributes("Gemini Pro 6个月 质保30天", "").attrDuration).toBe("half-year");
    expect(extractAttributes("成品号 质保30天", "").attrDuration).toBe("");
    expect(extractAttributes("有效期17天", "").attrDuration).toBe("");
    expect(extractAttributes("Pro 月卡 日区", "Plus 年卡 美区")).toMatchObject({
      attrPlan: "pro", attrDuration: "month", attrRegion: "jp",
    });
  });

  it("长标题尾部、数字区间和上下文不同不能误合并", () => {
    const prefix = "相同的商品标题".repeat(15);
    expect(buildGroupKey(`${prefix} 100积分`)).not.toBe(buildGroupKey(`${prefix} 1000积分`));
    expect(buildGroupKey("1-2天")).not.toBe(buildGroupKey("12天"));
    expect(buildGroupKey("GPT 5.1")).not.toBe(buildGroupKey("GPT 51"));
    expect(buildGroupKey("Ｐｌｕｓ 月卡")).toBe(buildGroupKey("Plus 月卡"));
    const item = { itemKey: "1", rawName: "独享月卡", price: 10, stockCount: 1, stockStatus: "normal" as const, itemUrl: "https://example.com" };
    expect(normalizeOffer("a", { ...item, shopCategory: "Claude" }, "").groupKey)
      .not.toBe(normalizeOffer("b", { ...item, shopCategory: "Gemini" }, "").groupKey);
  });
  it.each([
    ["Muse 10亿token 成品号", "ready"],
    ["Codex Plus CDK 官方充值", "recharge"],
    ["Claude 代充 卡密", "recharge"],
    ["GPT PRO 20X 官方卡冲1个月", "recharge"],
    ["Gemini Ultra 20x 1个月 官网直冲", "recharge"],
    ["G Pro 5x 官充 CDK", "recharge"],
    ["OpenAI Plus 菲区卡充", "recharge"],
    ["Plus CDK 兑换码", "cdk"],
    ["Claude API 100刀额度", "api"],
    ["Codex 接码服务 美国实卡", "sms-service"],
    ["Claude 注册接码 美+1 21-30天", "sms-service"],
    ["（一次性）稳定克劳德 Claude接ma 全球接马 cdk发货", "sms-service"],
    ["Cursor 接马 美区长效60天", "sms-service"],
    ["Google/Gmail/YouTube 接马 美+1", "sms-service"],
    ["Meta/Muse 接马 美+1【自动换号】", "sms-service"],
    ["Instagram/Threads 接马 美区【单次接马】", "sms-service"],
    ["千问 接马 美+1 15-30天", "sms-service"],
    ["ChatGPT 拼车 二人车月卡", "ready"],
    ["Team 席位 月卡", "ready"],
    ["ChatGPT Business 团队版 席位全程质保【可续费且随时上车】", "ready"],
    ["【月抛车，不可续费同一空间】team普通1x席位 独享车位", "ready"],
    ["G Free 普号成品（不支持代充）", "ready"],
    ["Team 5x 长效车｜不踢不拉｜额度500-1000刀", "ready"],
    ["【10Xteam 额度600-1000刀 长效不踢】", "ready"],
    ["接马free号 微软邮箱 带2fa", "ready"],
    ["【1个账号兑换卡密】oai GP接马Free", "ready"],
    ["反重力antigravity 24小时自助代过 CDK激活（扫码接马激活代过）", "recharge"],
    ["gmail 短效验证码谷歌邮箱API-非分裂 接马邮箱", "api"],
    ["Codex 未接码成品号", "ready"],
    ["Codex 无需接码", ""],
    ["Codex 支持接码", ""],
    ["【自营源头】Plus半价资格号，无代充，无售后", "ready"],
    ["g皮t 首次激活码 正规官方 标准business（team），可无限续费", "cdk"],
    ["Claude 官网直充（免上号充值）", "recharge"],
    ["🏆【店铺自营·质保25天】ChatGPT Plus 帐号 · 美区长效实卡接码", "ready"],
    ["Gemini Ultra 20× 反重力额度独享 质保30天", "ready"],
    ["5天2次codex接码", "sms-service"],
    ["🗽秒接 无限换号码【五天】Codex🇺🇸手机接马验证（五天可接两次同一账号）", "sms-service"],
    ["Codex Free-接马-iCloud-精品-CDK", "ready"],
    ["随机地区 谷歌邮箱-（人机号)-需要手机号验证", "ready"],
    ["Gmail 临时邮箱自助获取和接码，只能用openai", ""],
  ])("商品 %s 应识别为 %s", (title, expected) => {
    expect(extractAttributes(title, "").attrType).toBe(expected);
  });

  it.each([
    ["Codex 接码服务", ""], ["K12 学生资格", ""],
    ["Gemini Advanced", ""], ["Gemini Pro", "pro"],
    ["GeminiPro 12个月", "pro"], ["CursorPro插件（月）", "pro"],
    ["Business 独享账号", "team"], ["Team 拼车", "team"],
    ["ChatGPT Plus 拼车（3 人团）｜一个月", "plus"],
    ["pro 200刀 两人拼车", "pro"],
    ["Microsoft Teams 账号", ""],
    ["Claude Max 5x", "pro5"], ["Claude Max 20x", "pro20"],
    ["Pro5×低价人工直冲", "pro5"], ["Codex Pro 20× 菲律宾区", "pro20"],
    ["claudemax5【美区直充】", "pro5"],
    ["1个月 PRO X5 CDK充值", "pro5"],
    ["【自营】Pro x20 速刷", "pro20"],
    ["Pro $200 原20x 官方充值 CDK", "pro20"],
    ["Pro 20x1个月", "pro20"],
    ["GPTPLUS独享", "plus"],
    ["GFree iCloud邮箱", "free"],
    ["Claude Pro20美元", "pro"],
    ["Claude Pro5折", "pro"],
    ["Pro500 直充 官方充值", "pro"], ["OpenAI Pro50x 月卡", "pro"],
    ["Pro200 菲律宾区 卡冲", "pro"], ["Pro 2026 订阅", "pro"],
    ["Claude Pro 20刀", "pro"],
    ["一个月G 5xPro 100刀", "pro5"], ["一个月G 20xPro 200刀", "pro20"],
    ["Codex Pro5xCDK", "pro5"], ["10xteam 长效车", "team"],
    ["Steam 账号", ""], ["ClaudeUltra 成品号", "ultra"],
    ["Gemini Ultra 20x", "ultra"], ["G Free 普号", "free"],
  ])("套餐 %s 应为 %s", (title, expected) => {
    expect(extractAttributes(title, "").attrPlan).toBe(expected);
  });

  it("禁止从店铺分类继承时长，并剔除日抛与 24 小时发货误判", () => {
    expect(extractAttributes("2个月plus账号", "日抛").attrDuration).toBe("");
    expect(extractAttributes("3个月plus账号", "GPT账号-日抛").attrDuration).toBe("quarter");
    expect(extractAttributes("4个月plus 单学生认证", "日抛系列").attrDuration).toBe("");
    expect(extractAttributes("ChatGPT Plus 日抛成品号｜质保首登", "G日抛").attrDuration).toBe("");
    expect(extractAttributes("成品号", "年卡").attrDuration).toBe("");
    expect(extractAttributes("【官方充值】菲区G plus cdk24小时（质保30天）", "").attrDuration).toBe("");
    expect(extractAttributes("反重力antigravity 24小时自助代过", "").attrDuration).toBe("");
    expect(extractAttributes("24小时自动发卡", "").attrDuration).toBe("");
    expect(extractAttributes("[保1天] Plus | 越南实卡渠道", "").attrDuration).toBe("");
    expect(extractAttributes("Gpro10X拼车两人车（质保订阅24小时）", "").attrDuration).toBe("");
    expect(extractAttributes("gro4.6 build号 质保一周｜自动发货", "").attrDuration).toBe("");
    expect(extractAttributes("Muse AI 成品号 已活一周", "").attrDuration).toBe("");
    expect(extractAttributes("Gemini-pro-充值到你的号上-质保半年", "").attrDuration).toBe("");
    expect(extractAttributes("G Plus 1个月充值【官方卡充｜菲区】", "").attrDuration).toBe("month");
    expect(extractAttributes("pro5X iOS官充（质保订阅1个月）", "").attrDuration).toBe("month");
    expect(extractAttributes("Gemini Ultra 20x 家庭组 1个月 质保订阅", "").attrDuration).toBe("month");
    expect(extractAttributes("Gemini Pro 6个月充值", "").attrDuration).toBe("half-year");
    expect(extractAttributes("Cursor 日卡 不换号", "").attrDuration).toBe("day");
    expect(extractAttributes("API 1天有效", "").attrDuration).toBe("day");
    expect(extractAttributes("Gemini 三个月优惠链接", "").attrDuration).toBe("quarter");
    expect(extractAttributes("Gemini Pro 六个月成品号", "").attrDuration).toBe("half-year");
    expect(extractAttributes("Gemini Pro一年 CDK充值", "").attrDuration).toBe("year");
    expect(extractAttributes("claude k12 成品号（不足一年/一年以上老号）", "").attrDuration).toBe("");
    expect(extractAttributes("千问 接马 美+1 15-30天", "").attrDuration).toBe("");
    expect(extractAttributes("谷歌Gemini Pro 成品号6-12个月Pro", "").attrDuration).toBe("");
    expect(extractAttributes("Free 2-3个月 半价资格号", "").attrDuration).toBe("");
    expect(extractAttributes("印度精养1年以上 api 直登", "").attrDuration).toBe("");
    expect(extractAttributes("Gemini Pro 3个月老号成品号", "").attrDuration).toBe("");
    expect(extractAttributes("7天内死了无限补", "").attrDuration).toBe("");
  });

  it("应正确清理零宽字符并保护接码类型不被店铺分类误覆盖", () => {
    expect(cleanProductName("SuperGro\u200bk Heavy 月卡\uFEFF")).toBe("SuperGrok Heavy 月卡");
    expect(extractAttributes("G\u200bPT Plus 卡\u200b冲 月卡", "")).toMatchObject({
      attrType: "recharge",
      attrPlan: "plus",
      attrDuration: "month",
    });
    expect(extractWarrantyText("成品号【质\u200b保30天】")).toBe("质保30天");
    expect(buildGroupKey("SuperGro\u200bk Heavy 月卡")).toBe(buildGroupKey("SuperGrok Heavy 月卡"));
    expect(extractAttributes("Codex 无需接码", "Codex接码").attrType).toBe("");
    expect(extractAttributes("G Free 已接马", "G接马")).toMatchObject({ attrType: "", attrSms: "done" });
    expect(extractAttributes("美+1 20-30天", "Codex接码")).toMatchObject({ attrType: "sms-service", attrSms: "" });
    expect(extractAttributes("【母号】iCloud隐私邮箱超稳邮箱0封号", "codex接马").attrType).toBe("ready");
    expect(extractAttributes("随机 2-4年邮箱 不包gcp", "Gemini/gmail邮箱/gmail邮箱接码").attrType).toBe("");
  });

  it.each([
    ["质保首登", "partial"], ["首登", ""], ["保订阅但不保封号", "partial"],
    ["封号不质保，保订阅30天", "partial"], ["无质保", "no"],
    ["无售后", "no"], ["质保30天", "yes"], ["订阅不保", ""],
  ])("售后声明 %s 应为 %s", (title, expected) => {
    expect(extractAttributes(title, "").attrWarranty).toBe(expected);
  });

  it.each([
    ["美区成品号", "us"], ["美国账号", "us"], ["账号地区：美国", "us"],
    ["美国IP注册成品号", ""], ["美国家宽注册账号", ""], ["日本实卡渠道成品号", ""],
    ["美区IOS渠道充值", ""], ["Codex 成品号 美国手机号", ""],
    ["美区账号 日本手机号", "us"], ["美区账号 日区账号", ""],
    ["Codex 接码服务 美国实卡", "us"], ["随机地区账号", "random"],
  ])("地区 %s 应保守识别为 %s", (title, expected) => {
    expect(extractAttributes(title, "").attrRegion).toBe(expected);
  });

  it("手机验证未知时不补成未验证，且不从分类补售后和地区", () => {
    expect(extractAttributes("成品号", "美区 已接码 有质保")).toMatchObject({ attrSms: "", attrWarranty: "", attrRegion: "" });
    expect(extractAttributes("已接码成品号", "").attrSms).toBe("done");
    expect(extractAttributes("未接码成品号", "").attrSms).toBe("pending");
    expect(extractAttributes("Codex 接码服务", "").attrSms).toBe("");
    expect(extractWarrantyText("Codex成品号【保订阅但不保封号】月卡")).toBe("保订阅但不保封号");
    expect(extractWarrantyText("Codex 成品号 无质保")).toBe("无质保");
    expect(extractWarrantyText("Cursor Pro 月卡 质保30天")).toBe("质保30天");
  });

  it("应对空输入与纯零宽字符串保持安全稳定", () => {
    expect(cleanProductName("")).toBe("");
    expect(cleanProductName("\u200B\uFEFF")).toBe("\u200B\uFEFF");
    expect(detectBrandGroup("", "")).toBe("其它");
    expect(detectBrandGroup("\u200B\u200D", "\uFEFF")).toBe("其它");
    expect(extractAttributes("", "")).toEqual({
      attrType: "",
      attrPlan: "",
      attrDuration: "",
      attrWarranty: "",
      attrSms: "",
      attrRegion: "",
    });
    expect(extractWarrantyText("")).toBe("");
    expect(buildGroupKey("")).toBe("unknown");
    expect(calculateMedian([])).toBe(0);
  });

  it("应精确过滤非可售测试/补差价/天价防拍占位商品且不误杀带免责词的真商品", async () => {
    const { isNonSalePlaceholderItem } = await import("../src/collector/etl/cleaner");
    const { isNonSalePlaceholderItem: localCheck } = await import("../scripts/lib/shopApiHelpers.mjs");

    const blockedCases: Array<[string, string, number | undefined]> = [
      ["测试商品 请勿拍", "卡密", 0.01],
      ["客服改价 补差价专用链接", "", 1],
      ["防失联公告", "公告", 1],
      ["此链接勿拍 联系客服", "", 10],
      ["【请勿拍】勿下单 测试", "", 5],
      ["ChatGPT Plus 月卡", "", 99999],
      ["ChatGPT Plus 月卡", "", 0],
      ["普通测试链接", "测试", 1],
    ];
    for (const [name, cat, price] of blockedCases) {
      expect(isNonSalePlaceholderItem(name, cat, price)).toBe(true);
      expect(localCheck(name, cat, price)).toBe(true);
    }

    const validCases: Array<[string, string, number]> = [
      ["ChatGPT Plus 独享月卡 会用，知道干啥用的拍，相反的勿拍", "AI账号", 135],
      ["Claude Pro 成品号 小白勿拍 介意勿拍", "Claude", 140],
      ["Codex 接码 美+1", "接码", 0.5],
      ["ChatGPT Plus 月卡", "测试", 125],
    ];
    for (const [name, cat, price] of validCases) {
      expect(isNonSalePlaceholderItem(name, cat, price)).toBe(false);
      expect(localCheck(name, cat, price)).toBe(false);
    }
  });
});
