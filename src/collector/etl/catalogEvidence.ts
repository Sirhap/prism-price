import type { ProductGroup } from "../../types";

interface CatalogRule {
  group: ProductGroup;
  ruleId: string;
  title: RegExp;
  category?: RegExp;
  useFullTitle?: boolean;
}

const RULES: readonly CatalogRule[] = [
  { group: "中转", ruleId: "explicit-directory-credit", title: /^\d+(?:\.\d+)?\s*(?:刀|元|美元|美金|usd)\s*(?:余额|额度)?$/, category: /^(?:api满血|ai\s*api额度|mintapi充值)$/ },
  { group: "中转", ruleId: "relay-exchange-denomination", title: /^\d+(?:\.\d+)?\s*元\s*\d+(?:\.\d+)?\s*刀$/, category: /^中转站兑换码$/ },
  { group: "中转", ruleId: "new-api-credit-directory", title: /^\d+(?:\.\d+)?\s*(?:\$|刀|元)$/, category: /^new[- ]api[- ]兑换码$/ },
  { group: "中转", ruleId: "relay-plan-directory", title: /^\d+\s*coding[- ]plan\b/, category: /^中转\s*token$/ },
  { group: "中转", ruleId: "relay-station-directory", title: /^(?:[a-z]\s*[-·]\s*\d+\s*刀|\d+\s*刀\s*面额\s*cdk|[a-z][a-z\d ]{2,20}\d+\s*w?积分)$/, category: /^(?:api\s*中转站|api\s*站点|(?:kimera|奇美拉)中转站额度)$/ },
  { group: "中转", ruleId: "relay-brand-credit-directory", title: /^揽星好转\s*\/\s*余额\s*\(\s*\d+\s*刀\s*\)$/, category: /^揽星\s*\(中转\)$/ },
  { group: "中转", ruleId: "relay-provider-recharge", title: /^(?:sub2api\s*\d+\s*r|\d+(?:\.\d+)?\s*刀\s*g\*t\s*定价|轰炸鸭\s*\(充\d+|api\s*g\s*充值\s*试用|ai来了\s*\d+\s*刀\s*试用)/, category: /^(?:中转站|g中转|中转额度|中转|ai来了中转站套餐\s*官方倍率)$/ },
  { group: "AI视频", ruleId: "video-credit-directory", title: /^\d+(?:\.\d+)?\s*(?:积分|点数)$/, category: /^(?:see\s*dance\s*[-·]?\s*生成视频|视频生成)\s*(?:积分|点数|额度)$/ },
  { group: "AI视频", ruleId: "video-creation-app", title: /^(?:【[^】]{1,10}】\s*)?(?:higgsfield\s*(?:ultra|pro)\b|dreamina\s*(?:basic|pro)\b.{0,75}seedance)/, category: /^(?:higgsfield|视频ai账号)$/, useFullTitle: true },
  { group: "AI绘图", ruleId: "image-credit-directory", title: /^(?:\d+\s*元\s*\d+\s*积分|\d+\s*\/\s*月\s*\(每天\s*\d+\s*积分\))$/, category: /^g?\s*image\s*2(?:\.\d+)?\s*积分(?:购买)?$/ },
  { group: "软件工具", ruleId: "known-app-subscription", title: /^(?:coursera\s*(?:plus|premium)|elevenreader\s*(?:plus|ultra))\b[^|]{0,28}(?:账号|成品|订阅|[月季年]卡|\d+\s*年)/ },
  { group: "软件工具", ruleId: "known-app-license", title: /^(?:windows\s*(?:10\/11|10|11)\s*教育版\s*激活码|微软\s*teams\s*高级版|looprec\s*录音激活码|安卓软件分身|android软件分身|闲鱼(?:自动发货系统|分身)|出片工坊软件|豆包账号管理器|跨网盘转存.{0,8}批量分享)/ },
  { group: "软件工具", ruleId: "app-source-directory", title: /^鸿蒙.{1,10}\bapp\b/, category: /^(?:项目代码|项目源码)$/ },
  { group: "软件工具", ruleId: "software-platform-credits", title: /^\d+\s*积分$/, category: /^dataclaw\s*积分组$/ },
  { group: "数字素材", ruleId: "asset-library-subscription", title: /^(?:【|\[)?envato(?:\s*elements)?(?:】|\])?\s*(?:[月季年]卡|订阅)\s*$/ },
  { group: "游戏商品", ruleId: "named-game-license", title: /^(?:安卓小黑屋(?:天|周|月|季|年|永久)卡|一键吃丹\s*ios\s*[-·]?\s*[天周月]卡|王牌战争.{0,18}(?:地基|机库文件))/ },
  { group: "游戏商品", ruleId: "game-license-directory", title: /^(?:ios\s*max\s*(?:天卡|永久单开)|地铁三开永久卡|\(朱雀\)\s*pc\s*永久卡)$/, category: /^(?:吃丹修仙苹果|游戏辅助(?:\([^)]*\))?)$/ },
  { group: "平台账号", ruleId: "social-account-deliverable", title: /^x\s*定制[^|]{0,16}老号|^(?:美区|美国)?\s*(?:amazon|亚马逊)(?:\s*亚马逊)?\s*买家(?:新|老)号/ },
  { group: "平台账号", ruleId: "social-account-age-directory", title: /^美区快满\d+年号权重高$/, category: /^tiktok(?:账号|\/x等社交账号|\/instagram\/x等账号)?$/ },
  { group: "平台账号", ruleId: "regional-apple-account", title: /^(?:平果\s*id\s*[|·]\s*独享老密保号|(?:【(?:韩国|日本)区id】).*账号.*(?:可下app|开ic))/, category: /^(?:账号|id|苹果\s*id)$/ },
  { group: "平台账号", ruleId: "apple-account-directory", title: /^(?:【无密保\/api\/可下app】\s*(?:美国|美区)|【平板端】\s*质保\d+天秒出|美区【\d+[-~]\d+年独享永久】)/, category: /^(?:apple\s*id|苹果\s*id)$/ },
  { group: "邮箱账号", ruleId: "mailbox-age-directory", title: /^(?:谷歌注册时间\s*\d+\s*[-~至]\s*\d+\s*年的|随机地区混装地区\d+\s*[-~至]\s*\d+\s*年)/, category: /(?:^|[（(\s·])(?:邮箱(?:email|资源)?|谷歌邮箱)(?:$|[（(\s·])/ },
  { group: "接码服务", ruleId: "single-phone-verification", title: /^(?:code\s*验证美区一次性接(?:m|马|码)|万能号.{0,44}接[码马碼].{0,32}一次性)/, category: /^(?:g长效接马|接马|手机号资源|sms接马|接马服务|手机接码)$/, useFullTitle: true },
  { group: "接码服务", ruleId: "verification-number-directory", title: /^美区虚拟号[^|]{0,24}接[码马]/, category: /^(?:sms接马|接马服务|手机接码)$/, useFullTitle: true },
  { group: "虚拟卡", ruleId: "virtual-card-deliverable", title: /^高质量虚拟信用\s*卡\s*vcc\b/ },
  { group: "虚拟卡", ruleId: "verification-card-directory", title: /^(?:一刀验证卡|\d{6}\s*\$\s*0\s*试用卡)/, category: /^(?:visa\s*虚拟(?:卡)?|虚拟卡)$/ },
  { group: "手机卡", ruleId: "sim-credit-and-plan", title: /^\d+(?:\.\d+)?\s*美金\s*(?:月租套餐[^|]{0,40}短信[^|]{0,16}通话|话费充值)$/, category: /^(?:美(?:区|国)?\s*实卡号|美国实体卡)$/ },
  { group: "工具教程", ruleId: "verification-comparison-guide", title: /^(?:接[码马]网站\s*)?\d+\s*家(?:接[码马]网站|短信平台)价格对比$/, category: /^知识付费$/ },
  { group: "代理IP", ruleId: "proxy-flow-directory", title: /^(?:月卡\s*\d+\s*g(?:b)?|魔法\s*\(带一个月流量\)|(?:高阶|进阶)魔法套餐)$/, category: /^(?:魔法梯子|科学工具)$/ },
  { group: "ChatGPT", ruleId: "openai-official-tier-recharge", title: /^pro\s*\$?200\s*原\s*20\s*[x×]\s*官方充值\s*cdk/, category: /^(?:其他ai|直充代充|ai订阅\/cdk|🐣pt-pro\(官冲\))$/ },
  { group: "ChatGPT", ruleId: "openai-pro-directory-recharge", title: /^g\s*(?:200|500)\s*pro\s*(?:代开|续费)/, category: /^pro$/ },
  { group: "ChatGPT", ruleId: "openai-recharge-directory", title: /^(?:go\s*卡密充值|(?:【[^】]{1,15}】\s*)?(?:正规\s*)?ios\s*(?:官方充值|官充))/, category: /^(?:官方直冲g\s*会员充值|【?g\s*plus】?)$/ },
  { group: "ChatGPT", ruleId: "openai-stock-account-directory", title: /^(?:顶级free\s*成品已接[码马]|临期\s*pro20\s*不给账密只给json)/, category: /^g(?:自助充值|账号)$/ },
  { group: "Gemini", ruleId: "google-ai-family-seat", title: /^(?:slot\s*veo\s*3\s*ultra\s*x20\b|共享\d+(?:万)?积分[^|]{0,26}gemini\s*google\s*ai\s*ultra).{0,40}家庭组/, useFullTitle: true },
];

/** Supplement title classification only when a missing subject has positive evidence. */
export function matchCatalogEvidence(title: string, category: string, fullTitle: string) {
  return RULES.find(rule => rule.title.test(rule.useFullTitle ? fullTitle : title) &&
    (!rule.category || rule.category.test(category)));
}
