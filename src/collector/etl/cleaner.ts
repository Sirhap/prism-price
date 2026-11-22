import type { NormalizedOffer, ProductGroup, RawOfferItem } from "../../types";
import { matchBrandRules, normalizeMatchText } from "./brandClassifier";
import { matchCatalogEvidence } from "./catalogEvidence";
import { accountSubject, canonicalSubjectText, hasNamedMultiProductBundle, MULTI_PRODUCT_BUNDLE, openAiSubject, withoutBundleExclusions } from "./subjectEvidence";

/**
 * 零宽、双向控制符及不可见变体选择符正则（与品牌匹配器保持一致）
 */
const ZERO_WIDTH_STRIP_RE = /[\u061C\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFE00-\uFE0F\uFEFF\u00AD\u034F\u180E]/g;

/**
 * 卖家常见的免责噪音短语正则（仅用于展示清洗，不影响检索与原始记录）
 */
const NOISE_PATTERNS: RegExp[] = [
  /会用[，,]?\s*知道干啥用的拍[，,]?\s*相反的勿拍/g,
  /知道干啥用的拍/g,
  /相反的勿拍/g,
  /介意者?勿拍/g,
  /懂[得的]?拍/g,
  /没技术勿拍/g,
  /小白勿拍/g,
  /不接受不要下/g,
];

/**
 * 清洗商品标题展示名称（去除 emoji、零宽字符、口语噪音及悬空标点）
 */
export function cleanProductName(rawName: string): string {
  const original = String(rawName || "");
  let text = original;

  // 去除 Emoji 与装饰符号及零宽防抓取字符
  text = text.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\uFE0F\u200D]/gu, "");
  text = text.replace(ZERO_WIDTH_STRIP_RE, "");
  // 全角空格转为半角
  text = text.replace(/\u3000/g, " ");
  // 去除免责噪音短语
  for (const pattern of NOISE_PATTERNS) {
    text = text.replace(pattern, "");
  }
  // 清理被掏空的括号
  text = text.replace(/（\s*[、，,；;\s]*）/g, "");
  text = text.replace(/\(\s*[、，,;\s]*\)/g, "");
  text = text.replace(/【\s*[、，,；;\s]*】/g, "");
  text = text.replace(/\[\s*[、，,;\s]*\]/g, "");
  // 折叠连续分隔符
  text = text.replace(/-{2,}/g, " ");
  text = text.replace(/[、，,]{2,}/g, "，");
  text = text.replace(/\s{2,}/g, " ");
  // 去除首尾悬空标点
  text = text.replace(/^[\s、，,；;·\-—|/]+/, "").replace(/[\s、，,；;·\-—|/]+$/, "");
  text = text.trim();

  return text || original;
}

const STRONG_PLACEHOLDER_PATTERNS: ReadonlyArray<RegExp> = [
  /(?:测试专用链接|纯属测试|仅供测试|测试商品请勿拍|测试商品|此链接勿拍|勿拍链接|请勿下单|严禁下单|防失联公告|店铺公告请勿拍|通知勿拍)/i,
  /(?:^|[\s【\[（(])(?:补差价|差价专用|差价链接|客服改价|专拍链接|定制改价|邮费补拍|运费补差|拍前改价|定金链接)(?:$|[\s】\]）)!！。.,，])/i,
  /(?:^|[\s【\[（(])(?:请勿拍|不要拍|别拍|勿下单|请勿购买|公告勿拍|仅公告)(?:$|[\s】\]）)!！。.,，])/i,
  /^(?:差价|补差价专用(?:链接)?|升级补差价专用|补单[（(]勿直拍[）)]|临时订单|勿拍|测试勿拍|测试专用\s*勿拍|开票须知|乞讨(?:专用|用的)不发货)$/i,
  /^(?:赞助搬运工\s*[-—]\s*\d+(?:\.\d+)?|【勿买】流量商品[，,]不发货.*)$/i,
];

const PLACEHOLDER_CATEGORY_RE = /^(?:测试|测测试|测试分类|公告|店铺公告|防失联|改价|差价|补差价|专拍)$/i;
const REAL_PRODUCT_HINT_RE = /(?:chatgpt|gpt|codex|claude|gemini|grok|cursor|kiro|muse|antigravity|deepseek|api|中转|卡密|月卡|季卡|年卡|周卡|日卡|账号|成品|独享|共享|代充|直充|兑换|邮箱|gmail|outlook|visa|master|接码|接马|plus|pro|ultra|team|max)/i;

/**
 * 判断源站条目是否为非实际可售的测试、公告、补差价或天价防拍占位项。
 * 说明：会谨慎避开“小白勿拍 / 相反的勿拍”等真实商品标题中的卖家免责词。
 */
export function isNonSalePlaceholderItem(
  rawName: string,
  shopCategory = "",
  price?: number,
): boolean {
  if (price !== undefined && (!Number.isFinite(price) || price <= 0 || price >= 99999)) {
    return true;
  }

  const normalizedName = String(rawName || "").replace(ZERO_WIDTH_STRIP_RE, "").trim();
  if (!normalizedName) {
    return true;
  }

  if (STRONG_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalizedName))) {
    return true;
  }

  const normalizedCategory = String(shopCategory || "").replace(ZERO_WIDTH_STRIP_RE, "").trim();
  if (normalizedCategory && PLACEHOLDER_CATEGORY_RE.test(normalizedCategory) && !REAL_PRODUCT_HINT_RE.test(normalizedName)) {
    return true;
  }

  return false;
}

/** 识别以教程为商品主体的标题，排除账号等商品附带或提示查看教程的描述。 */
function isTutorialProduct(rawName: string): boolean {
  const text = normalizeMatchText(rawName)
    .replace(/(?:附带|附赠|附|赠送|赠|自带|含|包含|提供|参考)[^\n|｜，,。]{0,20}(?:教程|教学视频|课程)/g, "")
    .replace(/(?:查看|请看|拍前看|先看|看)(?:商品简介|使用|配置|介绍)?(?:教程|教学视频|课程)/g, "");
  if (/组合包/.test(text) && /教程\s*[+＋]\s*插件/.test(text)) return false;
  return /教程|教学视频|教学课程|视频课程|图文教学/.test(text);
}

/** 接码商家常用表情、繁体或插入符号避敏；仅用于识别，不改变原始名称。 */
function normalizeSmsText(value: string): string {
  return normalizeMatchText(value)
    .replace(/接\s*[🐎🐴]/gu, "接马")
    .replace(/接\s*[*·•:：-]\s*[码馬马碼玛]/gu, "接码")
    .replace(/接\s*[碼玛]/gu, "接码");
}

/** 不仅凭店铺目录名将商品认定为接码，标题必须有独立接码或号码验证线索。 */
function hasIndependentSmsClue(value: string): boolean {
  return /(?:接[码马]|接ma|接(?:收)?验证码|短信验证码|手机(?:号)?短效验证码|手机(?:号)?验证|短信(?:接|收|验证)|手机号?[^|｜\n]{0,10}短信[^|｜\n]{0,10}短效|美\+1|实卡[^|｜\n]{0,10}(?:单次验证|接码|接马)|登录验证[^|｜\n]{0,12}实卡)/.test(value);
}

function isPhysicalSimProduct(value: string): boolean {
  return /(?:giffgaff|实体手机卡|实体sim卡)/i.test(value) && !/(?:接码服务|接马服务|短信接码|接码平台)/.test(value);
}

export interface ExtractedAttributes {
  attrType: string;
  attrPlan: string;
  attrDuration: string;
  attrWarranty: string;
  attrSms: string;
  attrRegion: string;
}

/**
 * 明确账号成品、拼车与席位等使用权形态的正则（排除“同一账号/自己账号”等代充或接码对象描述）
 */
const ACCOUNT_ENTITY_RE =
  /(?:(?<!非)成品|(?<!同一|自己|个人|原有|原|每个|单个|自备|你的|您的|现有|提供)(?:账号|账户|帐号|帐户)|老号|新号|白号|独享号|共享号|成号|大额号|资格号|半成品|母号|子号|人机号|人机邮箱|隐私邮箱|拼车|席位|车位|车头|长效车|头车|二车|三车|首车|发车|(?<!非)家庭组|合租|(?:\d+|一|两|二|三|四|五|六|七|八|九|十)人(?:车|拼车|团)|free号|普号|接[码马]free|free[-_\s]*接(?:码|马|ma)|账密|2fa|长效不踢|额度号|令牌号)/;

/**
 * 表明商品并非独立接码服务（而是已/未接码账号、自备接码、邮箱载体或代过激活）的排除正则
 */
const SMS_SERVICE_EXCLUSION_RE =
  /(已接[码马]|已接ma|已经接[码马]|已过接(?:码|马|ma)|未接[码马]|未接ma|已绑手机|未绑手机|(?:无需|不用|需要|需|自行|自己|自备|已|未)接(?:收)?验证码|需自备接[码马]|无需接[码马]|不用接[码马]|支持接[码马]|可接[码马]|需接[码马]|需要接[码马]|必须要?接(?:码|马|ma)|需要?手机号?验证|需要?手机验证|需自行接[码马]|自行接[码马]|自己接[码马]|自备接[码马]|双接[码马]|带长效接[码马]|带[^|｜\n]{0,12}接(?:码|马|ma)链接|代过|自由接[码马]|自带接[码马]|带接[码马]|含接[码马]|接[码马]邮箱|临时邮箱)/;

