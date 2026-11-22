import { describe, expect, it } from "vitest";
import { classifyProduct, normalizeOffer } from "../src/collector/etl/cleaner";

describe("主商品与规格证据", () => {
  it.each([
    ["ChatGPT Plus 成品号 | 赠虚拟卡教程 | 美国IP注册", "虚拟卡", "ChatGPT", { attrType: "ready", attrPlan: "plus", attrRegion: "" }],
    ["虚拟卡｜适用 ChatGPT Plus", "ChatGPT", "虚拟卡", { attrPlan: "" }],
    ["苹果美区礼品卡｜适用 ChatGPT 订阅", "ChatGPT", "其它", { attrPlan: "" }],
    ["ChatGPT Plus / Claude Pro 双会员套装", "精选福利", "其它", { attrType: "", attrPlan: "" }],
    ["Codex 中转 API 10刀直充", "Codex", "中转", { attrType: "api", attrPlan: "" }],
    ["月卡 24小时自动发货", "ChatGPT / Claude / Gemini 全品类", "其它", { attrDuration: "month", attrPlan: "" }],
    ["月卡", "Gemini", "Gemini", { attrDuration: "month", attrPlan: "" }],
    ["100", "G Plus", "其它", { attrDuration: "", attrPlan: "" }],
    ["Gemini Pro / Ultra 月卡 / 季卡", "", "Gemini", { attrPlan: "", attrDuration: "" }],
    ["Gemini Pro 3个月卡密｜不含Ultra｜不支持年卡", "", "Gemini", { attrPlan: "pro", attrDuration: "quarter" }],
    ["反重力 xiaomi 3个月 Pro 成品号（随机地区，可用 Claude Opus5.5）", "", "Antigravity", { attrType: "ready", attrPlan: "pro", attrDuration: "quarter", attrRegion: "random" }],
    ["Claude Pro 账号 | 已接码 | 24小时自动发货 | 质保7天", "", "Claude", { attrType: "ready", attrSms: "done", attrDuration: "" }],
    ["ChatGPT Plus 成品号｜已稳定30天", "", "ChatGPT", { attrDuration: "" }],
    ["苹果美区礼品卡", "平台账号", "其它", { attrType: "", attrPlan: "" }],
    ["PLUS成品号-iCloud/Gmail邮箱-质保首登-未接马", "G plus", "ChatGPT", { attrType: "ready", attrSms: "pending" }],
    ["Claude 20X卡付代充【虚拟卡，仅老号可用】", "Claude", "Claude", { attrType: "recharge" }],
    ["Google AI Ultra 20x｜Antigravity反重力｜家庭组车位", "Gemini", "Gemini", { attrType: "ready", attrPlan: "ultra" }],
    ["Antigravity Gemini Pro 12个月成品号", "Gemini", "Antigravity", { attrType: "ready", attrPlan: "pro", attrDuration: "year" }],
    ["国产大模型 GLM5.2 API 一亿token", "API中转站", "中转", { attrType: "api" }],
    ["百度文库会员 月卡", "百度文库", "软件工具", { attrDuration: "month" }],
    ["其余全国流量卡", "低价流量卡", "手机卡", { attrType: "" }],
    ["高品质个人Gmail谷歌邮箱｜含GCP支持", "Gemini", "邮箱账号", { attrPlan: "" }],
    ["OpenAI账号转移用｜微软空邮箱 Outlook", "邮箱", "邮箱账号", { attrPlan: "" }],
    ["【Facebook】老号｜2FA｜临时邮箱交付｜美国家宽", "海外平台", "平台账号", { attrType: "ready" }],
    ["【X账号】2019年注册｜Hotmail邮箱交付", "社交账号", "平台账号", { attrType: "ready" }],
    ["中文区蓝V成品 X（T-witter）账号 380+粉丝", "社交账号", "平台账号", { attrType: "ready" }],
    ["example.test MCP 插件密钥7天", "AI订阅/cdk", "软件工具", {}],
    ["3000积分", "Seedance-生成视频积分", "AI视频", { attrType: "" }],
    ["3000分", "Seedance-生成视频积分", "其它", { attrType: "" }],
    ["3000分", "其它", "其它", { attrType: "" }],
    ["95元100刀", "中转站兑换码", "中转", { attrType: "api" }],
    ["95元100刀", "其它", "其它", { attrType: "" }],
    ["20 coding-plan，cc", "中转token", "中转", { attrType: "api" }],
    ["50元余额", "MintAPI充值", "中转", { attrType: "api" }],
    ["6元100积分", "Gimage2积分购买", "AI绘图", {}],
    ["Coursera Premium 1年 独享成品号", "学习与办公", "软件工具", { attrDuration: "year" }],
    ["ElevenReader Ultra 年卡，12个月", "学习教育", "软件工具", { attrDuration: "year" }],
    ["【Envato】季卡", "Env", "数字素材", { attrDuration: "quarter" }],
    ["安卓小黑屋周卡", "其他", "游戏商品", { attrDuration: "week" }],
    ["iOS MAX 天卡", "吃丹修仙苹果", "游戏商品", { attrDuration: "day" }],
    ["美区虚拟号，专用Gmail接马", "sms接马", "接码服务", { attrType: "sms-service" }],
    ["接马网站7家短信平台价格对比", "知识付费", "工具教程", { attrType: "tutorial" }],
    ["美区快满2年号权重高", "TikTok账号", "平台账号", {}],
    ["发票整理工具", "软件", "软件工具", {}],
    ["【月卡】短链生成服务", "短连生成服务", "软件工具", { attrDuration: "month" }],
    ["短链生成工具配置教程", "软件", "工具教程", { attrType: "tutorial" }],
    ["PLUS 独享成品月卡｜越南 Visa 实卡开通｜质保首登", "越南渠道", "ChatGPT", { attrType: "ready", attrPlan: "plus" }],
    ["G·rok·X·Cursor 三合一订阅 Premium", "Cursor", "其它", { attrType: "", attrPlan: "" }],
    ["Gro+ Cursor Premium 14D", "Grok", "其它", { attrType: "", attrPlan: "" }],
    ["Gr✱k super会员月卡 Gr✱k Bot智能体 15倍额度", "", "Grok", { attrDuration: "month" }],
    ["Gemini pro反重力antigravity独享会员【仅带RT】", "Gemini", "Antigravity", { attrPlan: "pro" }],
    ["Codex GPro 5X（官方代充）", "G", "Codex", { attrType: "recharge", attrPlan: "pro5" }],
    ["Google Gmail 手机短效验证码", "谷歌邮箱", "接码服务", { attrType: "sms-service" }],
    ["GPT Plus网页镜像", "ChatGPT", "中转", { attrType: "api", attrPlan: "" }],
    ["Claude 镜像站 Pro 天卡（试用卡）", "Claude 账号与订阅", "中转", { attrType: "api", attrPlan: "" }],
    ["Grok / X / Cursor 三合一订阅", "Grok", "其它", { attrType: "", attrPlan: "" }],
    ["G2ok旧版 Super充值码30美元一个月的不包含Cursor/X Premium/ 非全家桶", "Cursor", "Grok", { attrType: "recharge", attrDuration: "month" }],
    ["Grok Super 月卡，不包含 Cursor / X Premium | Claude Pro 月卡 双订阅套装", "Grok", "其它", { attrType: "", attrPlan: "" }],
    ["【4个月成品Codex已接🐎】G Plus成品 质保24小时", "Codex", "ChatGPT", { attrType: "ready", attrSms: "done" }],
    ["11.22老号[反重力成品] Gemini Pro 带RT凭证｜已过Antigravity验证", "Gemini", "Antigravity", { attrType: "ready", attrPlan: "pro" }],
    ["Gemini Pro 成品｜反重力成品号｜已过验证带RT｜三个月", "Gemini Pro 成品", "Antigravity", { attrType: "ready" }],
    ["Go CDK24小时（质保30天）正规充值", "G-代充", "ChatGPT", { attrType: "recharge" }],
    ["10刀", "API中转站", "中转", { attrType: "api" }],
    ["10刀", "中转站 / G成品号", "其它", { attrType: "" }],
    ["周包（日限额50刀）", "API中转套餐", "中转", { attrType: "api" }],
    ["新版 $0试用卡", "接马", "其它", { attrType: "" }],
    ["451311 $0试用卡", "支付卡与试用验证卡", "虚拟卡", { attrPlan: "" }],
    ["KROPRO+2K积分已开启超额", "Cursor Kiro 系列", "Kiro", { attrPlan: "pro" }],
    ["Lovable Pro 月卡独享成品号", "视频AI账号", "软件工具", { attrType: "ready" }],
    ["GP Plus 官方充值 菲区 质保订阅30天", "Codex｜直充", "ChatGPT", { attrType: "recharge", attrPlan: "plus" }],
    ["G+p·t Free 成品号 Outlook 邮箱｜已接马｜支持 Codex", "G Free", "ChatGPT", { attrType: "ready", attrPlan: "free", attrSms: "done" }],
    ["Claude Max 20x 成品免K 域名邮箱", "邮箱", "Claude", { attrType: "ready", attrPlan: "pro20" }],
    ["5xteam二车｜Gmail 邮箱｜发账密", "Team", "ChatGPT", { attrType: "ready", attrPlan: "team" }],
    ["iCloud 临时子邮箱注册 OpenAI 专用", "微软邮箱", "邮箱账号", {}],
    ["Google 普号｜美区老号", "Google", "平台账号", { attrType: "ready" }],
    ["Leonardo 8500分成品号（含 Seedance 2.0 视频）", "视频与设计", "AI绘图", { attrType: "ready" }],
    ["京东Plus会员 年卡", "京东", "生活优惠", { attrDuration: "year" }],
    ["幼年绿色霸王龙【3D版】", "背景挂饰", "数字素材", {}],
    ["Codex 教学视频", "接码", "工具教程", { attrType: "tutorial", attrPlan: "", attrSms: "" }],
  ])("%s", (title, category, group, fields) => {
    const result = classifyProduct(title, category);
    expect(result.brandGroup).toBe(group);
    expect(result.attributes).toMatchObject(fields);
  });
});

