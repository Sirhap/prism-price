(() => {
  const STORAGE_KEY = "ldxp_lang";
  const COOKIE_NAME = "ldxp_lang";

  /** 完整英文翻译字典（覆盖首页静态框架及 /about/、/guide/*、/open-store-guide/ 子页面） */
  const EN = {
    // 公共导航 & 页脚
    "nav.langBtn": "中文",
    "nav.langAria": "Switch language to Chinese",
    "nav.langTitle": "切换到简体中文",
    "nav.home": "PRISM Home",
    "nav.backHome": "Back to PRISM Home",
    "nav.about": "About PRISM",
    "nav.guide": "Comparison Guide",
    "nav.aiPricing": "AI Pricing Guide",
    "nav.integrationCodes": "Integration Codes",
    "nav.openStore": "Open a Store",
    "nav.catalogShops": "Shop Directory",
    "nav.catalogProducts": "Product Directory",
    "nav.catalogBrands": "Brand Directory",
    "nav.codeDirectory": "Code Directory",
    "nav.breadcrumbHome": "PRISM Home",

    // 页面标题（用于前端手动切换语言时实时更新 document.title）
    "pageTitle./": "PRISM Parity | AI Subscriptions & Digital Store Price Comparison",
    "pageTitle./about/": "About PRISM Parity | Store Index, Integration Codes & Setup Guide",
    "pageTitle./guide/": "AI Subscription Price Comparison Guide | PRISM Parity",
    "pageTitle./guide/ai-pricing/": "ChatGPT, Codex, Claude & Gemini Pricing Guide | PRISM Parity",
    "pageTitle./guide/integration-codes/": "Store Integration Code Guide | PRISM Parity",
    "pageTitle./guide/open-store/": "Store Onboarding & Indexing Guide | PRISM Parity",
    "pageTitle./open-store-guide/": "3-Step Store Setup & Supplier Guide | PRISM Parity",

    // 首页顶栏与 Hero
    "home.brandName": "PRISM Parity",
    "home.brandSub": "AI & Digital Goods Multi-Store Radar",
    "home.workbenchPrefix": "Saved",
    "home.workbenchSub": " & Compare",
    "home.workbenchTitle": "Open saved items and side-by-side comparison workbench",
    "home.themeAria": "Toggle light/dark theme",
    "home.submitShop": "Submit Shop",
    "home.openStoreCta": "Open a Store",
    "home.eyebrow": "PRISM LIVE INDEX · MULTI-STORE PRICE AGGREGATOR",
    "home.tabProducts": "Compare Products",
    "home.tabShops": "Browse Shops",
    "home.heroHeadlineHtml": "AI Subscriptions &amp; Digital Goods, <span>Prices at a Glance</span>",
    "home.heroSubtitle": "Aggregating public storefront listings for AI subscriptions, API relays, and digital goods. Filter by brand, tier, and price. Search-only directory — verify live price and stock on the seller's site.",
    "home.kunEgg": "🐔 2.5-Yr Parity Trainee · 🏀",
    "home.kunEggAria": "Open Easter egg",
    "home.searchLabel": "Search products, categories, or shops",
    "home.searchPlaceholderProduct": "Search ChatGPT Plus, Claude Pro, Codex, US region, or shop name...",
    "home.searchPlaceholderShop": "Search shop name, main categories, platform, or URL...",
    "home.clearSearchAria": "Clear search",
    "home.sortLabel": "Sort order",
    "home.sortRelevance": "Relevance (Popularity / Shops)",
    "home.sortPriceAsc": "Lowest Price First",
    "home.sortUpdatedDesc": "Recently Updated",
    "home.searchBtn": "Search",
    "home.searchHint": "Enter keywords and press Search or Enter · Supports space-separated terms",
    "home.shareFilters": "Share Link",
    "home.shareFiltersTitle": "Copy link with current filters",
    "home.metricShops": "Indexed Shops",
    "home.metricGroups": "Product Groups",
    "home.metricOffers": "Tracked Offers",

    // 首页工作台与筛选
    "home.brandRailTitle": "Brands & Categories",
    "home.shopSystemLabel": "Store Platform",
    "home.shopAllSystems": "All Platforms",
    "home.shopOnlyInStock": "With products only",
    "home.shopHasCode": "Has integration code",
    "home.resetFilters": "Reset Filters",
    "home.shopSystemNote": "Domains not matching known platforms are grouped as Self-hosted (Unverified).",
    "home.customPriceLabel": "Custom ¥",
    "home.customMinPlaceholder": "Min",
    "home.customMaxPlaceholder": "Max",
    "home.customMinAria": "Custom minimum price",
    "home.customMaxAria": "Custom maximum price",
    "home.applyBtn": "Apply",
    "home.resultLoading": "Loading market index...",
    "home.resultNote": "Click any offer to inspect merchant profile & sync status · Verify prices on seller page",
    "home.viewList": "List",
    "home.viewListTitle": "Single-column detailed list",
    "home.viewGrid": "Grid",
    "home.viewGridTitle": "Two-column card grid",
    "home.retry": "Retry",
    "home.loadMoreProducts": "Load More Products",
    "home.loadMoreShops": "Load More Shops",
    "home.productEmpty": "No matching products found. Try adjusting your query or resetting filters.",
    "home.shopEmpty": "No matching shops found.",
    "home.footerBrandSub": "· Public Store Index & Reference Pricing",
    "home.footerKunBtn": "🐔 · 2.5 Years Training",
    "home.footerAbout": "About PRISM",
    "home.footerGuide": "Price Guide",
    "home.footerBrands": "Brands",
    "home.footerCodes": "Integration Codes",
    "home.footerShops": "Shops",
    "home.footerProducts": "Products",
    "home.footerOpenStore": "Merchant Onboarding ↗",
    "home.disclaimerHtml": "<strong>Disclaimer:</strong> PRISM only indexes publicly available storefront listings. We do not participate in transactions or guarantee goods, after-sales support, or risks. Verify details before purchasing.",

    // 浮条 & 弹窗
    "home.compareDockTitle": "Compare Tray",
    "home.compareNowHtml": "Compare Now (<em id=\"compareDockCount\" style=\"font-style: normal\">0</em>/4)",
    "home.clearBtn": "Clear",
    "home.backToTop": "Back to top",
    "home.guideKicker": "OPEN STORE GUIDE",
    "home.guideTitle": "Open Store & Connect Suppliers",
    "home.guideCloseAria": "Close onboarding guide",
    "home.guideStep1TabHtml": "<span>1</span>Register Store",
    "home.guideStep2TabHtml": "<span>2</span>Find Suppliers",
    "home.guideStep3TabHtml": "<span>3</span>Connect Code",
    "home.guideP1Label": "Step 1 / Register Store",
    "home.guideP1Title": "Open Your Own Storefront",
    "home.guideP1Desc": "Go to LDXP and follow the platform instructions to register and configure your storefront, then come back for the next step.",
    "home.guideP1ReadyTitle": "Ready to start?",
    "home.guideP1ReadyDesc": "The registration page will open in a new tab.",
    "home.guideP1Cta": "Go to Register ↗",
    "home.guideP1Foot": "Registration, fees, and operating rules are subject to the third-party platform.",
    "home.guideP2Label": "Step 2 / Find Suppliers",
    "home.guideP2Title": "Find Shops with Integration Codes",
    "home.guideP2Desc": "Switch to \"Browse Shops\", check \"Has integration code\", and click any shop's code badge to copy it.",
    "home.guideP2How1Html": "<b>1</b><span>Browse Shops</span>",
    "home.guideP2How2Html": "<b>2</b><span>Has integration code</span>",
    "home.guideP2How3Html": "<b>3</b><span>Click badge to copy</span>",
    "home.guideP2Btn": "View Shops with Codes ↗",
    "home.guideP2Foot": "This guide collapses to the bottom bar while you browse. Please verify supplier prices and after-sales terms yourself.",
    "home.guideP3Label": "Step 3 / Connect Supplier",
    "home.guideP3Title": "Enter the Code in Merchant Dashboard",
    "home.guideP3Desc": "Open your LDXP merchant dashboard, go to \"Supply → Connect Supplier\", paste the integration code, search, and link.",
    "home.guideP3Cap1": "Reference: Supply → Connect Supplier → Search by code",
    "home.guideP3Cap2": "Demo: Shop names and transaction figures shown are fictional examples.",
    "home.guideBack": "Previous",
    "home.guideNext": "Next →",
    "home.guideFloatTitle": "Onboarding · 02 / 03",
    "home.guideFloatHeading": "Filtered shops with integration codes",
    "home.guideFloatDesc": "Click any code badge next to a shop name to copy, then continue.",
    "home.guideFloatBack": "Back to Guide",
    "home.guideFloatNext": "Next →",
    "home.submitTitle": "Submit a Shop for Indexing",
    "home.submitDesc": "Enter a public digital storefront URL to add it to the shop directory.",
    "home.submitUrlLabel": "Shop URL",
    "home.submitCodeLabel": "Distributor / Integration Code (Optional)",
    "home.submitCodePlaceholder": "e.g., Lucky plus",
    "home.submitHint": "Supported platforms sync automatically after submission; others may wait for manual adapter review.",
    "home.submitPreviewRetry": "Retry Sync",
    "home.submitBack": "Back to Edit",
    "home.submitConfirm": "Submit",
    "home.profileOpenStore": "Open a Store ↗",
    "home.profileCloseAria": "Close modal",
    "home.workbenchTitleHeader": "Saved & Side-by-Side Compare",
    "home.workbenchCompareTabHtml": "Compare <small id=\"wbCompareCount\">0</small>",
    "home.workbenchFavTabHtml": "Saved <small id=\"wbFavCount\">0</small>",

    // /about/ 页面
    "about.crumb": "Platform Guide & FAQ",
    "about.h1": "About PRISM Parity: Storefront Comparison, Shop Index & Integration Codes",
    "about.leadHtml": "<strong>PRISM Parity</strong> is an information search and price comparison index for public digital storefronts. We aggregate snapshots from LDXP, CatFK, 16688, Dujiaoka, and ACG-Faka shops to help compare <strong>ChatGPT, Codex, Claude, Gemini, Cursor, Grok, DeepSeek</strong>, and API relay credits.",
    "about.ctaCompare": "Compare Live Prices",
    "about.ctaGuide": "3-Step Setup Guide",
    "about.ctaRegister": "Open LDXP Store ↗",
    "about.secTopics": "Directories & Quick Navigation",
    "about.card1Title": "Popular AI Category Directories",
    "about.card1Desc": "Compare multi-store pricing by brand, delivery type (Ready Account / Top-up / API Relay / SMS), plan tier, and duration:",
    "about.pillChatgpt": "ChatGPT (Plus / Pro / Team)",
    "about.pillCodex": "Codex Credits & Accounts",
    "about.pillClaude": "Claude (Pro / Max 5x / 20x)",
    "about.pillGemini": "Gemini (AI Pro / Ultra)",
    "about.pillCursor": "Cursor Coding Plan",
    "about.pillGrok": "Grok / SuperGrok",
    "about.pillRelay": "API Relay Credits",
    "about.pillAllBrands": "All Brands →",
    "about.card2Title": "Indexing, Integration Codes & Onboarding",
    "about.card2Desc": "Discover storefronts offering supplier integration codes or learn how to launch a store and submit it:",
    "about.pillShops": "Indexed Shop Directory",
    "about.pillProducts": "Aggregated Products",
    "about.pillCodes": "Integration Code Directory",
    "about.pillAiGuide": "AI Price Comparison Tips",
    "about.pillCodeGuide": "Code Discovery & Formatting",
    "about.pillOpenGuide": "Store Setup & Indexing",
    "about.pillVisualGuide": "3-Step Visual Setup Guide",
    "about.secFaq": "Frequently Asked Questions (FAQ)",
    "about.q1": "Which storefront platforms does PRISM Parity index?",
    "about.a1": "We index LDXP (wzyp.cn / pay.ldxp.cn), CatFK (catfk.com), 16688, Dujiaoka, ACG-Faka, and independent self-hosted storefronts, with filters for platform type, stock status, and integration codes.",
    "about.q2": "How do I compare ChatGPT, Codex, Claude, and Gemini prices across shops?",
    "about.a2Html": "Use the <a href=\"/\">homepage search bar</a> or left brand rail, filter by delivery type (Ready Account, Top-up / Redeem Key, API Relay, SMS), tier, and duration, then expand any product group to compare merchant quotes alongside official reference prices.",
    "about.q3": "What is a shop integration code and where can I copy one?",
    "about.a3Html": "Integration (distributor) codes let downstream storefronts connect upstream supplier catalogs. Switch to \"Browse Shops\" and enable \"Has integration code\", or browse the <a href=\"/catalog/integration-codes/\">Integration Code Directory</a> to copy public codes with one click.",
    "about.q4": "How can I open a store on LDXP and get listed on PRISM?",
    "about.a4Html": "Follow the <a href=\"/open-store-guide/\">3-step visual setup guide</a> and register via <a href=\"/go/open-store\" target=\"_blank\" rel=\"noopener noreferrer\">LDXP Merchant Registration</a>. List clearly named products, include <code>对接码：your_code</code> in your shop bio, then click \"Submit Shop\" on the homepage.",
    "about.q5": "Are displayed prices and stock levels real-time?",
    "about.a5": "Data is aggregated from periodic public snapshots and may lag behind live store updates. PRISM is a read-only index and does not handle transactions; always verify live prices, stock, and warranty terms on the seller's page before ordering.",
    "about.footerHtml": "PRISM Parity · <a href=\"/\">Back to Live Comparison</a> · <a href=\"/llms.txt\">LLMs Index</a>",

    // /guide/ 索引页
    "guide.crumb": "User Guide",
    "guide.h1": "AI Subscription Price Comparison Guide",
    "guide.leadHtml": "PRISM Parity indexes public digital storefronts to organize reference quotes for <strong>ChatGPT, Codex, Claude, Gemini, Cursor, Grok, DeepSeek</strong>, API relays, and digital goods.",
    "guide.c1Title": "ChatGPT / Codex / Claude / Gemini Guide",
    "guide.c1Desc": "Compare official subscription pricing with ready accounts, top-ups, and API relays.",
    "guide.c2Title": "Integration Codes Query & Formatting",
    "guide.c2Desc": "Filter shops with distributor codes and learn formatting rules for auto-discovery.",
    "guide.c3Title": "Merchant Onboarding & Indexing",
    "guide.c3Desc": "Storefront setup flow, product naming tips, and submitting your URL to PRISM.",
    "guide.s1h": "How to search and compare products?",
    "guide.s1pHtml": "Search keywords like <strong>ChatGPT, Codex, Claude, Gemini</strong> on the <a href=\"/\">homepage</a> or browse the <a href=\"/catalog/brands/\">Brand Directory</a>. Filter by type, tier, duration, and price, then expand a group to compare shops or add items to the Compare Tray.",
    "guide.s2h": "What should you verify before comparing prices?",
    "guide.s2p": "Check that items share the same plan tier, validity period, fulfillment type, and warranty policy. Ready accounts, official top-ups, redeem keys, SMS verification, and API relays carry different risk and usage models.",
    "guide.s3h": "How to filter shops by platform and integration code?",
    "guide.s3pHtml": "Switch to \"Browse Shops\" on the homepage to filter by <strong>LDXP, CatFK, 16688, Dujiaoka, ACG-Faka</strong>, or check \"Has integration code\" to copy codes directly. You can also browse the <a href=\"/catalog/shops/\">Shop Directory</a> and <a href=\"/catalog/integration-codes/\">Code Directory</a>.",
    "guide.s4h": "Are prices and stock updated in real time?",
    "guide.s4p": "Listings are collected from public store snapshots and may lag slightly. Click through to the source storefront to confirm live price, remaining stock, and description before buying.",
    "guide.s5h": "Who handles transactions and after-sales support?",
    "guide.s5p": "PRISM only indexes public data and is not involved in payments or fulfillment. Always review each merchant's delivery method and warranty terms independently.",
    "guide.footer": "PRISM Parity · Public Store Index, Multi-Store Comparison & Integration Codes",

    // /guide/ai-pricing/
    "aiGuide.crumb": "AI Pricing Guide",
    "aiGuide.h1": "ChatGPT, Codex, Claude & Gemini Pricing Comparison Guide",
    "aiGuide.leadHtml": "Comparing <strong>ChatGPT, Codex, Claude, and Gemini</strong> across public storefronts requires looking beyond headline prices—fulfillment method, exclusivity (dedicated vs. shared), and quota tiers matter. PRISM normalizes listings by brand, type, plan, and duration.",
    "aiGuide.s1h": "Official Subscription Benchmarks & Directories",
    "aiGuide.t1c1": "Brand",
    "aiGuide.t1c2": "Main Plans & Official Pricing",
    "aiGuide.t1c3": "Common Storefront Forms",
    "aiGuide.t1c4": "Compare Links",
    "aiGuide.r1c2": "Plus $20/mo · Team $25–30/seat/mo · Pro $200/mo",
    "aiGuide.r1c3": "Dedicated account, shared seat, official top-up, CDK key, Go pass",
    "aiGuide.r1c4Html": "<a href=\"/catalog/brands/ChatGPT/\">ChatGPT Directory</a> · <a href=\"/?group=ChatGPT\">Filter Home</a>",
    "aiGuide.r2c2": "Included with ChatGPT Plus ($20/mo) / Pro ($200/mo) or API billing",
    "aiGuide.r2c3": "Accounts with Codex CLI quota, team seats, compatible relay keys",
    "aiGuide.r2c4Html": "<a href=\"/catalog/brands/Codex/\">Codex Directory</a> · <a href=\"/?group=Codex\">Filter Home</a>",
    "aiGuide.r3c2": "Pro $20/mo · Max 5x $100/mo · Max 20x $200/mo",
    "aiGuide.r3c3": "Dedicated account, official top-up, API relay credits",
    "aiGuide.r3c4Html": "<a href=\"/catalog/brands/Claude/\">Claude Directory</a> · <a href=\"/?group=Claude\">Filter Home</a>",
    "aiGuide.r4c2": "Google AI Pro $19.99/mo · AI Ultra $249.99/mo",
    "aiGuide.r4c3": "US/multi-region ready accounts, family seats, student verified accounts",
    "aiGuide.r4c4Html": "<a href=\"/catalog/brands/Gemini/\">Gemini Directory</a> · <a href=\"/?group=Gemini\">Filter Home</a>",
    "aiGuide.s2h": "Fulfillment Formats: Ready Account vs. Top-up vs. Relay vs. SMS",
    "aiGuide.t2c1": "Fulfillment Type",
    "aiGuide.t2c2": "Filter Param",
    "aiGuide.t2c3": "Key Differences & Checks",
    "aiGuide.f1c1": "Ready Account",
    "aiGuide.f1c3": "Delivered with email/password. Always distinguish dedicated (password-changeable) vs. shared seats, and verify warranty length.",
    "aiGuide.f2c1": "Top-up / Redeem Key",
    "aiGuide.f2c3": "Applied to your own account or activated via CDK. Safer long-term; check whether login credentials are required for top-ups.",
    "aiGuide.f3c1": "API / Relay",
    "aiGuide.f3c3": "Pay-as-you-go token balance (e.g., One API / New API vouchers). Compare rate multipliers, concurrency limits, and supported models.",
    "aiGuide.f4c1": "SMS Verification",
    "aiGuide.f4c3": "One-time phone verification numbers for registration; low price, does not include paid subscription.",
    "aiGuide.noteHtml": "<strong>Tip:</strong> Sellers often use shorthand like <code>Max 5x</code>, <code>20x</code>, <code>Team</code>, or <code>Go</code>. Combining Brand + Type + Plan + Duration filters quickly filters out mismatched SMS or tutorial listings.",
    "aiGuide.s3h": "4-Step Verification Checklist",
    "aiGuide.li1Html": "<strong>Match exact specs:</strong> Compare dedicated accounts against dedicated accounts, and top-ups against top-ups.",
    "aiGuide.li2Html": "<strong>Benchmark against official cost:</strong> Offers far below official pricing are often shared seats, first-month promos, or short-warranty items.",
    "aiGuide.li3Html": "<strong>Verify live stock:</strong> PRISM shows cached snapshots; click through to the source store to confirm current availability.",
    "aiGuide.li4Html": "<strong>Read warranty terms:</strong> Check for first-login warranty, pro-rata refunds, or replacement guarantees.",
    "aiGuide.footerHtml": "PRISM Parity · <a href=\"/\">Back to Live Comparison</a> · <a href=\"/catalog/products/\">Browse All Products</a>",

    // /guide/integration-codes/
    "codeGuide.crumb": "Integration Code Guide",
    "codeGuide.h1": "Store Integration & Distributor Code Guide",
    "codeGuide.leadHtml": "For digital distribution, an <strong>integration code</strong> (distributor code) links upstream suppliers with downstream storefronts. PRISM automatically extracts public codes from shop names and descriptions for one-click copying.",
    "codeGuide.cta1": "Browse Integration Code Directory →",
    "codeGuide.cta2": "Filter Shops with Codes on Home",
    "codeGuide.s1h": "How to Find Integration Codes on PRISM",
    "codeGuide.s1li1Html": "<strong>Interactive filter:</strong> Visit the <a href=\"/\">homepage</a>, switch to \"Browse Shops\", check \"Has integration code\", and click any code pill to copy.",
    "codeGuide.s1li2Html": "<strong>Static directory:</strong> Open the <a href=\"/catalog/integration-codes/\">Integration Code Directory</a> to view platforms, item counts, and codes.",
    "codeGuide.s1li3Html": "<strong>Keyword search:</strong> Search a shop name or keyword in Shops mode to find upstream suppliers.",
    "codeGuide.s2h": "How Merchants Should Format Integration Codes",
    "codeGuide.s2p": "Our parser preserves exact casing, leading zeros, and internal spaces. Include a standalone line in your shop name or bio using recognized labels:",
    "codeGuide.s2li1Html": "<strong>Full labels:</strong> <code>对接码</code>, <code>对接代码</code>, <code>分销码</code> (followed by colon, space, or 为/是).",
    "codeGuide.s2li2Html": "<strong>Short prefixes:</strong> <code>对接：</code>, <code>分销：</code> (must be followed immediately by <code>:</code> / <code>：</code> / <code>=</code>).",
    "codeGuide.s2li3Html": "<strong>Exact preservation:</strong> Casing, leading zeros (e.g., <code>000001</code>), and standalone-line spaces (e.g., <code>Lucky plus</code>) are preserved verbatim.",
    "codeGuide.s3h": "Why does a code differ from the shop URL slug?",
    "codeGuide.s3pHtml": "On platforms like LDXP, the public path slug (e.g., <code>/shop/xxxx</code>) and merchant distributor code can be configured independently. PRISM prioritizes the code explicitly shown in the shop title or bio.",
    "codeGuide.s4h": "Don't have a storefront yet?",
    "codeGuide.s4pHtml": "Read our <a href=\"/guide/open-store/\">Store Onboarding & LDXP Setup Guide</a> to get started.",
    "codeGuide.footerHtml": "PRISM Parity · <a href=\"/catalog/integration-codes/\">Code Directory</a> · <a href=\"/catalog/shops/\">All Shops</a>",

    // /guide/open-store/
    "openGuide.crumb": "Onboarding & Indexing",
    "openGuide.h1": "Store Setup & Indexing Guide",
    "openGuide.leadHtml": "Planning to launch an automated digital storefront for AI subscriptions or API credits and get indexed on PRISM? Here is a comparison of supported systems, LDXP setup steps, and listing best practices.",
    "openGuide.quickTitle": "Quick Links:",
    "openGuide.btnReg": "Register on LDXP ↗",
    "openGuide.btnVisual": "3-Step Visual Guide",
    "openGuide.btnSubmit": "Submit Shop on Home",
    "openGuide.quickNote": "Note: Registration links lead to third-party storefront providers; fees and policies follow their official terms.",
    "openGuide.s1h": "Supported Storefront Systems Comparison",
    "openGuide.th1": "Platform",
    "openGuide.th2": "Typical Domain / Setup",
    "openGuide.th3": "Auto Code Detection",
    "openGuide.th4": "Indexing Method",
    "openGuide.r1c2Html": "<code>wzyp.cn</code> / <code>pay.ldxp.cn</code> hosted",
    "openGuide.r1c3": "Supported (public bio & shop name)",
    "openGuide.r1c4": "Homepage \"Submit Shop\" or browser/API sync",
    "openGuide.r2c2Html": "<code>catfk.com</code> hosted",
    "openGuide.r2c3": "Basic bio text extraction",
    "openGuide.r2c4": "Homepage \"Submit Shop\" queue",
    "openGuide.r3c2Html": "<code>www.16688.com.cn</code>",
    "openGuide.r3c3": "Displayed from public bio",
    "openGuide.r3c4": "Submit public URL for adapter indexing",
    "openGuide.r4c2": "Custom domain open-source / self-hosted",
    "openGuide.r4c3": "Via public info or structured feed",
    "openGuide.r4c4": "Submit public URL or configure JSON-LD",
    "openGuide.s2h": "3 Steps to Open & Get Indexed",
    "openGuide.step1Html": "<strong>Register your merchant account:</strong> Use the registration link above to create your shop, set your store name, public bio, and categories.",
    "openGuide.step2Head": "Standardize product titles & integration code:",
    "openGuide.step2Sub1Html": "Include clear brand and spec tags in titles (e.g., <code>ChatGPT Plus 独享成品 月卡</code>, <code>Claude Max 5x</code>, <code>Codex Quota</code>) so our classifier maps your products accurately.",
    "openGuide.step2Sub2Html": "To recruit distributors, put <code>对接码：your_code</code> on its own line in your shop bio (see <a href=\"/guide/integration-codes/\">Code Formatting Guide</a>).",
    "openGuide.step3Html": "<strong>Submit your shop URL:</strong> After publishing products, visit the <a href=\"/\">PRISM homepage</a>, click \"Submit Shop\", and enter your public storefront URL (e.g., <code>https://wzyp.cn/shop/your_id</code>).",
    "openGuide.s3h": "Indexing & Display Policy",
    "openGuide.s3p": "PRISM is a read-only search directory and takes no transaction fees. Private contact handles are automatically masked for privacy, and product listings refresh on sync cycles.",
    "openGuide.footerHtml": "PRISM Parity · <a href=\"/catalog/shops/\">Indexed Shops</a> · <a href=\"/catalog/integration-codes/\">Code Directory</a>",

    // /open-store-guide/
    "osg.brandName": "PRISM Parity",
    "osg.backHome": "Back Home ↗",
    "osg.heroTitleHtml": "Open a store, then find<br><span>suppliers that fit.</span>",
    "osg.heroDesc": "From registering your shop to copying an integration code and connecting suppliers. Follow three clear steps.",
    "osg.startBtnHtml": "Get Started <span>↓</span>",
    "osg.chip1": "01 Register",
    "osg.chip2": "02 Find Codes",
    "osg.chip3": "03 Connect",
    "osg.stepNav1Html": "<span>01</span> Register",
    "osg.stepNav2Html": "<span>02</span> Find Suppliers",
    "osg.stepNav3Html": "<span>03</span> Connect",
    "osg.s1Idx": "STEP 01 / GET STARTED",
    "osg.s1Title": "Register Your LDXP Store",
    "osg.s1Desc": "Visit the registration portal below and complete account and store setup following platform prompts.",
    "osg.s1ReadyTitle": "Ready to launch your shop?",
    "osg.s1ReadyDesc": "Registration opens in a new tab. Return here once finished.",
    "osg.s1Btn": "Go to Register ↗",
    "osg.s1Note": "Registration, fees, and merchant policies follow the third-party platform's official terms.",
    "osg.s2Idx": "STEP 02 / DISCOVER SUPPLIERS",
    "osg.s2Title": "Find Shops with Integration Codes",
    "osg.s2Desc": "Back on PRISM, switch to \"Browse Shops\", check \"Has integration code\", and click a code badge to copy it.",
    "osg.s2Grid1Html": "<span>1</span><p>Switch to <strong>Browse Shops</strong></p>",
    "osg.s2Grid2Html": "<span>2</span><p>Check <strong>Has integration code</strong></p>",
    "osg.s2Grid3Html": "<span>3</span><p>Click <strong>code badge</strong> to copy</p>",
    "osg.s2Btn": "Browse Shops with Codes ↗",
    "osg.s2Note": "Always verify supplier products, prices, and warranty terms before connecting.",
    "osg.s3Idx": "STEP 03 / LINK SUPPLIER",
    "osg.s3Title": "Enter the Code in Your Dashboard",
    "osg.s3Desc": "Open your LDXP merchant dashboard, go to \"Supply → Connect Supplier\", paste the integration code, search, and link.",
    "osg.s3Cap1": "Reference: Supply → Connect Supplier → Enter integration code",
    "osg.s3TipHtml": "<span>✦</span><p><strong>Once connected</strong><br>Browse available items under \"Connected Suppliers\" and import products to your storefront. Pricing and settlement follow platform rules.</p>",
    "osg.s3Cap2": "Demo illustration: Store names, revenue, costs, and order counts are fictional examples.",
    "osg.finTitle": "Ready to start?",
    "osg.finDesc": "Complete registration first, then return to pick your suppliers.",
    "osg.finBtn1": "Register on LDXP ↗",
    "osg.finBtn2": "Browse Shops →",
    "osg.footer": "PRISM Parity · Public directory & reference guide only. We do not participate in transactions.",
  };

  /** 记录每个 DOM 节点的原始简体中文文本或属性，确保切回中文时 100% 还原 */
  const zhSnapshot = new WeakMap();
  let currentLang = "zh";

  function normalizeLang(raw) {
    const clean = String(raw || "").trim().toLowerCase();
    if (clean === "en" || clean.startsWith("en-") || clean.startsWith("en_")) return "en";
    if (clean === "zh" || clean.startsWith("zh-") || clean.startsWith("zh_")) return "zh";
    return null;
  }

  function readCookieLang() {
    try {
      const m = /(?:^|;\s*)ldxp_lang=([^;]+)/.exec(document.cookie || "");
      return m ? normalizeLang(decodeURIComponent(m[1])) : null;
    } catch {
      return null;
    }
  }

  function readStorageLang() {
    try {
      return normalizeLang(localStorage.getItem(STORAGE_KEY));
    } catch {
      return null;
    }
  }

  function writeStorageAndCookie(lang) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore storage errors
    }
    try {
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${COOKIE_NAME}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    } catch {
      // ignore cookie errors
    }
  }

  function detectInitialLang() {
    try {
      const q = normalizeLang(new URLSearchParams(window.location.search).get("lang"));
      if (q) return q;
    } catch {
      // ignore URL parse error
    }

    const metaSource = document.querySelector('meta[name="prism-locale-source"]')?.getAttribute("content") || "";
    const metaLocale = normalizeLang(document.querySelector('meta[name="prism-locale"]')?.getAttribute("content"));
    const cookieLang = readCookieLang();
    const storageLang = readStorageLang();

    // 若 URL 参数或 Cookie 已由服务端确认，优先采用并同步到 localStorage
    if ((metaSource === "query" || metaSource === "cookie") && metaLocale) {
      return metaLocale;
    }
    if (cookieLang) return cookieLang;
    if (storageLang) {
      writeStorageAndCookie(storageLang);
      return storageLang;
    }
    if (metaLocale) return metaLocale;

    const attrLang = normalizeLang(document.documentElement.dataset.lang || document.documentElement.lang);
    if (attrLang) return attrLang;

    const nav = normalizeLang(navigator.language || "");
    return nav || "zh";
  }

  function t(key, vars) {
    let text = currentLang === "en" ? (EN[key] ?? key) : key;
    if (vars && typeof text === "string") {
      for (const [k, v] of Object.entries(vars)) {
        text = text.replaceAll(`{${k}}`, String(v));
      }
    }
    return text;
  }

  function ensureSnapshot(el) {
    if (zhSnapshot.has(el)) return zhSnapshot.get(el);
    const snap = {
      text: el.hasAttribute("data-i18n") ? el.textContent : undefined,
      html: el.hasAttribute("data-i18n-html") ? el.innerHTML : undefined,
      placeholder: el.hasAttribute("data-i18n-placeholder") ? el.getAttribute("placeholder") : undefined,
      title: el.hasAttribute("data-i18n-title") ? el.getAttribute("title") : undefined,
      aria: el.hasAttribute("data-i18n-aria") ? el.getAttribute("aria-label") : undefined,
    };
    zhSnapshot.set(el, snap);
    return snap;
  }

  function canonicalPathKey() {
    const clean = (window.location.pathname || "/").replace(/\/index\.html$/i, "/");
    if (clean === "/" || clean === "") return "/";
    return clean.endsWith("/") ? clean : `${clean}/`;
  }

  const ZH_PAGE_TITLES = {
    "/": "棱镜比价 | AI 订阅与数字商品多店比价 · 卡网店铺收录与对接码导航",
    "/about/": "关于棱镜比价：卡网比价、店铺收录、店铺对接码与联动小铺开店导航",
    "/guide/": "AI 订阅比价指南：卡网比价、店铺收录与开店参考 | 棱镜比价",
    "/guide/ai-pricing/": "ChatGPT、Codex、Claude、Gemini 卡网多店比价与规格对照指南 | 棱镜比价",
    "/guide/integration-codes/": "卡网店铺对接码（分销码）查询与标注指南 | 棱镜比价",
    "/guide/open-store/": "卡网开店与联动小铺开店入驻收录指南 | 棱镜比价",
    "/open-store-guide/": "联动小铺开店与对接货源指南 · 棱镜比价",
  };

  let initialZhPageTitle = null;

  function applyDom(root = document) {
    if (typeof document === "undefined") return;
    const pathKey = canonicalPathKey();
    if (initialZhPageTitle === null) {
      const metaLang = normalizeLang(document.querySelector('meta[name="prism-locale"]')?.getAttribute("content"));
      // 仅在页面初始处于中文时记录原中文标题；若边缘已输出英文标题则使用兜底中文标题表
      initialZhPageTitle = metaLang !== "en" ? document.title : (ZH_PAGE_TITLES[pathKey] || null);
    }

    const isEn = currentLang === "en";
    document.documentElement.lang = isEn ? "en" : "zh-CN";
    document.documentElement.dataset.lang = currentLang;

    const selectors = "[data-i18n],[data-i18n-html],[data-i18n-placeholder],[data-i18n-title],[data-i18n-aria]";
    const elements = root.querySelectorAll(selectors);
    for (const el of elements) {
      const snap = ensureSnapshot(el);

      const textKey = el.getAttribute("data-i18n");
      if (textKey) {
        if (isEn && EN[textKey] !== undefined) el.textContent = EN[textKey];
        else if (!isEn && snap.text !== undefined) el.textContent = snap.text;
      }

      const htmlKey = el.getAttribute("data-i18n-html");
      if (htmlKey) {
        if (isEn && EN[htmlKey] !== undefined) el.innerHTML = EN[htmlKey];
        else if (!isEn && snap.html !== undefined) el.innerHTML = snap.html;
      }

      const phKey = el.getAttribute("data-i18n-placeholder");
      if (phKey) {
        if (isEn && EN[phKey] !== undefined) el.setAttribute("placeholder", EN[phKey]);
        else if (!isEn && snap.placeholder !== undefined) el.setAttribute("placeholder", snap.placeholder || "");
      }

      const titleKey = el.getAttribute("data-i18n-title");
      if (titleKey) {
        if (isEn && EN[titleKey] !== undefined) el.setAttribute("title", EN[titleKey]);
        else if (!isEn && snap.title !== undefined) el.setAttribute("title", snap.title || "");
      }

      const ariaKey = el.getAttribute("data-i18n-aria");
      if (ariaKey) {
        if (isEn && EN[ariaKey] !== undefined) el.setAttribute("aria-label", EN[ariaKey]);
        else if (!isEn && snap.aria !== undefined) el.setAttribute("aria-label", snap.aria || "");
      }
    }

    for (const btn of root.querySelectorAll("[data-lang-toggle]")) {
      const snap = ensureSnapshot(btn);
      if (isEn) {
        btn.textContent = EN["nav.langBtn"];
        btn.setAttribute("aria-label", EN["nav.langAria"]);
        btn.setAttribute("title", EN["nav.langTitle"]);
      } else {
        btn.textContent = snap.text || "EN";
        btn.setAttribute("aria-label", snap.aria || "Switch to English");
        btn.setAttribute("title", snap.title || "Switch to English");
      }
    }

    const titleKey = `pageTitle.${pathKey}`;
    if (isEn && EN[titleKey]) {
      document.title = EN[titleKey];
    } else if (!isEn && (initialZhPageTitle || ZH_PAGE_TITLES[pathKey])) {
      document.title = initialZhPageTitle || ZH_PAGE_TITLES[pathKey];
    }

    document.documentElement.classList.remove("i18n-pending");
  }

  function setLang(nextLang, persist = true) {
    const normalized = normalizeLang(nextLang);
    if (!normalized) return currentLang;
    const changed = normalized !== currentLang;
    currentLang = normalized;
    if (persist) {
      writeStorageAndCookie(normalized);
    }
    if (document.readyState === "loading") {
      document.documentElement.lang = normalized === "en" ? "en" : "zh-CN";
      document.documentElement.dataset.lang = normalized;
    } else {
      applyDom(document);
    }
    if (changed) {
      window.dispatchEvent(new CustomEvent("prism:langchange", { detail: { lang: currentLang } }));
    }
    return currentLang;
  }

  function toggleLang() {
    return setLang(currentLang === "en" ? "zh" : "en", true);
  }

  currentLang = detectInitialLang();
  document.documentElement.lang = currentLang === "en" ? "en" : "zh-CN";
  document.documentElement.dataset.lang = currentLang;

  function initDomBindings() {
    applyDom(document);
    document.addEventListener("click", (event) => {
      const btn = event.target?.closest?.("[data-lang-toggle]");
      if (!btn) return;
      event.preventDefault();
      toggleLang();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDomBindings, { once: true });
  } else {
    initDomBindings();
  }

  window.PrismI18n = {
    getLang: () => currentLang,
    isEn: () => currentLang === "en",
    setLang,
    toggleLang,
    t,
    apply: applyDom,
    EN,
  };
})();