/**
 * 独立接码服务信号正则（覆盖全品牌、次数搭配品牌、地区实卡及多种接码/接马/接ma表达）
 */
const SMS_SERVICE_SIGNAL_RE =
  /(接码服务|接马服务|接(?:收)?验证码|手机号?[^|｜\n]{0,10}短信[^|｜\n]{0,10}短效|短信接(?:码|马|ma)|手机接(?:码|马|ma)|接(?:码|马|ma)验证|长效接[码马]|短效接[码马]|单次接[码马]|一次性接[码马]|卖接[码马]|手机号?验证|短信验证|手机(?:号)?短效验证码|短信收码|(?:\d+|一|两|二|三|五|十|多|无限)次[^\n|｜]{0,12}接(?:码|马|ma)|注册接(?:码|马|ma)|全球接(?:码|马|ma)|手机[^|｜\n]{0,16}接(?:码|马|ma)|实卡[^|｜\n]{0,16}接(?:码|马|ma)|接(?:码|马|ma)[^|｜\n]{0,24}(?:美\+?1|实卡|美国|全球|印尼|哥伦比亚|英国|香港|菲律宾|日本|加拿大|自动换号|质保不来码|不来码|cdk|api|有效期内|二次验证|高成功率|自主换号|换号|一次|长效|短效|美区))/;

/**
 * 非账号/套餐语境下的兜底接码服务排除关键词
 */
const SMS_SERVICE_FALLBACK_EXCLUDE_RE = /(?:free|icloud|outlook|hotmail|gmail|2fa|质保首登|日抛|会员|月卡|年卡|esim|\.zip|修复版)/;

/**
 * 判断文本是否包含正向代充/官充/卡充信号（剔除“不支持代充”“无代充”“可无限续费”等否定或属性修饰语）
 */
function hasPositiveRechargeSignal(text: string): boolean {
  const sanitized = text
    .replace(
      /(?:不支持|不可|不能|无法|无需|不需要|不用|不提供|禁止|严禁|勿|免|无|非|不是|自行|自己)(?:的|任何|官方|官网|自助|人工|再次|提前|继续|无限|长期|自己|自行|其它|其他)?(?:直充|直冲|代充|代冲|充值|代付|代开|卡充|卡冲|官充|官冲|一卡一冲|代过)/g,
      "",
    )
    .replace(
      /(?:可|支持|能|允许|无法|不能|不可|不支持|无需|不用|不需要|不到|到期不|不)\s*(?:无限|长期|一直|随时|继续|自动|官网|官方|自助|提前|同一空间)?\s*续费/g,
      "",
    );
  return /(?:直充|直冲|代充|代冲|充值|代付|代开|卡充|卡冲|官充|官冲|一卡一冲|续费|额度补充|才能充|代过)/.test(sanitized);
}

const CLAUSE_BREAK = /[|/／、,，;；。\n【】()[\]]+|(?<![+\d])\+(?=\s*[a-z\u4e00-\u9fff])/u;
const GENERIC_TITLE = /^(?:(?:\d+(?:\.\d+)?\s*(?:元|刀|u|点|积分)?)|(?:单次|独享|成品号|标准版|普通版|会员|订阅|月卡|季卡|半年卡|年卡|周卡|日卡|卡密|兑换码|激活码|充值|代充|账号|产品|商品|链接)[\s\d]*)$/;
const SUBJECT_HINT = /月卡|季卡|周卡|日卡|年卡|包月|包年|订阅|会员|兑换码|卡密|激活码|成品|账号|账户|接码|接马|接ma|手机号|实卡|普号|席位|拼车|额度|代充|直充|卡冲|续费|(?:pro|plus|ultra|free)\b/;
const UNCLASSIFIED_DELIVERY = /(?:苹果|apple|app\s?store|itunes|谷歌|google\s?play|亚马逊|amazon|steam)\s*(?:美区|日区|港区|英区|国区|美国|日本|香港)?\s*(?:礼品卡|礼卡|gift\s*card)/;
const TITLE_MODEL_REFERENCES = /(?:^|[\s|,，(（])(?:可用|可使用|可调用|兼容|适用(?:于)?|可用于|支持|专用于|仅供|专用|仅用于)(?!续费|订阅)[^|,，;；。)）】\]\n]+/gu;
const TITLE_ADDONS = /(?:^|[\s|,，(（【]|(?<=号|卡|版|码|订阅|会员))(?:附赠|赠送|赠品|赠|附带|附)(?!近)[^|,，;；。)）】\]\n]+/gu;
const NEGATED_SPEC = /(?:不支持|不能使用|无法使用|不可使用|不包括|不包含|不提供|不适用|不含|不带|不包(?!赔|退|首登))\s*(?:\b(?:chatgpt|claude|gemini|codex|grok|cursor|kiro|deepseek|free|plus|pro(?:\s*[x×]?\s*(?:5|20)[x×]?)?|ultra|team|business|max(?:\s*(?:5|20)[x×]?)?)\b|反重力|antigravity|(?:日|周|月|季|半年|年)卡|\d+\s*个?月|虚拟卡|api\s*中转)/giu;
const ACCOUNT_DELIVERY = /成品|账密|账号|帐号|账户|普号|老号|白号|母号|半成品|席位|车位|拼车|[首头二三]车|(?:子|白|母)号|团购|轮转|长效车|家庭组/;
const ACCOUNT_QUALIFIER = /^(?:已接|未接|一号一|带|含|自带|附带|可|除|包首登|质保|用途|支持|限制|限定|不支持|不含|不包|仅供|免|无须|无需|谷歌邮箱登录|邮箱登录)|(?:带|附|使用|登录)(?:该|的)?(?:邮箱|验证码)/;
const LEGACY_CHATGPT = /chatgpt|openai|\boai\b|\bgp[.\s/_-]*t\b|g皮t|\bg\s*[-_.]?\s*(?:plus|free|go|pro|team|business|账号|成品|普号)|\b(?:gptplus|gfree|gpro|ghatcpt|jpt|pgt)\b/;
const CREDIT_RELAY = /(?:网页|订阅|站点)镜像|镜像站|(?:api|中转).{0,12}号池|(?:\d+\s*(?:美元|美金|刀)).{0,20}号池|\b(?:api|token)\s*[-·]?\s*\d+\s*(?:美元|美金|刀)|(?:\bapi\b(?=[^|\n]{0,24}(?:额度|余额|中转|站|tokens?|\d+\s*(?:刀|u|元))))|(?:中转.{0,12}(?:额度|余额|兑换码|卡密|充值))|(?:api\b.*(?:tok[e]?ns?|请求))/;
const EXPLICIT_PRODUCT_RULES: ReadonlyArray<readonly [ProductGroup, RegExp, string]> = [
  ["AI绘图", /\bfirefly\b|\bleonardo\b|\bopenart\b|醒图|生图(?:点数|算力|积分|卡|额度)|(?:plus[- ]?)?image[- ]?2\.[56](?:生图|图片|积分|兑换)/, "image-product"],
  ["AI创作", /\b(?:libtv|genspark|toonflow)\b|织梦aigc|adobe\s+express|ai画布漫剧/, "creation-product"],
  ["数字素材", /(?:搞笑|来电|个性)铃声|无水印(?:视频|作品)?素材包|课件.{0,16}(?:ppt|幻灯片)/, "digital-asset-product"],
  ["AI视频", /\bdola\b.{0,8}专用号|\blight\s+video\b|(?:视频生成|视频)站\s*(?:额度|余额)|\bsea(?:danco|dance)\b|视频生成.{0,6}(?:积分|卡密)/, "video-product"],
  ["软件工具", /\blovable\s*(?:pro|lite)\b[^|]{0,22}(?:成品|会员|订阅|[月季年]卡)|\bcanva\b.{0,12}(?:管理后台|lifetime panel)|安卓(?:版|去开屏广告)\s*app|(?:安卓|web3)\s*(?:工具\s*)?app(?=$|[^a-z])/, "named-software-delivery"],
  ["软件工具", /(?:^|[【(])(?:aws(?:亚马逊)?|亚马逊\s*aws|微软云\s*azure)(?![a-z])[^|]{0,46}服务器/, "cloud-hosting-delivery"],
  ["软件工具", /^(?:[【[(][^】)\]]{1,16}[】)\]]\s*)?(?:发票整理(?:工具|软件)|短(?:链|连)(?:接)?生成(?:服务|工具|器)|(?:[a-z\d-]+(?:\.[a-z\d-]+)+\s+)?mcp\s*插件(?:密钥|授权码|激活码))/, "software-deliverable"],
  ["软件工具", /^(?:油猴脚本|百度文库(?:vip|会员)|闲鱼助手)|\bduolingo\b|多邻国|云服务器与托管工具|\bnotion\b[^|]{0,22}(?:plus|business|账号|会员|教育)|(?:adobe|创意云)\s*(?:母号|子号|席位)|鸿蒙.{0,12}源码项目|chrome插件|(?:免费|开源)听音乐.{0,24}(?:支持|系统)|提链助手|聊天记录模拟|(?:微信|app)多开|安卓截图工具|(?:小红书|微信).{0,8}(?:自动化工具|僵尸粉清理|清理好友)|(?:codex|cursor)安装服务|\bqbs\b[-—].{0,18}(?:定位|核销)|防封.{0,6}(?:环境检测|配置器)|批量授权(?:软件|工具)|全网卡网库存.{0,8}(?:搜|查)|官方中文包|(?:科研|文献)笔记|授权神器|逆向工具箱|破甲工具.{0,22}(?:windows|mac)|(?:windows|mac).{0,22}破甲工具|注册\s*#\s*机|\b(?:windsurf|opencode)\b|(?:程序|客户端).{0,16}(?:修复版|便携包|安装包)|(?:注册(?:机|鸡)|协议工具)[^|。]{0,12}(?:源码|程序|插件)|\bdsh-purge\b|\bsmartedu\b|(?:\bnotion2api\b|批量管理工具).{0,28}(?:便携包|windows|mac)|(?:账户|账号)批量管理工具|(?:软件|浏览器|chrome)插件(?:增强版|会员|[日天周月季年]卡)/, "software-product"],
  ["影音会员", /咪咕阅读.{0,12}(?:会员|日卡|周卡|月卡|季卡|年卡)/, "reading-membership"],
  ["生活优惠", /京东\s*plus\s*(?:会员|权益|日卡|周卡|月卡|季卡|年卡)/, "retail-membership"],
  ["工具教程", /提链方法|克劳德企业级环境部署方案|直播课.{0,16}(?:整理|文档|录播)|(?:新手|从0到1).{0,16}拆解.{0,12}(?:短视频|教学)|入门到精通教学|(?:运营|配置|部署)实战手册/, "tutorial-subject"],
  ["云手机", /安卓机vmos|\bvmos\b.{0,8}激活码/, "cloud-phone-product"],
  ["代理IP", /(?:^|[\s【[(])(?:miya\s*ip|iprocket|kookeey|[a-z]{2,}proxy|\d{2,}\s*proxy|[a-z]\d{1,3}\s*isp)(?:$|[^a-z])|(?:全球|企业级)代理(?:魔法|ip)|(?:不限(?:制)?流量|\b\d+\s*g(?:b)?).{0,12}订阅链接|订阅链接.{0,20}\d+\s*g(?:b)?\b|(?:内置代理|内置节点).{0,24}(?:套餐|流量|\d+\s*g[b]?)|(?:动态|静态|独享|原生)家宽.{0,20}\d+\s*g(?:b|流量|\b)|家庭住宅.{0,8}流量|美国.{0,8}静态住宅(?:\s*ip)?(?=$|[】)\s])/, "proxy-product"],
  ["社交会员", /(?:\b(?:tg|telegram)\b|电报|飞机)\s*(?:premium|会员订阅|会员)\b/, "social-membership"],
  ["游戏商品", /\bsteam\b.{0,12}(?:账号|账户|普号|小号|白号)|(?:异兽吞噬进化|三角洲).{0,18}(?:卡|定制|模型)|\brh\s*国际成品号.{0,10}r币/, "game-product"],
  ["手机卡", /(?:^|其余|全国|低价|通用)流量卡|月租套餐.{0,28}短信.{0,16}通话/, "sim-product"],
  ["平台账号", /^(?:x\s*(?:推特|高权重[^|]{0,8}老号)|twitte推x)|(?:美区|日区|台湾|港区|美国|日本|苹果)\s*[\]】|\s-]*\s*id\s*(?:账号|帐号|账户)|^(?:dy|抖音|闲鱼|视频号)[^|]{0,14}(?:粉丝|人工赞)|苹果[\s🚀]*成品号/u, "platform-account-product"],
];
const FINANCIAL_PAYMENT = /卡(?:充|付|冲)|付费|付款|支付|过验证|卡头|实卡(?:实付|开通)|visa.{0,8}开通/;
const GAME_CATEGORY = /游戏辅助|游戏货源|游戏商品|游戏账号/;
const ASSET_CATEGORY = /^(?:背景挂饰|山水风景|城市景观|动物世界|动漫卡通|人物摄影|图层素材|免扣素材|线条图稿|铃音文件)$/;
const SMS_COMPARISON = /(?:价格|网站|平台)\s*(?:对比|比较)/;
const SPECIAL_SUBJECT_GROUPS = new Set<ProductGroup>(["虚拟卡", "代理IP", "云手机", "中转", "手机卡", "工具教程"]);
const RELAY_CREDIT_CATEGORY = /^(?:api\s*(?:中转(?:站(?:点)?)?|站(?:点)?|额度)|中转(?:站(?:点)?|余额|额度|兑换码|套餐|充值)?|ai\s*中转站|[a-z][a-z\d ]{2,18}中转站(?:额度|余额))(?:\s*(?:余额|额度|兑换码|套餐|充值))?$/;