const pairs = [
  ["ChatGPT Plus 成品号 月卡", "ChatGPT Plus 成品号 月卡", true],
  ["Codex Pro 20x 月卡", "Codex Pro 20x 月卡", true],
  ["Gemini Pro 三个月卡密 xiaomi", "Gemini Pro 三个月卡密 xiaomi", true],
  ["Codex 接码服务 美区", "Codex 接码服务 美区", true],
  ["网易云音乐会员月卡", "网易云音乐会员月卡", true],
  ["Visa 虚拟卡 0刀", "Visa 虚拟卡 0刀", true],
  ["Steam 账号", "Steam 账号", true],
  ["Claude Max 20x", "Claude Max 5x", false],
  ["Gemini Pro 月卡", "Gemini Ultra 月卡", false],
  ["Gemini Pro 月卡", "Gemini Pro 季卡", false],
  ["ChatGPT Plus 20-30天", "ChatGPT Plus 2030天", false],
  ["Claude Pro 1.5个月", "Claude Pro 15个月", false],
  ["Claude Pro 美区成品号", "Claude Pro 日区成品号", false],
  ["Codex 已接码成品号", "Codex 未接码成品号", false],
  ["Codex 接码服务", "Codex 接码教程", false],
  ["Gemini Pro 成品号", "Gemini Pro 代充", false],
  ["成品号", "成品号", false],
  ["ChatGPT Plus / Claude Pro 双会员套装", "ChatGPT Plus / Claude Pro 双会员套装", false],
  ["Gemini Pro / Ultra 月卡", "Gemini Pro / Ultra 月卡", false],
  ["ChatGPT Plus 月卡 / 年卡", "ChatGPT Plus 月卡 / 年卡", false],
] as const;

