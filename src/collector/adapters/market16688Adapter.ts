import type { RawOfferItem, RawShopSnapshot, ShopRecord } from '../../types';
import type { ShopAdapter } from './fetcher';

/** 16688 的列表接口未返回总数，只允许以部分结果更新，不能据此删除旧商品。 */
export const market16688Adapter: ShopAdapter = {
  type: 'shop_api',
  async fetchSnapshot(shop: ShopRecord): Promise<RawShopSnapshot> {
    const source = new URL(shop.shop_url);
    if (!['16688.com.cn', 'www.16688.com.cn'].includes(source.hostname.toLowerCase())) throw new Error('不支持的 16688 域名');
    const token = source.pathname.match(/^\/shop\/([a-zA-Z0-9_-]+)\/?$/)?.[1];
    if (!token) throw new Error('16688 店铺地址无效');
    async function post(path: string, data: unknown): Promise<Record<string, unknown>> {
      const response = await fetch(`https://www.16688.com.cn/shopApi/${path}`, { method:'POST', headers:{'Content-Type':'application/json',Accept:'application/json'}, body:JSON.stringify(data), signal:AbortSignal.timeout(12000), redirect:'manual' });
      if (!response.ok || !(response.headers.get('content-type') || '').toLowerCase().includes('json')) throw new Error(`16688 源站异常 HTTP ${response.status}`);
      const json = await response.json() as {code?:number;msg?:string;data?:unknown};
      if (json.code !== 1 || !json.data || typeof json.data !== 'object' || Array.isArray(json.data)) throw new Error(String(json.msg || '16688 数据无效'));
      return json.data as Record<string, unknown>;
    }
    const detail = await post('shop/detail', {shop_no:token});
    const shopNo = typeof detail.shop_no === 'string' ? detail.shop_no.trim() : '';
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(shopNo)) throw new Error('16688 店铺编号无效');
    const categoriesResponse = await fetch('https://www.16688.com.cn/shopApi/goodsCategory/list', {method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({shop_no:shopNo}),signal:AbortSignal.timeout(30000),redirect:'manual'});
    if (!categoriesResponse.ok || !(categoriesResponse.headers.get('content-type') || '').toLowerCase().includes('json')) throw new Error('16688 商品分类请求失败');
    const categories = await categoriesResponse.json() as {code?:number;data?:Array<{goods_category_no?:string;name?:string}>};
    if (categories.code !== 1 || !Array.isArray(categories.data)) throw new Error('16688 商品分类无效');
    const categoryNames = new Map(categories.data.filter(c => typeof c.goods_category_no === 'string' && typeof c.name === 'string').map(c => [c.goods_category_no, c.name!.trim()]));
    const data = await post('goods/list', {shop_no:shopNo, goods_category_no:'', keywords:'', sort:'default'});
    if (!Array.isArray(data.list) || data.list.length === 0) throw new Error('16688 商品列表为空或无效，未覆盖已有商品');
    const items: RawOfferItem[] = []; const seen = new Set<string>();
    for (const raw of data.list.slice(0, 2000)) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('16688 商品数据无效');
      const item = raw as Record<string, unknown>;
      const key = typeof item.goods_no === 'string' ? item.goods_no.trim() : '';
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      const price = Number(item.price);
      if (!/^[a-zA-Z0-9_-]{1,180}$/.test(key) || !name || !Number.isFinite(price) || price <= 0 || seen.has(key)) throw new Error('16688 商品字段不完整或重复');
      seen.add(key);
      const rawStock = item.stock_available_quantity;
      const stock = item.stock_available_status === 'out' ? 0 : typeof rawStock === 'number' && Number.isFinite(rawStock) && rawStock >= 0 ? rawStock : null;
      items.push({itemKey:key,rawName:name,shopCategory:categoryNames.get(String(item.goods_category_no || '')) || '',price,stockCount:stock,stockStatus:stock !== null && stock <= 5 ? 'low' : stock !== null && stock <= 20 ? 'normal' : 'sufficient',itemUrl:`https://www.16688.com.cn/goods/${encodeURIComponent(key)}`});
    }
    return { shopName:typeof detail.name === 'string' && detail.name.trim() ? detail.name.trim() : shop.shop_name, canonicalUrl:shop.canonical_url, telegram:shop.telegram || '', shopSellCount:shop.shop_sell_count, salesVisible:!!shop.sales_visible, depositVisible:!!shop.deposit_visible, depositMoney:shop.deposit_money, items };
  },
};
