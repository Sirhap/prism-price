/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { resolveRequestLocale } from "../src/i18n/locale";

describe("国际化语言检测与响应改写", () => {
  it("优先级顺序符合 ?lang= > Cookie ldxp_lang > IP > Accept-Language > 默认 zh", async () => {
    // 1. ?lang= 覆盖最高
    const byQuery = await resolveRequestLocale(
      new Request("https://example.com/?lang=zh", {
        headers: {
          Cookie: "ldxp_lang=en",
          "CF-IPCountry": "US",
          "Accept-Language": "en-US,en;q=0.9",
        },
      }),
      { lookupPublicIp: false },
    );
    expect(byQuery).toMatchObject({ locale: "zh", source: "query" });

    // 2. Cookie 覆盖 IP 与 Accept-Language
    const byCookie = await resolveRequestLocale(
      new Request("https://example.com/", {
        headers: {
          Cookie: "foo=1; ldxp_lang=en",
          "CF-IPCountry": "CN",
          "Accept-Language": "zh-CN,zh;q=0.9",
        },
      }),
      { lookupPublicIp: false },
    );
    expect(byCookie).toMatchObject({ locale: "en", source: "cookie" });

    // 3. CN / HK / MO / TW 默认中文，其余海外国家默认英文
    for (const code of ["CN", "HK", "MO", "TW"]) {
      const res = await resolveRequestLocale(
        new Request("https://example.com/", { headers: { "CF-IPCountry": code } }),
        { lookupPublicIp: false },
      );
      expect(res).toMatchObject({ locale: "zh", source: "ip", country: code });
    }
    for (const code of ["US", "JP", "SG", "GB"]) {
      const res = await resolveRequestLocale(
        new Request("https://example.com/", { headers: { "CF-IPCountry": code } }),
        { lookupPublicIp: false },
      );
      expect(res).toMatchObject({ locale: "en", source: "ip", country: code });
    }

    // 4. 本地或无代理头时使用 Accept-Language 兜底
    const byAccept = await resolveRequestLocale(
      new Request("https://example.com/", {
        headers: {
          "X-Forwarded-For": "127.0.0.1",
          "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.5",
        },
      }),
      { lookupPublicIp: false },
    );
    expect(byAccept).toMatchObject({ locale: "en", source: "accept-language" });

    // 5. 无任何线索时默认简体中文
    const byDefault = await resolveRequestLocale(new Request("https://example.com/"), {
      lookupPublicIp: false,
    });
    expect(byDefault).toMatchObject({ locale: "zh", source: "default" });
  });

  it("无代理国家头时对公网 IP 进行归属地解析并按国内外分流", async () => {
    const usMockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          status: "success",
          country: "United States",
          countryCode: "US",
          regionName: "California",
          city: "Mountain View",
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    const usRes = await resolveRequestLocale(
      new Request("https://example.com/", { headers: { "CF-Connecting-IP": "8.8.8.8" } }),
      { lookupPublicIp: true, fetchImpl: usMockFetch },
    );
    expect(usRes).toMatchObject({ locale: "en", source: "ip", country: "US" });

    const cnMockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          status: "success",
          country: "China",
          countryCode: "CN",
          regionName: "Beijing",
          city: "Beijing",
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    const cnRes = await resolveRequestLocale(
      new Request("https://example.com/", { headers: { "X-Forwarded-For": "114.114.114.114" } }),
      { lookupPublicIp: true, fetchImpl: cnMockFetch },
    );
    expect(cnRes).toMatchObject({ locale: "zh", source: "ip", country: "CN" });
  });

  it("首页与静态指南页在海外 IP 下自动改写 HTML 语言属性与元信息", async () => {
    const cases: Array<[string, string]> = [
      ["/", "PRISM Parity | AI Subscriptions & Digital Store Price Comparison"],
      ["/about/", "About PRISM Parity | Store Index, Integration Codes & Setup Guide"],
      ["/guide/", "AI Subscription Price Comparison Guide | PRISM Parity"],
      ["/guide/ai-pricing/", "ChatGPT, Codex, Claude & Gemini Pricing Comparison Guide | PRISM Parity"],
      ["/guide/integration-codes/", "Store Integration Code Directory & Formatting Guide | PRISM Parity"],
      ["/guide/open-store/", "Store Onboarding & Indexing Guide | PRISM Parity"],
      ["/open-store-guide/", "3-Step Store Setup & Supplier Connection Guide | PRISM Parity"],
    ];

    for (const [path, expectedTitle] of cases) {
      const res = await SELF.fetch(`http://localhost${path}`, {
        headers: { "CF-IPCountry": "US" },
      });
      expect(res.status, `${path} should return 200`).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
      const vary = (res.headers.get("Vary") || "").toLowerCase();
      expect(vary).toContain("cookie");
      expect(vary).toContain("cf-ipcountry");
      expect(vary).toContain("accept-language");

      const html = await res.text();
      expect(html).toContain('<html lang="en"');
      expect(html).toContain('data-lang="en"');
      expect(html).toContain(`<title>${expectedTitle.replaceAll("&", "&amp;")}</title>`);
      expect(html).toContain('<meta name="prism-locale" content="en"');
      expect(html).toContain('property="og:locale" content="en_US"');
      expect(html).toContain('id="prism-i18n-guard"');
    }
  });

  it("国内 IP / Cookie / 查询参数可按预期覆盖默认语言并隔离未翻译 SSR 目录页", async () => {
    // 默认无头首页保留中文与 prism-locale=zh
    const defaultHome = await (await SELF.fetch("http://localhost/")).text();
    expect(defaultHome).toContain('<html lang="zh-CN"');
    expect(defaultHome).toContain('<meta name="prism-locale" content="zh"');
    expect(defaultHome).not.toContain('id="prism-i18n-guard"');

    // 海外 IP + Cookie ldxp_lang=zh 切换回中文
    const cookieZh = await (
      await SELF.fetch("http://localhost/", {
        headers: { "CF-IPCountry": "US", Cookie: "ldxp_lang=zh" },
      })
    ).text();
    expect(cookieZh).toContain('<html lang="zh-CN"');
    expect(cookieZh).toContain('<meta name="prism-locale" content="zh"');
    expect(cookieZh).not.toContain('id="prism-i18n-guard"');

    // 国内 IP + ?lang=en 切换为英文
    const queryEn = await (
      await SELF.fetch("http://localhost/?lang=en", {
        headers: { "CF-IPCountry": "CN" },
      })
    ).text();
    expect(queryEn).toContain('<html lang="en"');
    expect(queryEn).toContain('<meta name="prism-locale" content="en"');

    // /catalog/brands/ 不在本期国际化改写范围内，不应被注入 prism-locale
    const catalogRes = await SELF.fetch("http://localhost/catalog/brands/", {
      headers: { "CF-IPCountry": "US" },
    });
    expect(catalogRes.status).toBe(200);
    const catalogHtml = await catalogRes.text();
    expect(catalogHtml).not.toContain('name="prism-locale"');
  });

  it("GET / POST /api/locale 正确读取语言、设置持久化 Cookie 并校验非法请求", async () => {
    const getUs = await SELF.fetch("http://localhost/api/locale", {
      headers: { "CF-IPCountry": "SG" },
    });
    expect(getUs.status).toBe(200);
    expect(await getUs.json()).toMatchObject({ locale: "en", source: "ip", country: "SG" });

    const postEn = await SELF.fetch("https://example.com/api/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: "en" }),
    });
    expect(postEn.status).toBe(200);
    expect(await postEn.json()).toEqual({ locale: "en", source: "cookie" });
    const setCookieEn = postEn.headers.get("Set-Cookie") || "";
    expect(setCookieEn).toContain("ldxp_lang=en");
    expect(setCookieEn).toContain("Max-Age=31536000");
    expect(setCookieEn).toContain("Secure");

    const postZh = await SELF.fetch("http://localhost/api/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: "zh" }),
    });
    expect(postZh.status).toBe(200);
    expect(postZh.headers.get("Set-Cookie") || "").toContain("ldxp_lang=zh");

    const invalidLocale = await SELF.fetch("http://localhost/api/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: "fr" }),
    });
    expect(invalidLocale.status).toBe(400);

    const invalidJson = await SELF.fetch("http://localhost/api/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad",
    });
    expect(invalidJson.status).toBe(400);
  });
});