const titleVariants = [
  (value: string) => value,
  (value: string) => "🔥" + value,
  (value: string) => "【" + value + "】",
  (value: string) => value.toUpperCase(),
  (value: string) => " " + value + " ",
  (value: string) => value.replaceAll(" ", "　"),
  (value: string) => value.replace(/[A-Za-z0-9]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0xfee0)),
  (value: string) => Array.from(value).join("\u200b"),
];

function offerKey(shopId: string, title: string) {
  return normalizeOffer(shopId, {
    itemKey: "sample", rawName: title, shopCategory: "", price: 10,
    stockCount: 1, stockStatus: "low", itemUrl: "",
  }, "").groupKey;
}

describe("同款判定 20 对人工定义场景 × 8 种标题表记", () => {
  it.each(pairs.flatMap(([left, right, same]) => titleVariants.map((format, index) =>
    [left, right, index, same, format] as const)))("%s / %s（表记 %i，应合并 %s）", (left, right, _, same, format) => {
    expect(offerKey("shop-a", left) === offerKey("shop-b", format(right))).toBe(same);
  });
});

it("同名中转周包按报价独立成组", () => {
  const offer = {
    itemKey: "sample", rawName: "周包（日限额50刀）", shopCategory: "API中转套餐",
    price: 10, stockCount: 1, stockStatus: "low" as const, itemUrl: "",
  };
  const first = normalizeOffer("shop-a", offer, "");
  const second = normalizeOffer("shop-b", offer, "");
  expect(first.brandGroup).toBe("中转");
  expect(first.groupKey).not.toBe(second.groupKey);
});


