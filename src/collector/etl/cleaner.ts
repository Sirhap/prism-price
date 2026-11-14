import type { NormalizedOffer, ProductGroup, RawOfferItem } from "../../types";
import { classifyBrand, normalizeMatchText } from "./brandClassifier";

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
  return /(?:接[码马]|接ma|接(?:收)?验证码|手机(?:号)?验证|短信(?:接|收|验证)|手机号?[^|｜\n]{0,10}短信[^|｜\n]{0,10}短效|美\+1|实卡[^|｜\n]{0,10}(?:单次验证|接码|接马)|登录验证[^|｜\n]{0,12}实卡)/.test(value);
}

function isPhysicalSimProduct(value: string): boolean {
  return /(?:giffgaff|实体手机卡|实体sim卡)/i.test(value) && !/(?:接码服务|接马服务|短信接码|接码平台)/.test(value);
}

/** 教程和明确的接码服务按商品本体归类，其余再按品牌和店铺分类识别。 */
export function detectBrandGroup(rawName: string, shopCategory: string): ProductGroup {
  if (isTutorialProduct(rawName)) return "工具教程";
  const smsText = normalizeSmsText(rawName);
  const hasSmsClue = hasIndependentSmsClue(smsText);
  if (hasSmsClue && !isPhysicalSimProduct(smsText) && !/(?:价格|网站|平台)\s*(?:对比|比较)/.test(smsText) &&
      extractAttributes(rawName, shopCategory).attrType === "sms-service") {
    return "接码服务";
  }
  // 标题中的明确商品身份优先，避免店铺的宽泛分类污染每一件商品；未命中时再联合标题+分类及纯 G 分类兜底。
  const combined = shopCategory ? `${rawName} ${shopCategory}` : rawName;
  const matched = classifyBrand(rawName) ?? classifyBrand(shopCategory) ?? classifyBrand(combined);
  if (matched) {
    return matched;
  }
  const normalizedCategory = normalizeMatchText(shopCategory);
  if (/^g(?:\s|[-_/]|$)/i.test(normalizedCategory)) {
    return "ChatGPT";
  }
  return "其它";
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
  /(接码服务|接马服务|接(?:收)?验证码|手机号?[^|｜\n]{0,10}短信[^|｜\n]{0,10}短效|短信接(?:码|马|ma)|手机接(?:码|马|ma)|接(?:码|马|ma)验证|长效接[码马]|短效接[码马]|单次接[码马]|一次性接[码马]|卖接[码马]|手机号?验证|短信验证|短信收码|(?:\d+|一|两|二|三|五|十|多|无限)次[^\n|｜]{0,12}接(?:码|马|ma)|注册接(?:码|马|ma)|全球接(?:码|马|ma)|手机[^|｜\n]{0,16}接(?:码|马|ma)|实卡[^|｜\n]{0,16}接(?:码|马|ma)|接(?:码|马|ma)[^|｜\n]{0,24}(?:美\+?1|实卡|美国|全球|印尼|哥伦比亚|英国|香港|菲律宾|日本|加拿大|自动换号|质保不来码|不来码|cdk|api|有效期内|二次验证|高成功率|自主换号|换号|一次|长效|短效|美区))/;

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

/**
 * 从非标商品标题提取 6 维结构化筛选属性（与前端面板维度对齐）
 */
export function extractAttributes(rawName: string, shopCategory: string): ExtractedAttributes {
  if (isTutorialProduct(rawName)) {
    return { attrType: "tutorial", attrPlan: "", attrDuration: "", attrWarranty: "", attrSms: "", attrRegion: "" };
  }
  const title = parseAttributes(rawName);
  const category = parseAttributes(shopCategory);
  const titleNorm = normalizeSmsText(rawName);
  const titleHasSmsClue = hasIndependentSmsClue(titleNorm);
  const blockCategorySmsService =
    title.attrSms !== "" || SMS_SERVICE_EXCLUSION_RE.test(titleNorm) ||
    /(?:价格|网站|平台)\s*(?:对比|比较)/.test(titleNorm) || isPhysicalSimProduct(titleNorm) || !titleHasSmsClue;

  for (const key of Object.keys(title) as Array<keyof ExtractedAttributes>) {
    // 时长、售后、验证与地区只采信标题，不能用宽泛店铺分类补出规格或承诺。
    if (key === "attrDuration" || key === "attrWarranty" || key === "attrSms" || key === "attrRegion") {
      continue;
    }
    // 标题已体现账号验证状态、否定接码或明确为非接码实体时，不能从分类回退为接码服务。
    if (key === "attrType" && category.attrType === "sms-service" && blockCategorySmsService) {
      continue;
    }
    title[key] ||= category[key];
  }

  // 接码服务本身不代表已完成手机验证的账号。
  if (title.attrType === "sms-service") {
    title.attrSms = "";
  }
  return title;
}

function parseAttributes(value: string): ExtractedAttributes {
  const text = normalizeSmsText(value);

  // 1. 商品类型 (type)：独立接码优先于代充/成品/CDK，拼车/席位/独享归入 ready 避免含“额度”误入 api。
  let attrType = "";
  const isAccount = ACCOUNT_ENTITY_RE.test(text);
  const isSmsService =
    !isAccount &&
    !isPhysicalSimProduct(text) &&
    !/(?:价格|网站|平台)\s*(?:对比|比较)/.test(text) &&
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

  // 2. 套餐 (plan)：修复 pro5/pro20 边界与 X5/X20 倒序，合并 business->team，移除拼车与 dead 枚举 advanced。
  let attrPlan = "";
  if (
    /(?:(?<!\d)20\s*[x×]\s*(?:pro|max)(?=$|[^a-z]|cdk)|(?:pro|max)\s*20\s*[x×](?=$|[^a-z]|cdk)|(?:pro|max)\s*[x×]\s*20(?![\da-z])|(?:pro|max)20(?![\da-z个月天年周刀元块美折次条张位u])|\bpro\s*\$?200\b[^|｜\n]{0,8}原\s*20\s*[x×])/.test(
      text,
    )
  ) {
    attrPlan = "pro20";
  } else if (
    /(?:(?<!\d)5\s*[x×]\s*(?:pro|max)(?=$|[^a-z]|cdk)|(?:pro|max)\s*5\s*[x×](?=$|[^a-z]|cdk)|(?:pro|max)\s*[x×]\s*5(?![\da-z])|(?:pro|max)5(?![\da-z个月天年周刀元块美折次条张位u]))/.test(
      text,
    )
  ) {
    attrPlan = "pro5";
  } else if (/(?:\b(?:business|team)\b|(?<!s)team(?![a-z])|团队版)/.test(text)) {
    attrPlan = "team";
  } else if (/(?:\b|(?<=chatgpt|gpt|codex|cursor|claude|gemini|grok|gr0k|g))plus(?:\b|(?=\d))/.test(text)) {
    attrPlan = "plus";
  } else if (/(?:\b|(?<=chatgpt|gpt|codex|cursor|claude|gemini|grok|gr0k|g))free(?:\b|(?=\d))|免费版|普号/.test(text)) {
    attrPlan = "free";
  } else if (/(?:\b|(?<=claude|gemini|grok|gr0k))ultra(?:\b|(?=\d))/.test(text)) {
    attrPlan = "ultra";
  } else if (/(?:\b|(?<=gemini|claude|cursor|kiro|gpt|chatgpt|openai|grok|gr0k|g))pro(?:\b|(?=\d))/.test(text)) {
    attrPlan = "pro";
  }

  // 3. 时长 (duration)：仅过滤天/周/小时级及纯质保月/半年修饰，保留“1个月充值”“质保订阅1个月”，并封堵区间与老号年限穿透。
  let attrDuration = "";
  const durationText = text
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
  if (
    /(年卡|包年|(?<![\d.\-~到])1年(?![多内以前后上老半\d])|(?<![不足用活过每第])一年(?![多内以前后上老半])|(?<![\d.\-~到])365天(?![内以上])|(?<![\d.\-~到])12个月(?![内以上老]))/.test(
      durationText,
    )
  ) {
    attrDuration = "year";
  } else if (/(?<![\d.\-~到])6个月(?![内以上老半])|(?<![一二三四五六七八九十])六个月(?![内以上老半])|(?<!前|近|满|过|超过|不足)半年(?![多内以前后上老])/.test(durationText)) {
    attrDuration = "half-year";
  } else if (/(?<![\d.\-~到])3个月(?![内以上老半])|(?<![一二三四五六七八九十])三个月(?![内以上老半])|季卡|季度/.test(durationText)) {
    attrDuration = "quarter";
  } else if (
    /(月卡|包月|(?<![\d一二三四五六七八九十.\-~到])(?:1|一)个月(?![多内以前后上老半])|(?<![\d.\-~到])30天(?![内以上老])|(?<![\d.\-~到])28天(?![内以上老])|(?<![\d\-~])20-30天|(?<![\d\-~])21-30天)/.test(
      durationText,
    )
  ) {
    attrDuration = "month";
  } else if (/(周卡|(?<![\d.\-~到])7天(?![内以上老])|(?<![\d.\-~到])1周(?![内以上老])|(?<![每各已活满过近超前])一周(?![多内以前后上老]))/.test(durationText)) {
    attrDuration = "week";
  } else if (/(日卡|(?<![\d到\-~.])1天(?![内以上])|(?<![\d到\-~.])24小时(?![内以上]))/.test(durationText)) {
    attrDuration = "day";
  }

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
    .replace(/(\d)-(\d)/g, "$1至$2")
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
): NormalizedOffer {
  const cleanName = cleanProductName(item.rawName);
  const brandGroup = detectBrandGroup(item.rawName, item.shopCategory);
  const attrs = extractAttributes(item.rawName, item.shopCategory);
  // 同名但品牌或结构化规格不同的商品不应合并；完整标题避免长名称尾部规格丢失。
  const scope = [brandGroup, ...Object.values(attrs)].join("|");
  const groupKey = buildGroupKey(cleanName, scope);

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