function classificationText(title: string): string {
  if (/\bg\s*plus\s*成品/.test(title)) {
    title = title.replace(/\bcodex\s*(?=已接[码马])(?=[^|【】()[\]]{0,8}[】)\]])/g, "");
  }
  return title
    .replace(/(?:看|读)(?:完)?(?:商品)?(?:说明|教程)还不会(?:使用|用|操作)(?:的)?(?:别|勿)拍/g, " ")
    .replace(/(?:可|适合|适用于)(?:用于)?注册\s*(?:claude|grok|gemini|openai|codex)(?:[-/\s]+(?:claude|grok|gemini|openai|codex|g)){0,4}(?:\s*等业务)?/g, " ")
    .replace(/^(?:适用于?|专供|可用于|支持)[^|,，。]{1,40}?的(?=\s*[\p{L}])/u, "")
    .replace(TITLE_MODEL_REFERENCES, " ")
    .replace(TITLE_ADDONS, " ")
    .replace(/可(?:拉|加|加入)家庭组\s*(?:共享|使用)反重力/g, " ")
    .replace(/(?:可|仅供|只能)(?:登录|使用|访问|登)?(?:网页(?:端)?|web)\s*(?:也?可|和|与|[、/])\s*(?:直接)?(?:登录|使用|访问|用)?\s*(?:codex|claude|gemini)\b/g, " ")
    .replace(/(?:(?:可|能)(?:网页|web)\s*(?:可)?|(?:适用|兼容|可用于)\s*)(?:直接)?(?:登录|使用|用)?\s*(?:codex|claude|gemini)\b/g, " ")
    .replace(/(?:支持\s*)?(?:codex|claude)\s*(?:网页|web端)?(?:都|均)可用|(?:支持|可)(?:直接)?(?:登录|登陆|使用)(?:网页版|网页端|网页)?\s*(?:codex|claude)(?=$|[^a-z])/g, " ")
    .replace(/(?:codex|claude)\s*专用(?=\s*[+]|[^|]{0,14}(?:手机号|接码|短信))/g, " ")
    .replace(/(?:pro|max)\s*[【[(]\s*((?:5|20)\s*[x×])\s*[】)\]]/g, "pro $1")
    .replace(/(?:^|[|【[(])\s*含\s*(?:seedance|veo)\s*\d+(?:\.\d+)?[^|】)；,，]*/g, " ")
    .replace(/(?:除外|排除|除)(?:\s*)(?:codex|chatgpt|claude|gemini|cursor|grok)\b/g, " ")
    .replace(/(?:\b(?:codex|claude|gemini)\b\s*(?:需|需要|自行|可用|可以用)接(?:码|马|ma)|接(?:码|马|ma)(?:后)?(?:可以用|可用)\s*(?:codex|claude|gemini)\b)/g, " ")
    .replace(/(?:非|不含)\s*(?:bug)?卡头|(?:实卡|visa\s*卡)(?:过验证|验证通过)|(?:可|支持)与plus并存/g, " ")
    .replace(NEGATED_SPEC, " ")
    .trim();
}

type ClassificationEvidence = "title" | "category" | "detail" | "insufficient" | "conflict";

export interface ProductClassification {
  brandGroup: ProductGroup;
  attributes: ExtractedAttributes;
  evidence: ClassificationEvidence;
  ruleId?: string;
  reasons: string[];
  isolateOffer: boolean;
}

