import type { ProductGroup } from "../../types";

export const MULTI_PRODUCT_BUNDLE = /(?:[双多](?:品牌|平台|会员|订阅|套餐|账号)|全家桶|组合包|套装|套餐任选|多合一|[2-9二三四五六七八九十]\s*合\s*一|[2-9二三四五六七八九十]\s*合\s*1)/;
const BUNDLE_EXCLUSION = /(?:非|不含|不包|不是)\s*(?:全家桶|组合包|套装|[2-9二三四五六七八九十]\s*合\s*[一1])/g;
const EXCLUDED_SUBJECT = String.raw`(?:\b(?:chatgpt|codex|claude|gemini|grok|cursor|kiro|deepseek|antigravity)\b|\bx\s*(?:premium|订阅|会员)|反重力)(?:\s*(?:premium|super|plus|pro|ultra|订阅|会员)(?![a-z]))?`;
const EXCLUDED_SUBJECT_LIST = new RegExp(
  String.raw`不(?:包含|包括|支持|提供|适用|含|包|带)\s*${EXCLUDED_SUBJECT}(?:\s*[/／、]\s*${EXCLUDED_SUBJECT})+`, "g",
);
const GROK_ALIAS = /\bg[\s.·_-]*r[\s.·_-]*(?:[o0]|[✱★*])?[\s.·_-]*k(?=$|[^a-z])|\bgro(?=\s*[·+./]|\s+(?:super|premium|ultra|heavy|free|ai\b|长效|普号|成品)\b)/g;

/** Exclusions in a seller title do not provide positive bundle or product evidence. */
export function withoutBundleExclusions(text: string): string {
  return text.replace(EXCLUDED_SUBJECT_LIST, " ").replace(BUNDLE_EXCLUSION, " ");
}

