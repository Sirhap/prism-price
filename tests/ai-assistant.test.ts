/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { classifyIntent } from "../src/ai/intent";
import { matchKnowledge, QUICK_QUESTIONS } from "../src/ai/knowledge";

beforeAll(async () => {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS ai_cache (
      cache_key TEXT PRIMARY KEY,
      intent TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )`,
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS ai_rate_limit (
      bucket TEXT PRIMARY KEY,
      hits INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL
    )`,
  ).run();
});

describe("意图规则分类", () => {
  it("识别品牌、时长与低价排序", () => {
    const result = classifyIntent("便宜的 Claude 月付");
    expect(result.intent).toBe("compare");
    expect(result.filters.group).toBe("Claude");
    expect(result.filters.duration).toBe("month");
    expect(result.filters.sort).toBe("price-asc");
  });

  it("识别品牌与最便宜诉求", () => {
    const result = classifyIntent("ChatGPT 哪家最便宜");
    expect(result.intent).toBe("compare");
    expect(result.filters.group).toBe("ChatGPT");
    expect(result.filters.sort).toBe("price-asc");
  });

  it("识别价格区间", () => {
    const result = classifyIntent("10元以内的 Claude");
    expect(result.intent).toBe("compare");
    expect(result.filters.price).toBe("under-10");
  });

  it("识别指南类问题", () => {
    expect(classifyIntent("对接码怎么用").intent).toBe("guide");
    expect(classifyIntent("怎么开店").intent).toBe("guide");
    expect(classifyIntent("开店要多少钱").intent).toBe("guide");
  });

  it("无明确意图时归为 chat", () => {
    expect(classifyIntent("你好").intent).toBe("chat");
  });
});

describe("知识库召回", () => {
  it("按关键词召回对接码说明", () => {
    const snippets = matchKnowledge("对接码怎么用");
    expect(snippets.length).toBeGreaterThan(0);
    expect(snippets[0].id).toBe("integration-code");
  });

  it("无命中时返回空数组", () => {
    expect(matchKnowledge("完全无关的问题")).toHaveLength(0);
  });

  it("快捷问题非空", () => {
    expect(QUICK_QUESTIONS.length).toBeGreaterThan(0);
  });
});

function ask(question: string, init: RequestInit = {}) {
  return SELF.fetch("http://localhost/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
    body: JSON.stringify({ question }),
    ...init,
  });
}

describe("POST /api/ai", () => {
  it("比价意图返回筛选参数与实时 API 地址", async () => {
    const response = await ask("便宜的 Claude 月付");
    expect(response.status).toBe(200);
    const payload = await response.json() as {
      type: string;
      apiUrl: string;
      filters: { group: string; duration: string; sort: string };
    };
    expect(payload.type).toBe("compare");
    expect(payload.filters.group).toBe("Claude");
    expect(payload.filters.duration).toBe("month");
    expect(payload.apiUrl).toContain("group=Claude");
    expect(payload.apiUrl).toContain("duration=month");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("指南意图返回带来源的回答", async () => {
    const response = await ask("对接码怎么用");
    expect(response.status).toBe(200);
    const payload = await response.json() as { type: string; message: string; sources: Array<{ url: string }> };
    expect(payload.type).toBe("answer");
    expect(payload.message.length).toBeGreaterThan(10);
    expect(payload.sources.length).toBeGreaterThan(0);
    expect(payload.sources[0].url).toContain("/guide/");
  });

  it("未知问题返回快捷问题引导", async () => {
    const response = await ask("今天天气怎么样");
    expect(response.status).toBe(200);
    const payload = await response.json() as { type: string; suggestions: string[] };
    expect(payload.type).toBe("hint");
    expect(payload.suggestions.length).toBeGreaterThan(0);
  });

  it("相同问题命中缓存", async () => {
    const question = `缓存测试-${Date.now()}`;
    const first = await ask(question);
    const firstPayload = await first.json() as { meta: { cached: boolean } };
    expect(firstPayload.meta.cached).toBe(false);
    const second = await ask(question);
    const secondPayload = await second.json() as { meta: { cached: boolean } };
    expect(secondPayload.meta.cached).toBe(true);
  });

  it("拒绝空问题与超长问题", async () => {
    expect((await ask("")).status).toBe(400);
    expect((await ask("a".repeat(201))).status).toBe(400);
  });

  it("拒绝非 POST 请求", async () => {
    const response = await SELF.fetch("http://localhost/api/ai", {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    expect(response.status).toBe(405);
  });
});