/** Resolve subject and attributes together so an accessory cannot provide the main brand or tier. */
function classifyProductTitle(rawName: string, shopCategory: string): ProductClassification {
  const fullTitle = withoutBundleExclusions(canonicalSubjectText(normalizeSmsText(rawName)));
  const title = classificationText(fullTitle);
  const category = canonicalSubjectText(normalizeSmsText(shopCategory).trim());
  const reasons: string[] = [];
  if (isTutorialProduct(title)) {
    return {
      brandGroup: "工具教程", attributes: { attrType: "tutorial", attrPlan: "", attrDuration: "", attrWarranty: "", attrSms: "", attrRegion: "" },
      evidence: "title", ruleId: "tutorial-subject", reasons, isolateOffer: false,
    };
  }

  const titleAttributes = parseAttributes(title);
  if (hasNamedMultiProductBundle(title) || (MULTI_PRODUCT_BUNDLE.test(title) && hasNamedMultiProductBundle(fullTitle.replace(NEGATED_SPEC, " ")))) {
    return {
      brandGroup: "其它", attributes: { ...titleAttributes, attrType: "", attrPlan: "", attrDuration: "", attrSms: "", attrRegion: "" },
      evidence: "conflict", reasons: ["multiple-subjects"], isolateOffer: true,
    };
  }
  const accountDelivery = ACCOUNT_DELIVERY.test(title);
  const titleParts = title.split(CLAUSE_BREAK).map(part => part.trim()).filter(Boolean);
  const hasRelaySubject = CREDIT_RELAY.test(title) && !/(?:非|不是|不含)\s*api/.test(title) &&
    !accountDelivery && !hasIndependentSmsClue(title);
  const explicit = EXPLICIT_PRODUCT_RULES.find(([, pattern]) => pattern.test(title));
  const account = accountSubject(title, category);
  const recentGrokTier = /(?:^|[^a-z])grok.{0,12}(?:plus|premium|ultra|heavy|super)(?![a-z])/.test(title);
  const inferredOpenAi = !explicit ? openAiSubject(title, category) : undefined;
  const match = explicit ? { group: explicit[0], ruleId: explicit[2] } : account ?? [...matchBrandRules(title)].find(({ group, ruleId }) =>
    !(group === "代理IP" && (accountDelivery || titleAttributes.attrType === "recharge" || /\b(?:claude|codex|cursor)\b[^|]{0,20}(?:私人号池|席位|订阅)/.test(title))) &&
    !(group === "虚拟卡" && (accountDelivery || titleAttributes.attrType === "recharge") && (FINANCIAL_PAYMENT.test(title) || /visa\s*实卡/.test(title) && /成品|账密|账号/.test(title))) &&
    !(group === "中转" && accountDelivery && ruleId !== "api-balance-topup"));
  const categoryParts = category.split(CLAUSE_BREAK);
  const explicitCodexCategory = categoryParts.some(part =>
    /codex|coedx/.test(part) && !/chatgpt|openai|\bgpt\b|claude|gemini|grok|中转|接(?:码|马)|\bg\s*(?:与|和|及|或)/.test(part)) &&
    !categoryParts.some(part => /claude|gemini|grok|chatgpt|openai|\bgpt\b|^\s*g\s*$/.test(part));
  const identity = /^[\s【(（]*(?:[^|()（）【】]{0,18}[】)）]\s*)?(?:反重力|antigravity)/.test(title)
    || /(?:反重力|antigravity)[\s/|]*(?:antigravity[\s/|]*)?(?:pro[\s/|]*)?(?:独享会员|独享|成品号|账号)/.test(title)
    || /(?:反重力|antigravity).{0,14}(?:独享会员号|反重力导入)/.test(title)
    || /(?:反重力|antigravity).{0,12}首登/.test(title) && /\brt\b/.test(title);
  const rtDelivery = /(?:仅限|仅带|只有|带|使用|导入)(?:凭证|格式|[\s瑕]){0,8}rt|\brt\s*(?:交付|格式|导入)|反重力人机成品/.test(title);
  const antigravitySubject = (account?.group !== "邮箱账号" || /反重力导入.{0,40}rt|反重力[^|]{0,16}独享会员号/.test(title)) &&
    (/反重力成品|antigravity\s*成品/.test(title) && !/非反重力|不包反重力/.test(title) ||
    identity && !/家庭组|反重力\s*gcp可用/.test(title) &&
      (accountDelivery || /\brt\b/.test(title) || /^[\s【[(]*(?:反重力|antigravity)[】)\]]/.test(title)) ||
    /包反重力首登|反重力.{0,10}仅质保首登/.test(title) && !/家庭组/.test(title) ||
      /反重力|antigravity/.test(fullTitle) && rtDelivery && accountDelivery && !/家庭组|非反重力|不包反重力/.test(title));
  const googleOne = /\bgoogle\s*one\b[^|]{0,20}(?:优惠|订阅|兑换).{0,6}链接/.test(title);
  const geminiSubscription = /google\s*ai\s*ultra|gemini\s*ultra|gemini\s*pro[^|]{0,15}(?:订阅|会员)/.test(title) &&
    /家庭组|会员|订阅/.test(title);
  const shortCredit = RELAY_CREDIT_CATEGORY.test(category.replace(/^[【[(]([^【】()[\]]+)[】)\]]$/, "$1").trim()) &&
    /^(?:\d+(?:\.\d+)?\s*(?:刀|美元|美金|usd|元|余额|额度)|[a-z][a-z-]{2,}\s*\d+\s*积分|[日周月]包\s*\(\s*[日周月]限额\s*\d+(?:\.\d+)?\s*(?:刀|美元|美金)\s*\))$/.test(title);
  const cursorCredits = /^cursor$/.test(category) && /^\([^)]{1,8}\)\s*\d+\s*积分$/.test(title);
  const veoFamilySeat = /^google\s*ai\s*ultra$/.test(category) && /\bveo\s*3\b.*\bultra\b.*家庭组/.test(title);
  const idDirectory = /^(?:ios\s*id|apple\s*id|苹果\s*id)(?:账户|账号)?$/.test(category);
  const regionalId = idDirectory && /人工交付|邮寄|[a-z]{3,}区id|苹果id/.test(title);
  const listingNeedsConfirmation = /(?:^|[^a-z])kimi(?:[\s.0-9]*pro)?[\s\d.]*(?:日|周|月|年)卡|硬件钱包|(?:升级|开通).{0,5}咨询客服|^oai$|^g\d+[a-z]额度$|(?:买货|购物|商城)站余额码/.test(title);
  const gService = /(?:401重提授权|重提授权cdk).{0,10}(?:次卡|卡密)/.test(title) && /(?:\bg\b|gpt|openai|chatgpt)\s*(?:free|普号)/.test(category)
    || /\bg\s*(?:\d+\s*)?(?:点数|cyber\s*认证)/.test(title)
    || /(?:^|\s|[【[(])g\s*[|/·—-].{0,14}(?:普号|成品号|独享)(?![^|]{0,8}gemini)/.test(title)
    || /\bgo\s*订阅/.test(title) && /(?:埃及|cdk|充值|官网)/.test(title);
  const tutorialCategory = /教程|教学/.test(category) && /技术设计|图文指南|配置指南|防封\s*方法|(?:通用框架|一键部署).{0,18}(?:让|无限使用|全场景|畅用)/.test(title);
  const relayDirectory = /^(?:[^|]{0,18}(?:api|中转)[^|]{0,16})$/.test(category) &&
    /号池|不?限时.{0,9}(?:刀|额度)|(?:美元|美金|刀).{0,12}(?:兑换|额度|不限时)|纯(?:plus|pro)(?:\s*\+\s*(?:plus|pro))/.test(title)
    && !accountDelivery && !/个人账号|自己号/.test(title);
  const hostedCodex = /^(?:codex|gpt|claude)[^|]{0,18}(?:轻量版|试用卡|包月|月卡)/.test(title)
    && /^中转站(?:月卡|周卡|日卡)?$/.test(category) && !accountDelivery;
  const currencyCredit = /(?:美元|美金|刀).{0,10}(?:特惠|优惠|高用量)?(?:兑换码|充值卡)|^sub[-\s]+\d+\s*刀|(?:号池|(?:普号|free号)[^|]{0,8}池).{0,18}(?:额度|刀)/.test(title)
    && !accountDelivery && (/中转|sub|额度|兑换/.test(title) || /中转|额度|api/.test(category));
  const mirrorDirectory = /^镜像站/.test(category) && !accountDelivery && /套餐|日卡|周卡|月卡|季卡|年卡/.test(title);
  const apiKey = /(?:^|[^a-z])api\s*(?:key|密钥|token)|\b(?:claude|gemini|gpt)[^|]{0,16}测试key/.test(title) && !accountDelivery;
  const modelRelay = /(?:额度|余额).{0,18}(?:\d{2,}\s*(?:美元|美金|刀)|\d{2,}\s*usd)/.test(title)
    && /(?:openai[-\s]|claude-|gro-|grok-|gemini-)[a-z\d.]+/.test(title)
    && !accountDelivery && !/自己的号|自己账号/.test(title);
  const specificTier = /^\s*(?:claude|cursor|grok|gemini|kiro|muse|deepseek)(?:[^|]{0,18})(?:team|plus|pro|max|ultra|super|成品|普号)/.test(title)
    && !/中转站|镜像站|\bapi\s*(?:密钥|key|token)/.test(title);
  const gatewayCredits = /\bcodex\b[^|]{0,18}(?:普通.{0,8}plus|支持普通).{0,20}(?:余额|额度)|(?:^|[^a-z])api[^|]{0,7}(?:官方资源接入|按秒|[^|]{0,14}元\s*[\/每]秒)/.test(title)
    && !/成品号|自用账号/.test(title);
  const trialPaymentCard = /^(?:\d{6}\s*)?\$\s*[01]\s*试用卡/.test(title) &&
    /虚拟卡|试用验证卡|0刀卡|一刀卡/.test(category);
  const titleMatch = trialPaymentCard ? { group: "虚拟卡" as const, ruleId: "trial-card-category" }
    : (hasRelaySubject && !specificTier) || shortCredit || relayDirectory || mirrorDirectory || apiKey || modelRelay || hostedCodex || currencyCredit || gatewayCredits ? { group: "中转" as const, ruleId: shortCredit ? "relay-category" : "explicit-relay-delivery" }
    : cursorCredits ? { group: "Cursor" as const, ruleId: "cursor-credit-category" }
    : veoFamilySeat ? { group: "Gemini" as const, ruleId: "gemini-family-category" }
    : googleOne ? { group: "Gemini" as const, ruleId: "google-one-offer" }
    : gService ? { group: "ChatGPT" as const, ruleId: "chatgpt-service-subject" }
    : regionalId ? { group: "平台账号" as const, ruleId: "regional-id-category" }
    : tutorialCategory ? { group: "工具教程" as const, ruleId: "tutorial-subject" }
    : antigravitySubject ? { group: "Antigravity" as const, ruleId: "antigravity-account-subject" }
    : geminiSubscription && match?.group === "Antigravity" ? { group: "Gemini" as const, ruleId: "gemini-subscription-subject" }
    : recentGrokTier && !explicit && match?.group === "ChatGPT" ? { group: "Grok" as const, ruleId: "grok-tier-subject" }
    : inferredOpenAi && (!match || ["ChatGPT","Codex","邮箱账号","代理IP","中转"].includes(match.group))
      ? { group: inferredOpenAi, ruleId: "openai-delivery-subject" } : match;
  const specialSubject = titleMatch && SPECIAL_SUBJECT_GROUPS.has(titleMatch.group);
  const verificationListing = !accountDelivery && !/\bcodex\s*free\b|(?:g\s*plus|plus\s*成品).{0,20}需要手机接马/.test(title) && (
    /(?:美区|美国)?(?:tm|t-mobile)卡.{0,13}(?:自助|无限)?接(?:收)?(?:验证码|收码)|\bcodex\b.{0,8}(?:手机号|验证码).{0,14}(?:一次|[1一]次|验证)|号码租用平台/.test(title)
    || /(?:美区|美国).{0,18}codex.{0,6}\d+.?\d+天/.test(title) && /接(?:码|马)/.test(category)
    ||
    /\b(?:codex|chatgpt|claude)\b[^|,，]{0,8}(?:长效|短效|单次)验证/.test(title) && /手机号|手机验证|接码|接马/.test(category)
    || /接(?:码|马|ma)|手机验证码/.test(category) && /codex\s*(?:长效|短效)\s*\d+/.test(title)
    || /codex\s*接[^\p{L}\p{N}]{1,6}[^|]{0,16}实卡/u.test(title)
    || /实卡.{0,12}(?:天|周|月).{0,4}有效|万能号.{0,32}接(?:码|马)/.test(title) && /接(?:码|马)/.test(category)
    || /(?:注册)?(?:icloud|gmail)\s*邮箱接(?:码|马|ma).{0,14}(?:次码|次接)/.test(title)
  );
  const emailReceivesCodes = account?.group === "邮箱账号" &&
    /(?:邮箱|邮件).{0,22}(?:网页取件|邮箱取件|邮件取件|取件接收?|取件接验证码|收信|邮件验证码)/.test(title);
  const sms = verificationListing || !emailReceivesCodes && !/\bcodex\s*free\b/.test(title) && !explicit && !specialSubject && !SMS_COMPARISON.test(title) && hasIndependentSmsClue(title) &&
    (titleAttributes.attrType === "sms-service" ||
      (!titleAttributes.attrType && !titleAttributes.attrSms && !SMS_SERVICE_EXCLUSION_RE.test(title) &&
       !isPhysicalSimProduct(title) && parseAttributes(category).attrType === "sms-service"));
  if (sms) {
    titleAttributes.attrType = "sms-service";
    titleAttributes.attrSms = "";
    return { brandGroup: "接码服务", attributes: titleAttributes, evidence: "title", ruleId: "sms-subject", reasons, isolateOffer: false };
  }

  const bundle = MULTI_PRODUCT_BUNDLE.test(title);
  if (!specialSubject && (bundle || titleParts.length > 1)) {
    const candidates = titleParts.filter(part => !ACCOUNT_QUALIFIER.test(part) && !/^(?:不能|不可|无法|不)使用/.test(part) && SUBJECT_HINT.test(part))
      .flatMap(part => {
        const first = matchBrandRules(part).next().value?.group;
        return first && (!accountDelivery || !["邮箱账号", "代理IP", "中转"].includes(first)) ? [first] : [];
      });
    if (bundle && candidates.length < 2) {
      const brandCandidates = [...matchBrandRules(title)].map(({group}) => group)
        .filter(group => !["中转", "邮箱账号", "工具教程", "软件工具"].includes(group));
      candidates.push(...brandCandidates);
    }
    const singleRtAccount = antigravitySubject && rtDelivery && !bundle &&
      /(?:老号|成品号?)\s*[[【(]\s*(?:反重力|antigravity)\s*成品\s*[\]】)]\s*gemini\s*pro|^gemini\s*pro\s*成品(?:号)?\s*\|\s*反重力成品号\s*\|\s*(?:已过验证)?带\s*rt\b/.test(title) &&
      candidates.every(group => group === "Gemini" || group === "Antigravity");
    if (!singleRtAccount && new Set(candidates).size > 1 &&
        (bundle || titleParts.filter(part => ACCOUNT_DELIVERY.test(part) && !ACCOUNT_QUALIFIER.test(part)).length > 1)) {
      return {
        brandGroup: "其它", attributes: { ...titleAttributes, attrType: "", attrPlan: "", attrDuration: "", attrSms: "", attrRegion: "" },
        evidence: "conflict", reasons: ["multiple-subjects"], isolateOffer: true,
      };
    }
  }

  let brandGroup: ProductGroup | undefined = listingNeedsConfirmation ? "其它" : titleMatch?.group;
  let ruleId = titleMatch?.ruleId;
  let evidence: ClassificationEvidence = brandGroup ? "title" : "insufficient";
  if (ruleId !== "openai-delivery-subject") {
    if ((brandGroup === "ChatGPT" || brandGroup === "Codex") && /^codex\b/.test(titleParts[0] ?? "")) {
      brandGroup = "Codex";
      ruleId = "codex-product-subject";
    } else if (brandGroup === "ChatGPT" && !LEGACY_CHATGPT.test(title) && explicitCodexCategory && !title.includes("codex")) {
      brandGroup = "Codex";
      evidence = "category";
      ruleId = "codex-category-for-generic-plan";
    } else if (brandGroup === "Codex" && LEGACY_CHATGPT.test(titleParts[0] ?? "") && !/(?:g|openai)\s+codex\b/.test(title)) {
      brandGroup = "ChatGPT";
      ruleId = "chatgpt-account-subject";
    }
  }
  if (!brandGroup && explicitCodexCategory && ["recharge", "cdk"].includes(titleAttributes.attrType)) {
    brandGroup = "Codex";
    evidence = "category";
    ruleId = "codex-category-for-generic-plan";
  }
  if (UNCLASSIFIED_DELIVERY.test(title) && (!brandGroup || brandGroup === "ChatGPT" || brandGroup === "Gemini" || brandGroup === "平台账号")) {
    brandGroup = "其它";
    ruleId = "gift-card-subject";
    evidence = "title";
    titleAttributes.attrPlan = "";
    titleAttributes.attrRegion = "";
  }

  const assetTitle = ASSET_CATEGORY.test(category) && !GENERIC_TITLE.test(title) &&
    (/\d+\s*[幅张图]|写真|插画|风景|壁纸|3d版|模型|效果(?:图|】)|雕像/.test(title) ||
      /^(?:背景挂饰|山水风景|城市景观|动物世界|动漫卡通|图层素材|免扣素材)$/.test(category) && /[\p{L}]{4}/u.test(title));
  const sourceSpecific = assetTitle || /(?:\d+\s*张|安卓(?:日|天|周|月)卡|\d+\s*积分)/.test(title);
  if (!brandGroup && /^中转站(?:点)?$/.test(category) && /\d+\s*(?:刀|美元|美金)/.test(title) && !GENERIC_TITLE.test(title)) {
    brandGroup = "中转";
    ruleId = "relay-credit-category";
    evidence = "category";
  }
  const commercialCategory = /(?:抢单系统|引流截流|软件会员|云服务器与托管工具)/.test(category);
  if ((!brandGroup || brandGroup === "工具教程") && commercialCategory && /月卡|日卡|周卡|季卡|年卡|体验卡/.test(title)) {
    brandGroup = "软件工具";
    ruleId = "software-card-category";
    evidence = "category";
  }
  const relayCredits = /(?:余额|额度|倍率)/.test(title) && /(?:中转站|中转余额|中转兑换码|倍率站|\bapi\b|[a-z\u4e00-\u9fff]{2,}api$)(?:充值|额度|余额|兑换)?/.test(category)
    && !ACCOUNT_DELIVERY.test(title) && !/非api|codex.{0,8}点数/.test(title);
  if (!brandGroup && relayCredits) {
    brandGroup = "中转";
    ruleId = "relay-credit-category";
    evidence = "category";
  }
  if (!brandGroup && /(?:苹果|安卓|ios).{0,5}(?:永久|月卡|年卡).{0,5}\(?\d+开/.test(title)) {
    brandGroup = "游戏商品";
    ruleId = "game-license-slots";
    evidence = "title";
  }
  if (!brandGroup && /^生图(?:积分|额度|点数)(?:包|购买)?$/.test(category) && /积分|额度|点数/.test(title)) {
    brandGroup = "AI绘图";
    ruleId = "image-credit-category";
    evidence = "category";
  }
  if (!brandGroup && GAME_CATEGORY.test(category) && /(?:安卓|跑刀|苹果.{0,8}永久|[日天周月季年]卡)/.test(title)) {
    brandGroup = "游戏商品";
    ruleId = "game-card-category";
    evidence = "category";
  }
  const catalogEvidence = !brandGroup ? matchCatalogEvidence(title, category, fullTitle) : undefined;
  if (catalogEvidence) {
    brandGroup = catalogEvidence.group;
    ruleId = catalogEvidence.ruleId;
    evidence = catalogEvidence.category ? "category" : "title";
    if (brandGroup === "接码服务") {
      titleAttributes.attrType = "sms-service";
      titleAttributes.attrSms = "";
    }
    if (brandGroup === "游戏商品" && !titleAttributes.attrDuration && /天卡$/.test(title)) {
      titleAttributes.attrDuration = "day";
    }
  }
  if (!brandGroup && (SUBJECT_HINT.test(title) || sourceSpecific) && !SMS_COMPARISON.test(title)) {
    const categoryGroups = new Set(category.split(CLAUSE_BREAK).flatMap(part =>
      [...matchBrandRules(part)].map(match => match.group),
    ));
    if (categoryGroups.size === 1) {
      const [group] = categoryGroups;
      if (SUBJECT_HINT.test(title) ||
          (group === "数字素材" && (assetTitle || /\d+\s*张/.test(title))) ||
          (group === "游戏商品" && /安卓|积分/.test(title))) {
        brandGroup = group;
        ruleId = matchBrandRules(category).next().value?.ruleId;
        evidence = "category";
      }
    } else if (!categoryGroups.size && SUBJECT_HINT.test(title) && /^g(?:\s|[-_]|$)/.test(category)) {
      brandGroup = "ChatGPT";
      ruleId = "category-g-alias";
      evidence = "category";
    } else if (categoryGroups.size > 1) {
      reasons.push("mixed-category");
    }
  }

  if (brandGroup === "中转") titleAttributes.attrType = "api";
  if (ruleId === "codex-account-category" || ruleId === "chatgpt-account-category" ||
      ruleId === "mailbox-age-category" || ruleId === "mailbox-protocol-category" ||
      shortCredit || trialPaymentCard || cursorCredits || veoFamilySeat || tutorialCategory || mirrorDirectory || regionalId) {
    evidence = "category";
  }
  if (brandGroup === "工具教程" && (ruleId === "tutorial-subject" || ruleId === "verification-comparison-guide")) {
    return {
      brandGroup, attributes: { attrType: "tutorial", attrPlan: "", attrDuration: "", attrWarranty: "", attrSms: "", attrRegion: "" },
      evidence, ruleId, reasons, isolateOffer: false,
    };
  }
  if (titleAttributes.attrType === "sms-service" && brandGroup !== "接码服务") titleAttributes.attrType = "";
  if (brandGroup && SPECIAL_SUBJECT_GROUPS.has(brandGroup)) titleAttributes.attrPlan = "";
  if (brandGroup === "虚拟卡" || brandGroup === "手机卡" || brandGroup === "代理IP") {
    titleAttributes.attrSms = "";
  }
  if (titleAttributes.attrType === "api" && /\bapi\b/.test(title)) titleAttributes.attrPlan = "";

  // Keep the visible facet empty if two offers are advertised as alternatives in one title.
  if (!titleAttributes.attrPlan && matchSpec(title, PLAN_PATTERNS).length > 1) reasons.push("multiple-plans");
  if (!titleAttributes.attrDuration && matchDuration(title).length > 1) reasons.push("multiple-durations");
  if (bundle) reasons.push("bundle");
  if (listingNeedsConfirmation) reasons.push("missing-delivery-evidence");
  if (GENERIC_TITLE.test(title) || !title) reasons.push("generic-title");
  if (!brandGroup) reasons.push("missing-subject");

  return {
    brandGroup: brandGroup ?? "其它", attributes: titleAttributes, evidence, ruleId, reasons,
    isolateOffer: reasons.length > 0 || shortCredit || cursorCredits || veoFamilySeat || Boolean(catalogEvidence?.category),
  };
}

const DETAIL_DESCRIPTION_LIMIT = 4_000;
const SERVICE_DELIVERY = /交付|发货|提供|获得|收到|开通|商品(?:名称|说明)|本(?:品|商品|套餐)|售卖|充值到|兑换后/;

/** Public details are only needed for unresolved offers with a plausible single deliverable. */
export function needsProductDetail(rawName: string, shopCategory: string): boolean {
  const result = classifyProductTitle(rawName, shopCategory);
  return result.brandGroup === "其它" && result.evidence !== "conflict" && result.ruleId !== "gift-card-subject";
}

/** Optional public detail evidence may resolve an ambiguous title without changing its display text. */
export function classifyProduct(rawName: string, shopCategory: string, description?: string): ProductClassification {
  const titleResult = classifyProductTitle(rawName, shopCategory);
  if (!description?.trim() || titleResult.evidence === "conflict") return titleResult;

  const text = canonicalSubjectText(normalizeSmsText(description.slice(0, DETAIL_DESCRIPTION_LIMIT))
    .replace(/<(?:style|script)\b[^>]*>[\s\S]*?<\/(?:style|script)>/gi, " ")
    .replace(/<[^>]+>/g, " "));
  if (!text || text.length < 12) return titleResult;
  const title = normalizeSmsText(rawName);
  const matches: Array<{ group: ProductGroup; type?: string; ruleId: string }> = [];
  const possible = (group: ProductGroup, ruleId: string, pattern: RegExp, type?: string) => {
    if (pattern.test(text)) matches.push({ group, type, ruleId });
  };

  possible("其它", "detail-cross-brand-bundle", /(?:三合一|四合一|套餐包含|一份订阅包含|组合(?:会员|权益|订阅)).{0,100}(?:grok|supergrok).{0,90}cursor|(?:包含|含有)(?:.{0,36})(?:grok|supergrok).{0,38}(?:premium|推特|twitter|蓝v).{0,42}cursor/);
  possible("中转", "detail-relay-delivery", /(?:本(?:店|品|商品|套餐)\s*(?:提供|为|是)|使用本站|(?<!不|未|无法|不会)提供)\s*(?:独立|专用|官方)?\s*(?:中转站|镜像站|api余额)|(?:一张|一个|此|该|本)(?:.{0,8})(?:卡密|兑换码).{0,55}(?:调用|使用)(?:.{0,15})(?:多种|所有|全系|全部)(?:.{0,8})模型|(?:额度|余额)(?:.{0,8})(?:兑换|充值).{0,26}(?:中转站|镜像站)|(?:购买|下单|付款)后\s*(?:请|直接|前往|去|到|在|登录)*\s*(?:中转站|镜像站)\s*(?:兑换|充值)/, "api");
  const apiLimit = /^\d+(?:\.\d+)?\s*(?:刀|元|美元|美金)(?:\s*(?:余额|额度))?$/.test(title) &&
    /(?:限额|额度)\s*\d+\s*刀/.test(text) && /\bapi\s*网站\s*[:：]/.test(text);
  const apiBalanceCard = /(?:余额|额度)(?:兑换|充值)卡/.test(title) &&
    /(?<!不|未|无法)到账(?:金额)?\s*[:：]?\s*(?:[$¥]\s*\d|\d+(?:\.\d+)?\s*(?:刀|元|美元|美金|usd))/.test(text) &&
    /(?<!不|无法)(?:兼容|调用)接口\s*[:：]?\s*openai\s*标准\s*api\b/.test(text);
  if (apiLimit || apiBalanceCard) {
    matches.push({ group: "中转", type: "api", ruleId: "detail-relay-credit" });
  }
  possible("接码服务", "detail-verification-delivery", /(?:卡密|购买后|有效期内|自助)(?:.{0,28})(?:接收(?:短信)?验证码|接收码|接码)(?:.{0,15})(?:无限|次数|服务|有效|手机|单次)|(?:本品|本商品|本服务|提供|仅限用于).{0,18}(?:手机号码|接码服务|接收验证码)/, "sms-service");
  possible("软件工具", "detail-software-delivery", /(?:付款后|购买后|自动发货|交付|本品|本商品|下单后).{0,22}(?:软件\s*[+＋]|插件\s*(?:安装包|授权码)|(?:安装包|可执行程序)|软件授权码)|(?:是|为)(?:一款|一个)?(?:开源|跨平台).{0,15}(?:播放|签到|自动化|桌面).{0,10}软件/, "");
  if (/^\d+(?:\.\d+)?\s*(?:分|点)$/.test(title) &&
      /seedance\s*[-·]?\s*生成视频积分/i.test(shopCategory)) {
    possible("AI视频", "detail-video-generation-credits", /(?:购买|兑换|充值|到账|发放)(?:后|成功|即)?[^。|]{0,24}(?:用于|可用(?:于)?|获得)[^。|]{0,24}(?:seedance|生成视频|视频生成)/);
  }
  possible("Antigravity", "detail-antigravity-delivery", /(?:成品|账号).{0,52}(?:带|发|提供)rt(?:凭证)?(?:(?!家庭组).){0,94}(?:导入|首登反重力)|(?:只保|仅承接|只承接|只质保|仅质保)(?:首登)?(?:反重力|antigravity)(?:首登|秒封|登陆|登录)?/, "ready");
  const appleLogin = /苹果.{0,8}(?:应用商店|app\s*store)|app\s*store.{0,8}下(?:载)?\s*app/.test(text);
  const appleAccountFields = /\bid\s*账号/.test(title) && /\bid\s*地区\s*[:：]/.test(text) &&
    /\bicloud\s*[:：]/.test(text) && /\bapp\s*store\s*商店\s*[:：][^。|]{0,36}可下载\s*app\b/.test(text);
  if (/(?:\bid\b|账号|账户|可下app)/.test(title) &&
      /(?:发货|卡密)?格式(?:为)?\s*[:：]?\s*(?:账号|账户)[\s—-]+密码/.test(text) &&
      (appleLogin || appleAccountFields)) {
    matches.push({ group: "平台账号", type: "ready", ruleId: "detail-apple-account" });
  }
  if (/\d+\s*(?:个\s*)?g(?:b)?(?=$|[^a-z])\s*流量/.test(title) && /自助订阅\s*(?:魔法|节点)/.test(text)) {
    matches.push({ group: "代理IP", ruleId: "detail-network-subscription" });
  }
  if (/^claude(?:\s*成品)?$/.test(normalizeSmsText(shopCategory).trim()) && /\bmax\s*(?:5|20)\s*[x×]/.test(title) &&
      /需要实付|支付通道/.test(text) && /充值|直充/.test(text)) {
    matches.push({ group: "Claude", type: "recharge", ruleId: "detail-claude-recharge" });
  }
  if (/^5\s*[x×]\s*100\s*(?:美刀|美元)\s*官方充值$/.test(title) &&
      /\bplus\b/.test(text) && /\b5\s*[x×]\s*(?:的\s*)?订阅/.test(text) &&
      /(?:账号[^。]{0,12}(?:充值|续费)|开通[^。]{0,12}会员)/.test(text)) {
    matches.push({ group: "ChatGPT", type: "recharge", ruleId: "detail-openai-pro-recharge" });
  }

  // A purpose or a compatible model does not prove the seller is delivering that account.
  const exactCodex = /(?:发货格式|交付|发货|本品|本商品|商品名称)(?:.{0,16})codex\s*(?:账号|成品号|普号|free号)|仅(?:限|支持)(?:.{0,8})codex专用rt/.test(text);
  const exactGpt = /(?:发货格式|交付|发货|本品|本商品|商品名称)(?:.{0,16})(?:chatgpt|openai|gpt)\s*(?:plus|free)(?:\s*账号|成品号|普号)|(?:交付|本品|本商品)(?:.{0,8})g\s*plus账号/.test(text);
  const exactMail = SERVICE_DELIVERY.test(text) && /(?:发货格式|交付|本品|本商品)(?:.{0,12})(?:gmail|hotmail|outlook|icloud|谷歌|微软)\s*(?:独立|隐私|临时)?邮箱|只保(?:证)?邮箱(?:收件|登录|正常)|本品仅.{0,10}邮箱/.test(text);
  if (exactCodex) matches.push({ group: "Codex", type: "ready", ruleId: "detail-account-delivery" });
  if (exactGpt) matches.push({ group: "ChatGPT", type: "ready", ruleId: "detail-account-delivery" });
  if (exactMail || /发货格式(?:为)?\s*[:：]?\s*邮箱[\s—-]+密码[\s—-]+(?:辅邮|辅助邮箱)/.test(text)) {
    matches.push({ group: "邮箱账号", ruleId: "detail-mailbox-delivery" });
  }

  // A detailed description may contain several deliverables. Without a single subject, keep the title result.
  const groups = new Set(matches.map(match => match.group));
  if (groups.size !== 1) return titleResult;
  const { group, type, ruleId } = matches[0];
  if (group === titleResult.brandGroup) return titleResult;
  const weakTitle = titleResult.evidence !== "title" || titleResult.brandGroup === "其它";
  const competingAccountLabel = ["ChatGPT", "Codex", "邮箱账号", "Gemini", "Antigravity"].includes(titleResult.brandGroup)
    && ["ChatGPT", "Codex", "邮箱账号", "Antigravity"].includes(group);
  const qualifiedPhoneService = group === "接码服务" &&
    !/邮箱|邮件/.test(title) && !ACCOUNT_DELIVERY.test(title) &&
    /手机号码|实体(?:手机|sim)卡|(?:美国|美区|英国|英区)实卡|\bt[- ]?mobile\b|\btm卡|接收短信验证码/.test(text);
  const deliveryOverrides = group === "其它" || qualifiedPhoneService || group === "中转"
    || group === "软件工具" && /插件|软件|工具|源码|程序/.test(rawName);
  if (group === "接码服务" && !qualifiedPhoneService) return titleResult;
  if (!weakTitle && !competingAccountLabel && !deliveryOverrides) return titleResult;

  return {
    brandGroup: group,
    attributes: { ...titleResult.attributes, ...(type !== undefined ? { attrType: type } : {}),
      ...(ruleId === "detail-openai-pro-recharge" ? { attrPlan: "pro5" } : {}),
      ...(group === "其它" || group === "中转" || group === "接码服务" ? { attrPlan: "", attrSms: "" } : {}) },
    evidence: "detail", ruleId,
    reasons: group === "其它" ? ["multiple-subjects"] : [],
    isolateOffer: true,
  };
}

export function detectBrandGroup(rawName: string, shopCategory: string): ProductGroup {
  return classifyProduct(rawName, shopCategory).brandGroup;
}

export function extractAttributes(rawName: string, shopCategory: string): ExtractedAttributes {
  return classifyProduct(rawName, shopCategory).attributes;
}

type SpecPattern = readonly [string, RegExp];

const PLAN_PATTERNS: readonly SpecPattern[] = [
  ["pro20", /(?:(?<!\d)20\s*[x×]\s*(?:pro|max)(?=$|[^a-z]|cdk)|(?:pro|max)\s*20\s*[x×](?=$|[^a-z]|cdk)|(?:pro|max)\s*[x×]\s*20(?![\da-z])|(?:pro|max)20(?![\da-z个月天年周刀元块美折次条张位u])|\bpro\s*\$?200\b[^|｜\n]{0,8}原\s*20\s*[x×])/],
  ["pro5", /(?:(?<!\d)5\s*[x×]\s*(?:pro|max)(?=$|[^a-z]|cdk)|(?:pro|max)\s*5\s*[x×](?=$|[^a-z]|cdk)|(?:pro|max)\s*[x×]\s*5(?![\da-z])|(?:pro|max)5(?![\da-z个月天年周刀元块美折次条张位u]))/],
  ["team", /(?:\b(?:business|team)\b|(?<!s)team(?![a-z])|团队版)/],
  ["plus", /(?:\b|(?<=chatgpt|gpt|codex|cursor|claude|gemini|grok|gr0k|g))plus(?:\b|(?=\d))/],
  ["free", /(?:\b|(?<=chatgpt|gpt|codex|cursor|claude|gemini|grok|gr0k|g))free(?:\b|(?=\d))|免费版|普号/],
  ["ultra", /(?:\b|(?<=claude|gemini|grok|gr0k))ultra(?:\b|(?=\d))/],
  ["pro", /(?:\b|(?<=gemini|claude|cursor|kiro|gpt|chatgpt|openai|grok|gr0k|g))pro(?:\b|(?=\d))/],
];

const DURATION_PATTERNS: readonly SpecPattern[] = [
  ["year", /(年卡|包年|(?<![\d.\-~到])1年(?![多内以前后上老半\d])|(?<![不足用活过每第])一年(?![多内以前后上老半])|(?<![\d.\-~到])365天(?![内以上])|(?<![\d.\-~到])12个月(?![内以上老]))/],
  ["half-year", /(?<![\d.\-~到])6个月(?![内以上老半])|(?<![一二三四五六七八九十])六个月(?![内以上老半])|(?<!前|近|满|过|超过|不足)半年(?![多内以前后上老])/],
  ["quarter", /(?<![\d.\-~到])3个月(?![内以上老半])|(?<![一二三四五六七八九十])三个月(?![内以上老半])|季卡|季度/],
  ["month", /(月卡|包月|(?<![\d一二三四五六七八九十.\-~到])(?:1|一)个月(?![多内以前后上老半])|(?<![\d.\-~到])30天(?![内以上老])|(?<![\d.\-~到])28天(?![内以上老])|(?<![\d\-~])20-30天|(?<![\d\-~])21-30天)/],
  ["week", /(周卡|(?<![\d.\-~到])7天(?![内以上老])|(?<![\d.\-~到])1周(?![内以上老])|(?<![每各已活满过近超前])一周(?![多内以前后上老]))/],
  ["day", /(日卡|(?<![\d到\-~.])1天(?![内以上])|(?<![\d到\-~.])24小时(?![内以上]))/],
];

/** Specific expressions consume their match so “Pro 20x” does not also count as generic “Pro”. */
function matchSpec(text: string, patterns: readonly SpecPattern[]): string[] {
  const values: string[] = [];
  for (const [value, pattern] of patterns) {
    if (!pattern.test(text)) continue;
    values.push(value);
    text = text.replace(new RegExp(pattern.source, "g"), " ");
  }
  return values;
}

function matchDuration(text: string): string[] {
  const durationText = text
    .replace(/(?:已稳定|已活|已用|已稳|账号年龄|注册已有)\s*(?:\d+(?:-\d+)?|[一二三四五六七八九十]+)\s*(?:天|周|个?月|年)/g, "")
    .replace(/(?:质保|售后|包赔|保订阅|保封号|首登|(?<![\u4e00-\u9fa5])不?保)\s*(?:\d+(?:-\d+)?|[一二三四五六七八九十]+)\s*(?:天|周|小时|h)/g, "")
    .replace(/(?:质保|售后|包赔)\s*(?:(?:\d+(?:-\d+)?|[一二三四五六七八九十]+)\s*(?:个?月|年)|半年)(?!\s*订阅)/g, "")
    .replace(
      /(?:\d+(?:-\d+)?|[一二三四五六七八九十]+)\s*(?:天|周|小时|h)\s*(?:内)?(?:质保|售后|包赔|保订阅|保封号|稳定|已稳|已活|发货|交货|交付|完单|首登|退款|更换|冲|充值)/g,
      "",
    )
    .replace(
      /cdk\s*24小时|(?<![\d到\-~])24小时[\s\-·•【\[]*(?:自动|自助|全自动|人工|接单|客服|发货|发卡|秒发|提卡|出货|充值|代充|代过|冲|内|满智|在线|营业|响应)/g,
      "",
    );
  return matchSpec(durationText, DURATION_PATTERNS);
}

function parseAttributes(value: string): ExtractedAttributes {
  const text = normalizeSmsText(value);

  // 1. 商品类型 (type)：独立接码优先于代充/成品/CDK，拼车/席位/独享归入 ready 避免含“额度”误入 api。
  let attrType = "";
  const isAccount = ACCOUNT_ENTITY_RE.test(text);
  const isSmsService =
    !isAccount &&
    !isPhysicalSimProduct(text) &&
    !SMS_COMPARISON.test(text) &&
    !SMS_SERVICE_EXCLUSION_RE.test(text) &&
    (SMS_SERVICE_SIGNAL_RE.test(text) || (!SMS_SERVICE_FALLBACK_EXCLUDE_RE.test(text) && /接(?:码|马|ma)/.test(text)));

  if (isSmsService) {
    attrType = "sms-service";
  } else if (hasPositiveRechargeSignal(text)) {
    attrType = "recharge";
  } else if (isAccount || /(?<!非)独享|refresh_token/.test(text)) {
    attrType = "ready";
  } else if (/(cdk|兑换码|激活码|卡密)/.test(text)) {
    attrType = "cdk";
  } else if (/(\bapi\b|中转|按量|额度|tokens?)/.test(text)) {
    attrType = "api";
  }

  const plans = matchSpec(text, PLAN_PATTERNS);
  const durations = matchDuration(text);
  const attrPlan = plans.length === 1 ? plans[0] : "";
  const attrDuration = durations.length === 1 ? durations[0] : "";

  // 有限保障先识别，避免“不质保封号”被当成完全无质保。
  const scopedExclusion = /(?:不保|不质保)(?:封号|订阅|降智|限流)|(?:封号|订阅|降智|限流)不(?:保|质保)/g;
  const withoutScopedExclusions = text.replace(scopedExclusion, "");
  const noWarranty = /(无质保|无售后|不提供(?:任何)?质保|不提供售后|不质保)/.test(withoutScopedExclusions);
  const positiveWarranty = /(质保|包退|包赔|保订阅|保封号|保首登|售后保障)/.test(
    withoutScopedExclusions.replace(/无质保|无售后|不提供(?:任何)?质保|不提供售后|不质保/g, ""),
  );
  const limitedWarranty = /首登|首次登录|部分质保|有限质保/.test(text) || scopedExclusion.test(text);
  let attrWarranty = "";
  if (positiveWarranty && (limitedWarranty || noWarranty)) attrWarranty = "partial";
  else if (noWarranty) attrWarranty = "no";
  else if (positiveWarranty) attrWarranty = "yes";

  // 手机验证是账号状态，接码服务本身不代表已验证。
  let attrSms = "";
  if (attrType !== "sms-service") {
    if (/(未接[码马]|未接ma|未绑手机|未验证手机|需自备接[码马])/.test(text)) attrSms = "pending";
    else if (/(已接[码马]|已接ma|已经接[码马]|已绑手机|已验证手机)/.test(text)) attrSms = "done";
  }
  const attrRegion = detectRegion(text, attrType === "sms-service");

  return {
    attrType,
    attrPlan,
    attrDuration,
    attrWarranty,
    attrSms,
    attrRegion,
  };
}

const REGION_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["us", /美区|美国|\bus\b|美?\+1/gi], ["jp", /日区|日本|\bjp\b/gi],
  ["hk", /港区|香港|\bhk\b/gi], ["tw", /台区|台湾|\btw\b/gi],
  ["uk", /英区|英国|\buk\b/gi], ["tr", /土区|土耳其|\btr\b/gi],
  ["ph", /菲区|菲律宾|\bph\b/gi], ["random", /随机地区|随机区/gi],
];

/** 账号地区不从号码、注册 IP 或支付渠道推断；多地区冲突保持未标注。 */
function detectRegion(text: string, phoneService: boolean): string {
  const candidates = new Set<string>();
  for (const [code, pattern] of REGION_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const before = text.slice(Math.max(0, match.index - 12), match.index);
      const after = text.slice(match.index + match[0].length, match.index + match[0].length + 12);
      const phoneContext = /(?:号码|手机号|手机卡|接码|接马)(?:地区)?[：:为\s]*$/.test(before)
        || /^\s*(?:实卡|手机|号码|接码|接马)/.test(after);
      const channelContext = /(?:注册(?:地|ip)?|付款|支付|充值渠道|渠道)[：:为\s]*$/.test(before)
        || /^\s*(?:家宽|住宅|ip\b|注册|ios渠道|支付|付款|渠道)/.test(after);
      if (channelContext || (!phoneService && phoneContext)) continue;
      const explicitAccountRegion = /区|随机地区/.test(match[0])
        || /(?:账号|账户|订阅|会员)(?:地区)?[：:为\s]*$/.test(before)
        || /^\s*(?:账号|账户|订阅|会员|版)/.test(after);
      if (phoneService || explicitAccountRegion) candidates.add(code);
    }
  }
  return candidates.size === 1 ? [...candidates][0] : "";
}

/** 提取标题原有售后条款供展示，不把识别结果当作店铺的新承诺。 */
export function extractWarrantyText(rawName: string): string {
  const cleanRaw = String(rawName || "").replace(ZERO_WIDTH_STRIP_RE, "");
  return [...new Set(cleanRaw.split(/[【】\[\]（）()|，,；;]/u)
    .map((part) => {
      const start = part.search(/(?:无|不)?质保|(?:无|不提供)?售后|不保(?:订阅|封号)|(?:封号|订阅)不(?:保|质保)|包退|包赔|保订阅|保封号|保首登/);
      return start < 0 ? "" : part.slice(start).trim();
    }).filter(Boolean))].join("；");
}

/**
 * 生成保守的同款键：保留完整名称、数字区间、小数和 +，支持品牌与规格作用域。
 * 只合并归一化名称及规格一致的报价，不做可能混淆不同商品的模糊合并。
 */
export function buildGroupKey(cleanName: string, scope = ""): string {
  const normalized = cleanName
    .normalize("NFKC")
    .toLowerCase()
    .replace(/(\d)\s*[-‐‑–—~〜～至到]\s*(?=\d)/g, "$1至")
    .replace(/[^\p{L}\p{N}+.]+/gu, "");

  return `${scope ? `${scope}:` : ""}${normalized || "unknown"}`;
}

/**
 * 将源站抓取的商品对象标准化为待入库的结构化报价
 */
export function normalizeOffer(
  shopId: string,
  item: RawOfferItem,
  updatedAt: string,
  detail?: string | ProductClassification,
): NormalizedOffer {
  const cleanName = cleanProductName(item.rawName);
  const { brandGroup, attributes: attrs, isolateOffer } = typeof detail === "object"
    ? detail : classifyProduct(item.rawName, item.shopCategory, detail);
  // 同名但品牌或结构化规格不同的商品不应合并；完整标题避免长名称尾部规格丢失。
  const scope = [brandGroup, ...Object.values(attrs)].join("|");
  const groupKey = isolateOffer
    ? `${buildGroupKey(cleanName, scope)}:offer:${JSON.stringify([shopId, item.itemKey])}`
    : buildGroupKey(cleanName, scope);

  return {
    id: `${shopId}:${item.itemKey}`,
    shopId,
    groupKey,
    rawName: item.rawName,
    cleanName,
    brandGroup,
    shopCategory: item.shopCategory,
    ...attrs,
    price: Number(item.price.toFixed(2)),
    stockCount: item.stockCount,
    stockStatus: item.stockStatus,
    itemUrl: item.itemUrl,
    updatedAt,
  };
}

/**
 * 计算按价格升序数组的中位价
 */
export function calculateMedian(sortedPrices: number[]): number {
  if (sortedPrices.length === 0) {
    return 0;
  }
  const mid = Math.floor(sortedPrices.length / 2);
  if (sortedPrices.length % 2 === 1) {
    return Math.round(sortedPrices[mid] * 100) / 100;
  }
  const sumCents = Math.round(sortedPrices[mid - 1] * 100) + Math.round(sortedPrices[mid] * 100);
  return Math.round(sumCents / 2) / 100;
}
