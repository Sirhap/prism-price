import type { RawOfferItem, RawShopSnapshot, ShopRecord, StockStatus } from "../../types";
import {
  extractTelegramFromSources,
  fetchUpstreamResponse,
  normalizeDescription,
  type ShopAdapter,
} from "./fetcher";

/**
 * 基于 Cloudflare Workers 原生 HTMLRewriter 的流式 SSR HTML 适配器
 * 优势：底层由 Rust 流式驱动，不引入 jsdom/cheerio 等重型库，可轻松将 CPU 控制在 10ms 以内
 */
export const ssrHtmlAdapter: ShopAdapter = {
  type: "ssr_html",

  async fetchSnapshot(shop: ShopRecord, env: Env): Promise<RawShopSnapshot> {
    const { response, finalUrl } = await fetchUpstreamResponse(shop, env);

    let shopName = "";
    let noticeText = "";
    let descriptionText = "";
    let sellCount: number | null = null;
    let salesVisible = false;
    let depositVisible = false;
    let depositMoney: number | null = null;

    const rawCards: Array<{
      itemKey: string;
      stockStatus: StockStatus;
      categoryText: string;
      titleText: string;
      href: string;
      priceText: string;
      stockText: string;
    }> = [];

    let currentCard: (typeof rawCards)[number] | null = null;

    const rewriter = new HTMLRewriter()
      .on(".shop-title, h1", {
        text(chunk) {
          shopName += chunk.text;
        },
      })
      .on(".shop-notice", {
        text(chunk) {
          noticeText += chunk.text;
        },
      })
      .on(".shop-notice br", {
        element() {
          noticeText += "\n";
        },
      })
      .on(".shop-description", {
        text(chunk) {
          descriptionText += chunk.text;
        },
      })
      .on(".shop-description br", {
        element() {
          descriptionText += "\n";
        },
      })
      .on(".shop-meta", {
        element(el) {
          const rawSell = el.getAttribute("data-sell-count");
          const rawDeposit = el.getAttribute("data-deposit");
          if (rawSell !== null && rawSell !== "") {
            const parsed = Number(rawSell);
            if (Number.isFinite(parsed)) {
              salesVisible = true;
              sellCount = parsed;
            }
          }
          if (rawDeposit !== null && rawDeposit !== "") {
            const parsed = Number(rawDeposit);
            if (Number.isFinite(parsed)) {
              depositVisible = true;
              depositMoney = parsed;
            }
          }
        },
      })
      .on(".goods-card", {
        element(el) {
          const itemKey = el.getAttribute("data-item-id") || `item-${rawCards.length + 1}`;
          const rawStatus = el.getAttribute("data-stock-status") || "sufficient";
          const stockStatus: StockStatus =
            rawStatus === "low" || rawStatus === "normal" || rawStatus === "sufficient"
              ? rawStatus
              : "sufficient";

          currentCard = {
            itemKey,
            stockStatus,
            categoryText: "",
            titleText: "",
            href: "",
            priceText: "",
            stockText: "",
          };
          rawCards.push(currentCard);
        },
      })
      .on(".goods-card .goods-cat", {
        text(chunk) {
          if (currentCard) {
            currentCard.categoryText += chunk.text;
          }
        },
      })
      .on(".goods-card .goods-title", {
        element(el) {
          if (currentCard) {
            currentCard.href = el.getAttribute("href") || "";
          }
        },
        text(chunk) {
          if (currentCard) {
            currentCard.titleText += chunk.text;
          }
        },
      })
      .on(".goods-card .goods-price", {
        text(chunk) {
          if (currentCard) {
            currentCard.priceText += chunk.text;
          }
        },
      })
      .on(".goods-card .goods-stock", {
        text(chunk) {
          if (currentCard) {
            currentCard.stockText += chunk.text;
          }
        },
      });

    // 以空流消费转换后的 HTML body，不将完整 HTML 文本缓存在 JS 堆内存里
    const transformed = rewriter.transform(response);
    await transformed.body?.pipeTo(new WritableStream());

    const items: RawOfferItem[] = [];
    for (const card of rawCards) {
      const title = card.titleText.trim();
      const price = Number(card.priceText.replace(/[^\d.]/g, ""));
      if (!title || !Number.isFinite(price) || price <= 0) {
        continue;
      }

      const trimmedStock = card.stockText.trim();
      let stockCount: number | null = null;
      if (/^\d+$/.test(trimmedStock)) {
        stockCount = Number(trimmedStock);
      }


      items.push({
        itemKey: card.itemKey,
        rawName: title,
        shopCategory: card.categoryText.trim(),
        price,
        stockCount,
        stockStatus: card.stockStatus,
        itemUrl: card.href || finalUrl,
      });
    }

    return {
      shopName: shopName.trim() || shop.shop_name,
      canonicalUrl: finalUrl,
      telegram: extractTelegramFromSources(noticeText, descriptionText) || shop.telegram,
      description: normalizeDescription(descriptionText) || normalizeDescription(noticeText),
      shopSellCount: sellCount,
      salesVisible,
      depositVisible,
      depositMoney,
      items,
    };
  },
};