/** Matching aliases are applied only to the subject scan, so titles and group keys retain their source text. */
export function canonicalSubjectText(text: string): string {
  return text.replace(GROK_ALIAS, "grok")
    .replace(/\bgork\b|\bsupergork\b|格洛克|g[—–]+rok/g, "grok")
    .replace(/\b(?:ulrta|utarl|urtal|ulltra|ulrra)\b/g, "ultra")
    .replace(/\b(?:plua|puls|pius)\b/g, "plus")
    .replace(/\bg0rk\b/g, "grok")
    .replace(/\bg2ok(?=\s*(?:旧版\s*)?super\b)/g, "grok")
    .replace(/\bkro\s*pro(?=\s*\+\s*\d+(?:k|万)?\s*积分)/g, "kiro pro")
    .replace(/\bt[-‐‑–—]witter\b/g, "twitter")
    .replace(/\bgrk\b(?=\s+(?:plus|premium|super|heavy|ultra)|[^a-z]|$)/g, "grok")
    .replace(/(?:^|\b)superheavy(?=\s|[一二三四五六七八九十\d月季年]|$)/g, "grok heavy")
    .replace(/\bgro(?=\s*(?:[【[(])?\s*(?:普号|成品|长效))/g, "grok")
    .replace(/(?:吉皮t|吉pt|哥pt|鸡皮提|🐔pt)(?=$|[^a-z])/g, "gpt").replace(/\b(?:c[o0]edx|c0dex|coxde)\b/g, "codex")
    .replace(/\bch-?at(?=\s*(?:free|plus|pro|team)\b)/g, "chatgpt")
    .replace(/\b(?:g[.。,+·`_-]*p[.。,+·`✱*_-]+t|g[.。,+·`_-]+tp|gjpt)\b/g, "gpt")
    .replace(/\b(?:g[.。_\s-]*t[.。_\s-]+p+|gtp|gqt|gtpp|gp[✱*]|(?:吉|哥|鸡皮|🐔)\s*(?:p\s*t|皮t|提))(?=$|[^a-z])/g, "gpt")
    .replace(/\bgp(?=\s+(?:plus|free|pro|team)\b)/g, "gpt");
}

type EvidenceRule = readonly [group: ProductGroup, pattern: RegExp];
const BUNDLE_PRODUCTS: readonly EvidenceRule[] = [
  ["ChatGPT", /chatgpt|\bgpt(?:plus|pro|free|team)?\b/],
  ["Codex", /\bcodex\b/],
  ["Claude", /claude|克劳德/],
  ["Gemini", /gemini|google\s*ai\s*(?:pro|ultra)/],
  ["Grok", /grok|格洛克/],
  ["Cursor", /cursor/],
  ["平台账号", /(?:订阅\s*x\b|\bx\s*(?:订阅|premium|会员)|[+·/|,，]\s*x(?:$|[^a-z0-9])|x\s*[/+·]\s*cursor)/],
];

export function hasNamedMultiProductBundle(text: string): boolean {
  if (!MULTI_PRODUCT_BUNDLE.test(text)) {
    return /grok\s*(?:[+·/|]|(?:[\s-]+(?:premium|plus|super|ultra))\s*\+)\s*(?:x\s*[+·/|]\s*)?cursor|cursor\s*\+\s*grok/.test(text);
  }
  return BUNDLE_PRODUCTS.filter(([, pattern]) => pattern.test(text)).length > 1;
}

const MAILBOX = /(?:ic\s*邮箱|\b(?:gmx|mail|outlook)\.(?:com|de|es)\b|(?:gmail|gamil|googlemail|outlook|hotmail|icloud|proton|微软|谷歌|域名|隐私|临时|gmx|mailcode)(?:\s*\.?[a-z]{2,3}\b)?(?:\s*(?:临时|隐私|子)?邮箱|\s*邮件)|\b(?:outlook|hotmail|gmail|gamil)(?:[._-][a-z]+)?\b)/;
const MAILBOX_CONTEXT = /\b(?:mail|gmx|outlook)\.(?:com|de|es)\b|邮箱|邮件|邮箱别名|收件|取件|收发|可收件|不可发件|辅邮|oauth2|graph|imap/;
const MAILBOX_ACCESSORY = /(?:邮箱|gmail|hotmail|outlook|icloud)(?:账号)?(?:注册|提供|交付|登录)|带(?:账密|rt).{0,12}邮箱/;
const KNOWN_TIER = /(?<![a-z])(?:plus|free|team|business)(?![a-z])/;
const ACCOUNT_TRADE = /成品|独享会员|半价资格|普号|已接[码马]|未接[码马]|接[码马]\s*free|注册[^|]{0,8}free|首登|车位|席位|轮转|(?:长效|[头首二三])车|\bat\s*号|\bteam\s*[\d×x]+/;
const TEAM_SEAT = /(?:\d+\s*[x×]\s*|(?<![a-z]))team\s*(?:\d+\s*[x×]\s*)?(?:长效|拼车|[首头二三四]车|车位|席位|子号|母号)/;
const NAMED_ACCOUNT = /(?:muse|claude|gemini|codex|grok|cursor|kiro)(?:[^|,，。]{0,22})(?:成品号?|独享号|普号|席位)|(?:^|[\s【[(])g\s*(?:普号|成品|老号)|(?:claude|克劳德)\s*(?:kyc\s*)?(?:普通|免费|自用)?\s*(?:账号|帐号|普号)|muse(?:\s*ai)?[\s\d亿万]*(?:tokens?\s*)?(?:成品|账号)|team[\s\d×x]*(?:长效|拼车|车位|子号|母号)|(?:chatgpt|codex|claude|gemini|grok|cursor|kiro)(?:\s*(?:pro|plus|free|ultra|premium|max|super|team))?\s*(?:成品|普号|老号|账号|帐号|独享|席位)|(?:plus|free|team)\s*[-| ]*\s*(?:成品|子号|老号|白号|账号|帐号|席位)|(?:^|[\s[【(])(?:plus|free|team)\s*[-|]\s*|(?:g|gpt|chatgpt|openai|grok)\s*(?:free|plus|team)(?=$|[^a-z])/;
const PLATFORM_SUBJECT = /(?:^|[\s【[(])x\s*(?:[新老白普]号|(?:新|老|白|普)?账号)|\b(?:github|amazon)\b[^|]{0,15}(?:老号|账号|买家号|新注册)|\b(?:x|twitter)(?:[\s-]+twitter)?\s*(?:自助)?卡密|(?:美区|日区|韩国区|日本|台湾)\s*[/【(\s-]*id账号|(?:\b(?:facebook|instagram|tiktok|twitter|threads|whatsapp)\b|推特|小红书|抖音|闲鱼|脸书|谷歌广告|\bad\s+grant\b|twitte推x|(?:^|[【[(])\s*x\s*(?:账号|帐号|推特)|(?:谷歌|google)\s*(?:谷歌)?(?:账户|账号))(?!\s*(?:接(?:码|马)|验证码))/;
const PLATFORM_DELIVERY = /账号|帐号|账户|成品|母号|老号|克隆号|卡密|绑定|注册|消费金|会员|cookie|2fa|白号|买家号|粉丝|直登/;

const OPENAI_NAME = /chat[\s·._-]*(?:g(?:p[\s·._-]*t)?)|open[\s/_-]*ai|\boai\b|\bgpt(?:plus|pro|free|team)?\b|g皮t/;
const OPENAI_ALIASED_PRODUCT = /(?:^|[^a-z])g[\s_·|-]*账号普号|(?:^|[^a-z])g[\s_·|-]*(?:\d+\s*[x×]\s*pro|k12|day|日抛|(?:plus|pro|free|go|team|business)(?=$|[^a-z])|(?:普|成品)号)/;
const OPENAI_TRADE = /成品(?:号|账号)?|专属普号|(?:普通|免费|独享)账号|半价资格|套餐|卡密|订阅|会员|点数|官充|直冲|直充|代充|卡冲|卡充|质保订阅|\bteam\b|[日天周月季年]卡/;
const ACCOUNT_HANDOFF = /已(?:接[码马]|绑手机)|未接[码马]|接[码马]\s*free|账密|首登|\brt\b|\b2fa\b/;
const ACCOUNT_CHANNEL = /(?:实卡|paypal|pp|upi|pix|kakao|gopay|momo|家宽|宽带|住宅ip|越南|菲律宾|菲区)(?:[^|，。]{0,14})(?:渠道|手搓|注册|开通|实付)|(?:家宽|宽带|住宅ip)(?:手搓|注册)/;
const CODEX_DELIVERY = /\bcodex\s*(?:free|账号|帐号|成品号|普号|[a-z]{0,4}\s*\d+\s*[x×]\s*pro)|(?:^|[^a-z])(?:g|gpt|openai)?[\s·/_-]*codex[\s·/_-]*(?:(?:gpt|g)[\s·/_-]*)?(?:plus|pro(?:\d+|[\s·-]+[x×]?\d+)?|go\b|k12|team|充值|点数|额度|成品|专用\s*(?:rt|账号)|独享)/;
const CODEX_EXPLICIT = /\bcodex\s*会员|\bcodex\s*已接[码马]|(?:^|[^a-z])codex\s*(?:专用\s*(?:rt|账号)|手机已验证|(?:新|老|高质)?成品|(?:新|老)号)|(?:已接[码马]|未接[码马])\s*codex(?=$|[^a-z])/;

function isAccountTransferMailbox(text: string): boolean {
  return /(?:账号|账户)(?:转移|迁移)/.test(text)
    && /(?:微软|谷歌|hotmail|outlook|gmail|icloud)\s*(?:空|换绑)邮箱/.test(text);
}

/** Resolve overlapping GPT/Codex labels using the service next to the deliverable. */
export function openAiSubject(text: string, category: string): "ChatGPT" | "Codex" | undefined {
  if (isAccountTransferMailbox(text)) return undefined;
  const directCodexAccount = /\bcodex\s*(?:free|账号|帐号|成品号|普号|专用rt)/.test(text);
  const explicitCodex = directCodexAccount || CODEX_DELIVERY.test(text) || CODEX_EXPLICIT.test(text);
  const explicitGpt = OPENAI_NAME.test(text) && OPENAI_TRADE.test(text) || OPENAI_ALIASED_PRODUCT.test(text);
  const codexUsageOnly = /(?:仅|只)?(?:支持|可)(?:网页|web|直接|登录|使用|用){0,4}\s*codex\b|(?:gmail|邮箱)(?:[^|，。]{0,6})codex(?=$|[^a-z])/.test(text)
    && /plus\s*成品|成品[^|]{0,10}plus/.test(text);
  if (/\bcodex\b[^|，。]{0,16}(?:g\s*\d+\s*x\s*pro|正价订阅|专用rt)|(?:codex[^|，。]{0,12})\d+\s*个起拍/.test(text)) return "Codex";
  if (directCodexAccount || explicitCodex && !codexUsageOnly) return "Codex";
  if (/^(?:[\s【[(])*(?:全绿)?家宽.{0,12}free(?:号|普号|$)/.test(text) ||
      /\bfree\b/.test(text) && /(?:已经|已)(?:验证|接码|绑手机)/.test(text) && /(?:^|[^a-z])g(?:$|[^a-z])/.test(text)) return "ChatGPT";
  if (explicitGpt) return "ChatGPT";
  const personalTopUp = /(?:充值|代充|直充|直冲|卡充|卡冲|官充|官冲)/.test(text)
    && /(?:直充|直冲|充值|充)(?:到|入)?(?:你|您|自己|本人|个人)(?:的)?(?:号|账号|账户)|(?:手工|手动|人工)充值|苹果原生支付/.test(text);
  if (personalTopUp && /(?<![a-z])(?:go|plus|pro)\s*(?:[.\s]|\d|$|[套餐订阅充]).{0,24}/.test(text)
      && !/claude|gemini|antigravity|grok|kiro|cursor|muse|deepseek|镜像/.test(text)) return "ChatGPT";
  if (/\bgo\s*(?:会员|订阅).{0,8}(?:官方|正规)?(?:直充|直冲|充值|代充)/.test(text)) return "ChatGPT";
  if (/\bplus\b[^|]{0,16}(?:会员|订阅).{0,16}(?:实卡|支付|实付|可续费|账单)/.test(text)
      && !/claude|gemini|antigravity|grok|kiro|cursor|muse|deepseek|邮箱专用|换绑邮箱/.test(text)) return "ChatGPT";

  const tier = /(?<![a-z])(?:plus|pro|max|free|team|business)(?![a-z])/i.test(text);
  const gCategory = /(?:^|[\s【[(])(?:g[\s/|_-]*(?:[系帐账成普]|代充|$)|gpt|chatgpt|openai)/.test(category);
  if (codexUsageOnly && (gCategory || /plus\s*成品|成品[^|]{0,10}plus/.test(text))) return "ChatGPT";
  if (gCategory && (/\bgo\s*(?:官方|官网)?(?:充值|直充|代充|月卡|订阅)/.test(text)
      || /\bgo\s*cdk(?![a-z])/.test(text) && /官方充值|正规充值|官方直充/.test(text))) return "ChatGPT";
  if (tier && /(?:pro\s*(?:max)?\s*\d{2,3}|\d{2,3}\s*(?:刀|美元)\s*pro)/.test(text)
      && OPENAI_TRADE.test(text) && (gCategory || /^直充代充$/.test(category))) return "ChatGPT";
  if (/\bpro\s*\d{1,2}\s*[x×][^|]{0,18}成品号/.test(text) && gCategory) return "ChatGPT";
  const planOnlyOpenAi = /(?:[25]0\s*[x×]|5\s*[x×])/.test(text) && /充值|[月季年]卡|订阅|卡付/.test(text);
  const openAiPlanCategory = /^(?:[\s【[(])*(?:g(?:$|[\s/|系列])|gpt|chatgpt|openai|\d+[x×]\s*\(无质保\))/.test(category);
  if (planOnlyOpenAi && openAiPlanCategory && !/claude|gemini|antigravity|grok|cursor|kiro|muse|deepseek/.test(text)) return "ChatGPT";
  const explicitCategory = /^(?:[\s【[(])*(?:openai\s+)?codex(?=$|[^a-z])/.test(category)
    && !/chatgpt|gemini|claude|grok|[与和及或]|专用/.test(category);
  const gptDocumentedTier = /(?:^|[^a-z])(?:g|gpt)\s*pro\s*[x×]\s*(?:5|20|25|50)|\bk12\b[^|]{0,16}(?:空间|成品|母号|席位)/.test(text);
  if (gptDocumentedTier) return explicitCategory ? "Codex" : "ChatGPT";
  if (/\b(?:free|plus)\b[^|]{0,15}(?:账号|普号|临期号)/.test(text)
      && /生图|首登|未接[码马]|已接[码马]|账密|(?:微软|icloud)邮箱/.test(text)) return explicitCategory ? "Codex" : "ChatGPT";
  const freeAccount = /(?:^|[^a-z])(?:free\s*(?:号|普号|白号)|(?:接[码马]\s*free|free\s*[-|]|free.{0,8}(?:邮箱|生图)))/.test(text)
    && ACCOUNT_HANDOFF.test(text);
  if (explicitCategory && (freeAccount || TEAM_SEAT.test(text) || /\bteam\s*席位/.test(text))
      && !/提链|提取支付|扫码支付/.test(text)) return "Codex";
  if (/仅用于codex登录|只用于codex登录/.test(text) && /已注册|已接[码马]/.test(text) && /2fa|账密/.test(text)) return "Codex";
  if (/\bpro\s*\d+[x×]?\s*(?:临期号|成品号)|(?:^|[^a-z])\d+x\s*ios成品/.test(text) && gCategory) return "ChatGPT";
  if (/半价资格号|试用资格号/.test(text) && (/\bplus\b|非成品plus|不是成品plus|free|半价/.test(text) || gCategory) &&
      !/换绑邮箱专用|邮箱专用/.test(text)) return explicitCategory ? "Codex" : "ChatGPT";
  if (/\bteam\s*(?:子号|席位)|[15]x长效.{0,6}不踢|(?:真)?[1-4一二三四][车輪轮].{0,10}踢/.test(text) && /team|席位|车位/.test(category)) {
    return explicitCategory ? "Codex" : "ChatGPT";
  }
  if (freeAccount || TEAM_SEAT.test(text) || /\bteam(?:x\d+|\s*\d+\s*[x×])?[^|]{0,10}(?:到空间|母号|长效)/.test(text)) return "ChatGPT";
  if (/\bk12\b/.test(text) && /cpa|sub2|账密|成品/.test(text) && /(?:^|[\s/|])g(?:$|[^a-z])|k12/.test(category)) return "ChatGPT";
  if (tier && ACCOUNT_CHANNEL.test(text) && (ACCOUNT_HANDOFF.test(text) || /日抛|订阅|一卡一绑/.test(text))) return "ChatGPT";
  if (tier && /(?:微软|谷歌|gmail|icloud|域名)\s*邮箱/.test(text)
      && /(?:代充|成品|老号|白号|半价资格|[日周月季年]卡|已绑手机)/.test(text) && explicitCategory) return "Codex";
  return undefined;
}

export function accountSubject(text: string, category: string): { group: ProductGroup; ruleId: string } | undefined {
  const explicitMailbox = MAILBOX.test(text);
  if (isAccountTransferMailbox(text)) {
    return { group: "邮箱账号", ruleId: "mailbox-for-account-transfer" };
  }
  const mailboxDelivery = /(?:换绑|隐私|临时|子)邮箱|(?:非|不是)成品plus|(?:上号|收件|取件)专用/.test(text);
  const namedAiAccount = /\b(?:claude|codex|gemini|muse|grok|kiro|cursor|chatgpt|openai)\s*(?:(?:普通|免费|全新|独享)\s*)?(?:free|plus|pro|max|ultra|team|普号|成品|账号)/.test(text)
    || NAMED_ACCOUNT.test(text) && /claude|codex|gemini|muse|grok|kiro|cursor|chatgpt/.test(text);
  if (explicitMailbox && mailboxDelivery && !/半价资格号|试用资格号/.test(text) &&
      /换绑邮箱|非成品plus|不是成品plus|(?:注册|绑定)(?:openai|claude|codex)专用/.test(text)) {
    return { group: "邮箱账号", ruleId: "mailbox-delivery" };
  }
  if (explicitMailbox && /(?:不包|不含|非|包)gcp/.test(text) && !namedAiAccount && !/gemini.{0,10}(?:pro|账号|成品)/.test(text)) {
    return { group: "邮箱账号", ruleId: "mailbox-delivery" };
  }
  const mailboxDirectory = /邮箱|\b(?:gmail|outlook|hotmail|icloud)\b/.test(category);
  if (mailboxDirectory && /oauth2\s*令牌号/.test(text) && /\b(?:imap|pop3?|graph)\b/.test(text)) {
    return { group: "邮箱账号", ruleId: "mailbox-protocol-category" };
  }
  if (!namedAiAccount && mailboxDirectory && /谷歌.{0,13}(?:老号|随机地区)|(?:老号|随机地区).{0,13}谷歌/.test(text)
      && !/谷歌账号|google账户/.test(text)) {
    return { group: "邮箱账号", ruleId: "mailbox-age-category" };
  }
  const socialClone = /克隆号/.test(text) && /\buid\b/.test(text) && /好友|bm验证码/.test(text);
  if (socialClone) return { group: "平台账号", ruleId: "social-account-delivery" };
  const accountOnlyGoogle = /(?:\bgoogle\b|谷歌)(?:[\s|【】()[\]-]*(?:普通|新|白|老|普))?[\s|【】()[\]-]*(?:账号|帐号|号|账户)|(?:老|白|普)号[^|]{0,20}(?:\bgoogle\b|谷歌)/.test(text) &&
    !explicitMailbox && !/gemini|gcp|antigravity|反重力/.test(text);
  const googleMailbox = explicitMailbox && /(?:谷歌|google)\s*(?:账号|账户)/.test(text)
    && /gmail|邮件收发|收件|取件/.test(text) && !/youtube\s*(?:成品|账号|会员)|谷歌广告/.test(text);
  if (!namedAiAccount && !googleMailbox && (PLATFORM_SUBJECT.test(text) || accountOnlyGoogle) && PLATFORM_DELIVERY.test(text) &&
      !/(?:接(?:码|马|ma)|短信验证|教程|教学|运营教程)/.test(text)) {
    return { group: "平台账号", ruleId: "explicit-platform-account" };
  }
  const enterpriseMailbox = /企业谷歌|谷歌企业邮|企业gmail/.test(text) && /(?:收件|发件|收发)/.test(text);
  const ageOnly = /(?:随机地区|批量入口|(?:20\d{2}|\d{2})\s*(?:到|[-~至])\s*(?:20\d{2}|\d{2})年?).{0,14}(?:批量|老号|邮箱|高权重|随机|[【】]|$)/.test(text)
    && !/gemini|codex|chatgpt|gpt|claude|kyc|反重力|成品号/.test(text);
  if (mailboxDirectory && ageOnly) return { group: "邮箱账号", ruleId: "mailbox-age-category" };
  if (/\bzoho(?:mail)?\.com\b/.test(text) && /邮箱|imap|pop3/.test(text + " " + category)) {
    return { group: "邮箱账号", ruleId: "mailbox-delivery" };
  }
  if ((!explicitMailbox && !enterpriseMailbox) || !MAILBOX_CONTEXT.test(text)) return undefined;
  if (namedAiAccount) return undefined;
  if (/\bonet\.pl|\bgmx\.(?:com|es)|\bmail\.com/.test(text) && /邮箱/.test(text)) return { group: "邮箱账号", ruleId: "mailbox-delivery" };
  const tier = KNOWN_TIER.test(text);
  if (explicitMailbox && /(?:用于|适合|供)?(?:注册|绑定)openai专用|接(?:码|马)邮箱.{0,15}(?:注册|用途)/.test(text)
      && !namedAiAccount && !/成品(?:号|账号)|\bfree\b/.test(text)) return { group: "邮箱账号", ruleId: "mailbox-for-registration" };
  const signupMailbox = /(?:邮箱|邮件)(?:[^|,，]{0,12})(?:用于|供|注册)?(?:openai|chatgpt|codex|claude|gemini)(?:专用|注册|认证)/.test(text)
    && !NAMED_ACCOUNT.test(text);
  if (signupMailbox) return { group: "邮箱账号", ruleId: "mailbox-for-registration" };
  if (TEAM_SEAT.test(text) || NAMED_ACCOUNT.test(text) || (tier && ACCOUNT_TRADE.test(text))) {
    if (/(?:^|[】)｜|\s])gro(?:k)?(?=\s*(?:ai|普号|成品|长效|free|独享|$))/.test(text)) {
      return { group: "Grok", ruleId: "grok-account-delivery" };
    }
    const codexCategory = /(?:^|[\s【/])(?:codex|code\s*x)(?=$|[^a-z])/.test(category) &&
      !/chatgpt|openai|gemini|claude|grok|[与和及或]\s*codex|(?:^|[\s/])g(?:pt)?(?:\s|$)/.test(category);
    if (codexCategory && /(?:g\s*free|\bfree\b)/.test(text) &&
        !/不支持codex|非codex|chatgpt\s*free|openai(?:普通|免费|全新)?账号/.test(text)) {
      return { group: "Codex", ruleId: "codex-account-category" };
    }
    if (tier && !/(?:chatgpt|openai|\bg(?:[\s.-]*p[\s.,-]*t)?\b)/.test(text)) {
      if (codexCategory) {
        return { group: "Codex", ruleId: "codex-account-category" };
      }
      if (/\bfree\b/.test(text) && /(?:gpt|openai|chatgpt|\bg\b)/.test(canonicalSubjectText(category))) {
        return { group: "ChatGPT", ruleId: "chatgpt-account-category" };
      }
    }
    return undefined;
  }
  if ((MAILBOX_ACCESSORY.test(text) || /账密|sso|直登/.test(text)) &&
      /(?:^|[】)｜|\s])gro(?:k)?(?=\s*(?:ai|普号|成品|长效|free|独享|$))/.test(text)) {
    return { group: "Grok", ruleId: "grok-account-delivery" };
  }
  return { group: "邮箱账号", ruleId: "mailbox-delivery" };
}
