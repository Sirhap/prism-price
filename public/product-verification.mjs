const challengeScript = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptLoad;
let activeChallenge;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptLoad ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const failed = () => {
      clearTimeout(timeout);
      script.remove();
      scriptLoad = undefined;
      reject(new Error("Turnstile unavailable"));
    };
    const timeout = setTimeout(failed, 8000);
    script.src = challengeScript;
    script.async = true;
    script.onerror = failed;
    script.onload = () => {
      if (!window.turnstile) return failed();
      clearTimeout(timeout);
      resolve(window.turnstile);
    };
    document.head.append(script);
  });
  return scriptLoad;
}

async function openVerification({ siteKey, action }) {
  const en = document.documentElement.lang === "en";
  const dialog = document.createElement("dialog");
  dialog.className = "submit-shop-dialog product-verification-dialog";
  const title = document.createElement("h2");
  title.id = "product-verification-title";
  title.textContent = en ? "Verify to continue" : "验证后继续查询";
  dialog.setAttribute("aria-labelledby", title.id);
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = en ? "Loading verification…" : "正在加载验证…";
  const widget = document.createElement("div");
  const close = document.createElement("button");
  close.type = "button";
  close.className = "product-verification-close";
  close.setAttribute("aria-label", en ? "Close verification" : "关闭验证");
  close.textContent = "×";
  close.onclick = () => dialog.close();
  dialog.append(close, title, status, widget);
  document.body.append(dialog);
  dialog.showModal();

  let turnstile;
  let widgetId;
  let verified = false;
  let posting = false;
  const controller = new AbortController();
  const finished = new Promise(resolve => dialog.addEventListener("close", () => resolve(verified), { once: true }));
  function showError() {
    status.textContent = en ? "Verification failed. Close and try again." : "验证失败，请关闭后重试。";
  }
  void loadTurnstile().then(api => {
    if (!dialog.open) return;
    turnstile = api;
    status.textContent = en ? "Complete the check to resume your search." : "请完成人机验证，继续当前查询。";
    widgetId = api.render(widget, {
      sitekey: siteKey, action, size: window.matchMedia("(max-width: 400px)").matches ? "compact" : "flexible",
      language: en ? "en" : "zh-cn",
      "error-callback": showError,
      "expired-callback": showError,
      callback: async token => {
        if (posting || !dialog.open) return;
        posting = true;
        try {
          status.textContent = en ? "Checking verification…" : "正在确认验证结果…";
          const response = await fetch("/api/product-verification", {
            method: "POST", body: token, credentials: "same-origin",
            headers: { "Content-Type": "text/plain" },
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
          });
          if (response.status !== 204) throw new Error("Product verification failed");
          if (dialog.open) {
            verified = true;
            dialog.close();
          }
        } catch {
          if (dialog.open) showError();
        }
      },
    });
  }).catch(showError);

  try {
    return await finished;
  } finally {
    controller.abort();
    if (widgetId !== undefined) turnstile.remove(widgetId);
    dialog.remove();
  }
}

/** A first-party challenge may retry once. Edge and origin hard limits keep their regular 429 response. */
export async function resumeProductFetch(response, retry, signal) {
  if (response.status !== 429 || response.headers.get("X-Prism-Verification") !== "required" || signal?.aborted) return response;
  const challenge = await response.clone().json().catch(() => null);
  if (challenge?.code !== "PRODUCT_VERIFICATION_REQUIRED" || !challenge.siteKey || challenge.action !== "prism_product_query") return response;
  activeChallenge ??= openVerification(challenge).finally(() => { activeChallenge = undefined; });
  const passed = await activeChallenge;
  return passed && !signal?.aborted ? retry() : response;
}
