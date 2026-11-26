/**
 * 悬浮 AI 检索助手：面板交互、请求 /api/ai、渲染报价卡片与指南回答。
 * 对话仅保留在当前面板会话中，关闭面板或刷新页面后清空。
 */
(() => {
  const toggle = document.getElementById("aiAssistantToggle");
  const panel = document.getElementById("aiAssistantPanel");
  const closeBtn = document.getElementById("aiAssistantClose");
  const form = document.getElementById("aiForm");
  const input = document.getElementById("aiInput");
  const messages = document.getElementById("aiMessages");
  const suggestions = document.getElementById("aiSuggestions");
  if (!toggle || !panel || !form || !input || !messages || !suggestions) return;

  const t = (zh, en) => {
    try {
      return window.PrismI18n?.isEn?.() ? en : zh;
    } catch {
      return zh;
    }
  };

  const INITIAL_SUGGESTIONS = [
    { zh: "便宜的 Claude 月付", en: "Cheap Claude monthly" },
    { zh: "ChatGPT 哪家最便宜", en: "Cheapest ChatGPT shop" },
    { zh: "对接码怎么用", en: "How to use integration codes" },
    { zh: "怎么开店", en: "How to open a store" },
    { zh: "价格是实时的吗", en: "Is pricing real-time?" },
  ];

  let lastQuestion = "";
  let busy = false;

  // 清理早期版本可能写入的持久化记录，本版本只保留当前页面内的记录
  try {
    localStorage.removeItem("prism_ai_history_v1");
  } catch {
    // ignore
  }

  function openPanel() {
    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    toggle.classList.add("is-open");
    input.focus();
    scrollToBottom();
  }

  function closePanel() {
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.classList.remove("is-open");
  }

  function scrollToBottom() {
    messages.scrollTop = messages.scrollHeight;
  }

  function addBubble(role, text) {
    const bubble = document.createElement("div");
    bubble.className = `ai-bubble ai-bubble-${role}`;
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    bubble.appendChild(paragraph);
    messages.appendChild(bubble);
    scrollToBottom();
    return bubble;
  }

  function safeInternalUrl(raw) {
    return typeof raw === "string" && raw.startsWith("/") ? raw : null;
  }

  function safeExternalUrl(raw) {
    if (typeof raw !== "string" || !raw) return null;
    try {
      const url = new URL(raw, location.origin);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  }

  function formatPrice(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    return `¥${Number.isInteger(number) ? number : number.toFixed(2)}`;
  }

  function makeBadge(text, brand) {
    const badge = document.createElement("span");
    badge.className = brand ? "ai-badge ai-badge-brand" : "ai-badge";
    badge.textContent = text;
    return badge;
  }

  function buildProductCard(item) {
    const card = document.createElement("a");
    card.className = "ai-product-card";
    const href = safeExternalUrl(item.itemUrl) || safeExternalUrl(item.shopUrl);
    if (href) {
      card.href = href;
      card.target = "_blank";
      card.rel = "noopener noreferrer";
    }
    const head = document.createElement("div");
    head.className = "ai-product-head";
    const name = document.createElement("span");
    name.className = "ai-product-name";
    name.textContent = String(item.name || "");
    const price = document.createElement("strong");
    price.className = "ai-product-price";
    price.textContent = formatPrice(item.minPrice);
    head.append(name, price);

    const meta = document.createElement("div");
    meta.className = "ai-product-meta";
    if (item.group) meta.appendChild(makeBadge(String(item.group), true));
    const shopCount = Number(item.shopCount || 0);
    if (shopCount > 1) meta.appendChild(makeBadge(t(`${shopCount} 家同款`, `${shopCount} stores`), false));
    if (item.shopName) {
      const lead = document.createElement("span");
      lead.className = "ai-product-lead";
      lead.textContent = `${t("最低", "Best")}：${item.shopName}`;
      meta.appendChild(lead);
    }
    card.append(head, meta);
    return card;
  }

  function toPageUrl(apiUrl) {
    try {
      const url = new URL(apiUrl, location.origin);
      url.pathname = "/";
      url.searchParams.delete("page");
      url.searchParams.delete("pageSize");
      return `${url.pathname}?${url.searchParams.toString()}`;
    } catch {
      return "/";
    }
  }

  function addActionLink(bubble, apiUrl, total) {
    const url = safeInternalUrl(apiUrl);
    if (!url) return;
    const link = document.createElement("a");
    link.className = "ai-action";
    link.href = toPageUrl(url);
    link.textContent = total
      ? t(`查看全部 ${total} 个结果 →`, `View all ${total} results →`)
      : t("查看全部结果 →", "View all results →");
    bubble.appendChild(link);
  }

  /** 在气泡内直接渲染真实报价卡片，数据来自现有 /api/products。 */
  async function renderProducts(bubble, apiUrl) {
    const wrap = document.createElement("div");
    wrap.className = "ai-products";
    const loading = document.createElement("span");
    loading.className = "ai-products-loading";
    loading.textContent = t("正在加载报价…", "Loading prices…");
    wrap.appendChild(loading);
    bubble.appendChild(wrap);
    scrollToBottom();
    try {
      const response = await fetch(apiUrl, { headers: { Accept: "application/json" } });
      const data = await response.json();
      const items = Array.isArray(data?.items) ? data.items.slice(0, 4) : [];
      wrap.replaceChildren();
      if (items.length === 0) {
        const empty = document.createElement("span");
        empty.className = "ai-products-empty";
        empty.textContent = t("暂时没有匹配的报价，可以换个说法试试。", "No matching prices. Try another phrasing.");
        wrap.appendChild(empty);
        return;
      }
      items.forEach((item) => wrap.appendChild(buildProductCard(item)));
      const total = Number(data.total || 0);
      if (total > items.length) addActionLink(bubble, apiUrl, total);
      scrollToBottom();
    } catch {
      wrap.replaceChildren();
      const failed = document.createElement("span");
      failed.className = "ai-products-empty";
      failed.textContent = t("报价加载失败，请稍后再试。", "Failed to load prices.");
      wrap.appendChild(failed);
    }
  }

  function addSources(bubble, sources) {
    if (!Array.isArray(sources) || sources.length === 0) return;
    const wrap = document.createElement("div");
    wrap.className = "ai-sources";
    const label = document.createElement("span");
    label.textContent = t("参考：", "Sources: ");
    wrap.appendChild(label);
    sources.forEach((source, index) => {
      const url = safeInternalUrl(source?.url);
      if (!url) return;
      const link = document.createElement("a");
      link.href = url;
      link.textContent = String(source.title || url);
      wrap.appendChild(link);
      if (index < sources.length - 1) wrap.appendChild(document.createTextNode(" · "));
    });
    if (wrap.childElementCount > 0) bubble.appendChild(wrap);
  }

  function addRetry(bubble) {
    if (!lastQuestion) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ai-action ai-retry";
    button.textContent = t("重试", "Retry");
    button.addEventListener("click", () => {
      bubble.remove();
      sendQuestion(lastQuestion);
    });
    bubble.appendChild(button);
  }

  function renderSuggestions(items) {
    suggestions.replaceChildren();
    items.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ai-chip";
      button.textContent = t(item.zh, item.en);
      button.addEventListener("click", () => sendQuestion(item.zh));
      suggestions.appendChild(button);
    });
  }

  function renderItemCards(bubble, items, apiUrl) {
    const wrap = document.createElement("div");
    wrap.className = "ai-products";
    items.slice(0, 4).forEach((item) => wrap.appendChild(buildProductCard(item)));
    bubble.appendChild(wrap);
    if (apiUrl) addActionLink(bubble, apiUrl);
    scrollToBottom();
  }

  function renderPayload(payload) {
    const bubble = addBubble("bot", String(payload.message || ""));
    if (Array.isArray(payload.items) && payload.items.length > 0) {
      renderItemCards(bubble, payload.items, payload.apiUrl);
    } else if ((payload.type === "compare" || payload.type === "mixed") && safeInternalUrl(payload.apiUrl)) {
      void renderProducts(bubble, payload.apiUrl);
    } else if (payload.apiUrl) {
      addActionLink(bubble, payload.apiUrl);
    }
    addSources(bubble, payload.sources);
    if (Array.isArray(payload.suggestions) && payload.suggestions.length > 0) {
      renderSuggestions(payload.suggestions.map((question) => ({ zh: question, en: question })));
    }
  }

  async function sendQuestion(raw) {
    const question = String(raw || "").trim();
    if (!question || busy) return;
    lastQuestion = question;
    busy = true;
    renderSuggestions([]);
    addBubble("user", question);
    const loading = addBubble("bot", t("正在查询，可能需要十几秒…", "Searching, this may take a few seconds…"));
    loading.classList.add("ai-loading");
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const payload = await response.json().catch(() => null);
      loading.remove();
      if (!response.ok || !payload) {
        addRetry(addBubble("bot", payload?.error || t("请求失败，请稍后再试。", "Request failed. Please try again.")));
        return;
      }
      renderPayload(payload);
    } catch {
      loading.remove();
      addRetry(addBubble("bot", t("网络异常，请稍后再试。", "Network error. Please try again.")));
    } finally {
      busy = false;
    }
  }

  toggle.addEventListener("click", () => {
    if (panel.hidden) openPanel();
    else closePanel();
  });
  closeBtn?.addEventListener("click", closePanel);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const question = input.value;
    input.value = "";
    sendQuestion(question);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) {
      closePanel();
      toggle.focus();
    }
  });
  document.addEventListener("click", (event) => {
    if (panel.hidden) return;
    // composedPath 保留事件派发时的祖先链；快捷按钮被移除后仍能判定为面板内部点击。
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    if (path.includes(panel) || path.includes(toggle)) return;
    closePanel();
  });

  renderSuggestions(INITIAL_SUGGESTIONS);
})();