describe("公开详情补充证据", () => {
  it.each([
    ["3000分", "Seedance-生成视频积分", "兑换后获得可用于 Seedance 生成视频的积分。", "AI视频"],
    ["2000元余额", "", "购买后去中转站兑换即可。", "中转"],
    ["120 刀", "AI与效率", "官方 Plus 整周限额 120 刀，这里可起步测试。API网站：[隐藏]", "中转"],
    ["地区混装 1-10 年", "邮箱", "发货格式 邮箱-密码-辅助邮箱-二级密码。高质量精品邮箱，保登录。", "邮箱账号"],
    ["【韩国区ID】【半年账号可改密码/带密保/可下APP】", "软件工具",
      "发货格式为：账号----密码----密保信息 请在苹果的应用商店登录（App Store）。", "平台账号"],
    ["【土耳其】ID账号｜个人独享｜带密保", "平 🍎果 ID",
      "ID地区：土耳其区。iCloud：未开通。AppStore商店：已过检查，可下载APP。卡密格式：账号----密码 密保。", "平台账号"],
    ["余额兑换卡 · 体验卡 ¥5", "余额卡",
      "到账：$5。支持模型：GPT、Claude、Gemini。兼容接口：OpenAI 标准 API。", "中转"],
    ["[独家技术] MAX 5×[有条件的质保封号]", "Claude", "需要实付125美元，支付通道有手续费，请提前过KYC再来充值。", "Claude"],
    ["5X 100 美刀官方充值", "直充代充", "自己的账号可以充值。如果已有 Plus 可升级，本商品开通全新的 5x 订阅。", "ChatGPT"],
  ])("根据详情确认 %s 的交付分类", (title, category, description, group) => {
    expect(classifyProduct(title, category, description)).toMatchObject({ brandGroup: group, evidence: "detail" });
  });

  it("说明明确不提供中转站时保留其它", () => {
    expect(classifyProduct("50刀", "其他", "本商品不提供中转站。购买前请联系商家。").brandGroup).toBe("其它");
  });

  it("余额卡需要明确的 API 交付证据", () => {
    const title = "余额兑换卡 · 体验卡 ¥5";
    expect(classifyProduct(title, "余额卡", "到账：$5。本商品不兼容接口：OpenAI 标准 API。").brandGroup).toBe("其它");
    expect(classifyProduct(title, "余额卡", "兼容接口：OpenAI 标准 API。具体到账金额请咨询商家。").brandGroup).toBe("其它");
  });

  it("确认镜像站兑换码实际是多模型服务", () => {
    const result = classifyProduct("Claude 体验天卡", "", "本商品提供中转站的试用服务，一张兑换码可调用所有模型。");
    expect(result).toMatchObject({ brandGroup: "中转", evidence: "detail", isolateOffer: true, attributes: { attrType: "api" } });
  });

  it("邮箱说明中的邮件验证码不会被当成手机接码", () => {
    const result = classifyProduct("iCloud 隐私邮箱", "邮箱", "本商品提供独立邮箱，有效期内接收验证码，服务到期后邮箱不可用。");
    expect(result.brandGroup).toBe("邮箱账号");
  });

  it("成品账号的辅助验码不改变交付主体", () => {
    const result = classifyProduct("GPT Plus 成品号", "成品", "购买后接收验证码，有效期1小时。发货格式为 ChatGPT Plus 账号。");
    expect(result.brandGroup).toBe("ChatGPT");
  });
});
