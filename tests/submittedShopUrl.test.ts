import { describe, expect, it } from 'vitest';
import { normalizeSubmittedShopUrl } from '../src/collector/submittedShopUrl';

describe('提交的店铺网址', () => {
  it('规范化平台别名、大小写和查询参数', () => {
    expect(normalizeSubmittedShopUrl('https://pay.ldxp.cn/shop/AiMan/?ref=abc')).toBe('https://wzyp.cn/shop/AiMan');
    expect(normalizeSubmittedShopUrl('http://16688.com.cn/shop/ABC')).toBe('https://www.16688.com.cn/shop/ABC');
    expect(normalizeSubmittedShopUrl('https://www.catfk.com/shop/One')).toBe('https://catfk.com/shop/One');
  });
  it('拒绝近似域名、内网、凭据和非店铺路径', () => {
    for (const url of ['http://127.0.0.1/shop/a', 'https://u:p@wzyp.cn/shop/a', 'https://wzyp.cn/item/a', 'javascript:alert(1)']) {
      expect(normalizeSubmittedShopUrl(url)).toBeNull();
    }
  });
});

it('支持第三方公网店铺地址并去除追踪参数', () => {
  expect(normalizeSubmittedShopUrl('https://shop.example.com/store?utm=x')).toBe('https://shop.example.com/store');
});


it('近似平台域名不归一化为已知平台', () => {
  expect(normalizeSubmittedShopUrl('https://wzyp.cn.evil.test/shop/a')).toBe('https://wzyp.cn.evil.test/shop/a');
});
