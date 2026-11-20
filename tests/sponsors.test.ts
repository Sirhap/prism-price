/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { sponsorExpiry } from '../src/routes/sponsors';

const origin = 'http://localhost';
const admin = '/api/control/sponsors';
const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHkcAAAAASUVORK5CYII=';
let cookie: string;

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  const token = 's'.repeat(43);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  await env.DB.prepare('INSERT INTO admin_sessions(token_hash,expires_at) VALUES (?,?)')
    .bind(btoa(String.fromCharCode(...new Uint8Array(hash))), Date.now() + 60_000).run();
  cookie = 'admin_session=' + token;
});

function post(path: string, data: unknown, session = '', source = origin) {
  const upload = data instanceof FormData;
  return SELF.fetch(origin + path, {
    method: 'POST', headers: { ...(!upload && { 'Content-Type': 'application/json' }), origin: source, cookie: session },
    body: upload ? data : JSON.stringify(data),
  });
}

const pngBytes = () => Uint8Array.from(atob(image), char => char.charCodeAt(0));
function publish(code: string, title: string, bytes = pngBytes(), placementType?: string, linkUrl?: string) {
  const form = new FormData();
  form.set('code', code);
  form.set('title', title);
  form.set('image', new File([bytes], 'banner.png', { type: 'image/png' }));
  if (placementType) form.set('placementType', placementType);
  if (linkUrl !== undefined) form.set('linkUrl', linkUrl);
  return post('/api/sponsors/redeem', form);
}

async function list(status = 'all') {
  const response = await SELF.fetch(origin + admin + '?status=' + status, { headers: { cookie } });
  expect(response.status).toBe(200);
  return (await response.json<{ codes: Array<{ id: string; codeHint: string; status: string; expiresAt: number | null;
    reviewedAt: number | null; placement: string; linkUrl: string | null }> }>()).codes;
}

async function approveCode(code: string) {
  const record = (await list('pending')).find(item => item.codeHint === code.slice(-8));
  expect(record).toBeDefined();
  const response = await post(admin, { action: 'approve', id: record!.id }, cookie);
  expect(response.status).toBe(200);
  return record!;
}

it('生成与管理仅限已登录管理员，拒绝越界数量及跨站提交', async () => {
  const batch = { action: 'create', quantity: 2, duration: 1, unit: 'months' };
  expect((await post(admin, batch)).status).toBe(401);
  expect((await post(admin, batch, cookie, 'https://elsewhere.test')).status).toBe(403);
  expect((await post(admin, { ...batch, quantity: 51 }, cookie)).status).toBe(400);
  expect((await post(admin, { ...batch, duration: 13 }, cookie)).status).toBe(400);
  expect((await post('/api/sponsors/check', {}, '', 'https://elsewhere.test')).status).toBe(403);
});

it('授权码仅可投稿一次，审批前不公开，审批通过后才开始有效期', async () => {
  const generated = await post(admin, { action: 'create', quantity: 4, duration: 2, unit: 'days' }, cookie);
  expect(generated.status).toBe(201);
  const { codes } = await generated.json<{ codes: string[] }>();
  expect(new Set(codes).size).toBe(4);
  expect(codes.every(code => /^PRISM-[0-9A-F]{32}$/.test(code))).toBe(true);
  expect(await list('unused')).toHaveLength(4);
  expect(JSON.stringify(await list())).not.toContain(codes[0]);

  const check = async (code: string) => (await post('/api/sponsors/check', { code })).json();
  expect(await check(codes[0])).toMatchObject({ status: 'unused', expiresAt: null, duration: 2 });
  expect((await publish(codes[0], 'Bad', Uint8Array.from(new TextEncoder().encode('<svg>invalid raster image</svg>')))).status).toBe(400);
  for (const invalid of ['javascript:alert(1)', 'data:text/html,bad', '//example.test', 'https://[', 'https://user:pass@example.test',
    'https://example.test/' + 'a'.repeat(2048)]) {
    expect((await publish(codes[0], '链接无效', pngBytes(), undefined, invalid)).status).toBe(400);
  }
  expect(await check(codes[0])).toMatchObject({ status: 'unused' });

  const title = '赞助样例';
  const linkUrl = 'https://example.test/promo?source=prism&campaign=featured#details';
  const attempts = await Promise.all([codes[0].toLowerCase(), codes[0]]
    .map(code => publish(code, title, pngBytes(), undefined, ' ' + linkUrl + ' ')));
  expect(attempts.map(response => response.status).sort()).toEqual([201, 409]);
  expect(await attempts.find(response => response.status === 201)!.json()).toMatchObject({ status: 'pending', expiresAt: null });
  expect(await check(codes[0])).toMatchObject({ status: 'pending', expiresAt: null });
  const publicList = async () => {
    const response = await SELF.fetch(origin + '/api/sponsors');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    return response.json<{ ads: Array<{ id: string; title: string; linkUrl: string | null }> }>();
  };
  expect(await publicList()).toEqual({ enabled: true, ads: [] });
  const [first] = await list('pending');
  expect(first).toMatchObject({ linkUrl, reviewedAt: null, expiresAt: null });
  const getImage = (id: string) => SELF.fetch(origin + '/api/sponsors/image/' + id);
  expect((await getImage(first.id)).status).toBe(404);
  expect((await SELF.fetch(origin + '/api/sponsors/image/' + first.id, { method: 'HEAD' })).status).toBe(404);
  const preview = origin + admin + '/image/' + first.id;
  expect((await SELF.fetch(preview)).status).toBe(401);
  const previewResponse = await SELF.fetch(preview, { headers: { cookie } });
  expect(previewResponse.headers.get('Content-Type')).toBe('image/png');
  expect(new Uint8Array(await previewResponse.arrayBuffer())).toEqual(pngBytes());
  const approve = { action: 'approve', id: first.id };
  expect((await post(admin, approve)).status).toBe(401);
  expect((await post(admin, approve, cookie, 'https://elsewhere.test')).status).toBe(403);
  await env.DB.prepare('UPDATE sponsor_ads SET redeemed_at = ? WHERE id = ?').bind(Date.now() - 86400_000, first.id).run();
  const decisions = await Promise.all([post(admin, approve, cookie), post(admin, approve, cookie)]);
  expect(decisions.map(response => response.status).sort()).toEqual([200, 409]);
  const [{ expiresAt, reviewedAt }] = await list('active');
  expect(reviewedAt).not.toBeNull();
  expect(expiresAt).toBe(reviewedAt! + 2 * 86_400_000);
  expect(await check(codes[0])).toMatchObject({ status: 'active', expiresAt });
  expect(await publicList()).toEqual({ enabled: true, ads: [{ id: first.id, title, expiresAt, placement: 'carousel', linkUrl }] });
  const publicImage = await getImage(first.id);
  expect(publicImage.headers.get('Content-Type')).toBe('image/png');
  expect(new Uint8Array(await publicImage.arrayBuffer())).toEqual(Uint8Array.from(atob(image), char => char.charCodeAt(0)));
  await env.DB.prepare('UPDATE sponsor_ads SET expires_at = ? WHERE id = ?').bind(Date.now() - 1, first.id).run();
  expect(await check(codes[0])).toMatchObject({ status: 'expired' });
  expect((await getImage(first.id)).status).toBe(404);
  expect(await list('expired')).toHaveLength(1);

  expect((await publish(codes[1], title)).status).toBe(201);
  const second = await approveCode(codes[1]);
  expect((await publicList()).ads).toMatchObject([{ id: second.id, linkUrl: null }]);
  expect((await post(admin, { action: 'revoke', id: second.id }, cookie)).status).toBe(200);
  expect((await getImage(second.id)).status).toBe(404);
  expect(await check(codes[1])).toMatchObject({ status: 'revoked' });
  expect((await publish(codes[2], title)).status).toBe(201);
  const third = await approveCode(codes[2]);
  expect((await post(admin, { action: 'delete', id: third.id }, cookie)).status).toBe(200);
  expect((await post('/api/sponsors/check', { code: codes[2] })).status).toBe(404);
  expect((await getImage(third.id)).status).toBe(404);
  expect((await publish(codes[3], title)).status).toBe(201);
  const [rejected] = await list('pending');
  expect(await (await post(admin, { action: 'reject', id: rejected.id }, cookie)).json()).toEqual({ status: 'rejected', expiresAt: null });
  expect(await check(codes[3])).toMatchObject({ status: 'rejected', expiresAt: null });
  expect((await publish(codes[3], title)).status).toBe(409);
  expect((await post(admin, { action: 'approve', id: rejected.id }, cookie)).status).toBe(409);
  expect((await getImage(rejected.id)).status).toBe(404);
  expect(await publicList()).toEqual({ enabled: true, ads: [] });
});

it('自然月按北京时间月末截断，天数按完整 24 小时计', () => {
  const start = Date.parse('2027-01-31T01:25:00+08:00');
  expect(sponsorExpiry(start, 1, 'months')).toBe(Date.parse('2027-02-28T01:25:00+08:00'));
  expect(sponsorExpiry(start, 2, 'days')).toBe(Date.parse('2027-02-02T01:25:00+08:00'));
});

it('轮播满位时可投稿，审批最多通过四张，固定位可同时接受多条投放', async () => {
  async function generate(placement: string, quantity: number) {
    const response = await post(admin, { action: 'create', placement, quantity, duration: 1, unit: 'days' }, cookie);
    expect(response.status).toBe(201);
    return (await response.json<{ codes: string[] }>()).codes;
  }
  const slides = await generate('carousel', 5);
  for (const code of slides.slice(0, 3)) {
    expect((await publish(code, '轮播推广')).status).toBe(201);
    await approveCode(code);
  }
  const finalists = await Promise.all(slides.slice(3).map(code => publish(code, '轮播推广')));
  expect(finalists.map(response => response.status)).toEqual([201, 201]);
  const pending = await list('pending');
  const decisions = await Promise.all(pending.map(item => post(admin, { action: 'approve', id: item.id }, cookie)));
  expect(decisions.map(response => response.status).sort()).toEqual([200, 409]);
  const [blocked] = await list('pending');
  expect(blocked).toMatchObject({ status: 'pending', expiresAt: null, placement: 'carousel' });
  const redeem = async (code: string) => {
    expect((await publish(code, '位置验证')).status).toBe(201);
    await approveCode(code);
  };
  const [first, extra] = await generate('fixed-1', 2);
  await Promise.all([first, extra].map(redeem));
  for (const slot of ['fixed-2', 'fixed-3']) {
    const [code] = await generate(slot, 1);
    await redeem(code);
  }
  const [fourth, fourthExtra] = await generate('fixed-4', 2);
  await redeem(fourth);
  await redeem(fourthExtra);
  expect(await (await post('/api/sponsors/check', { code: fourthExtra })).json()).toMatchObject({ status: 'active', placement: 'fixed-4' });
  const { ads } = await (await SELF.fetch(origin + '/api/sponsors')).json<{ ads: Array<{ id: string; placement: string }> }>();
  expect(ads.map(ad => ad.placement)).toEqual([
    'carousel', 'carousel', 'carousel', 'carousel', 'fixed-1', 'fixed-2', 'fixed-3', 'fixed-4', 'fixed-1', 'fixed-4',
  ]);
  const removed = ads.at(-1)!;
  await env.DB.prepare('UPDATE sponsor_ads SET expires_at = ? WHERE id = ?').bind(Date.now() - 1, removed.id).run();
  const remaining = await (await SELF.fetch(origin + '/api/sponsors')).json<{ ads: Array<{ id: string }> }>();
  expect(remaining.ads.some(ad => ad.id === removed.id)).toBe(false);
  expect((await post(admin, { action: 'revoke', id: ads[0].id }, cookie)).status).toBe(200);
  expect((await post(admin, { action: 'approve', id: blocked.id }, cookie)).status).toBe(200);
  const dashboard = await (await SELF.fetch(origin + admin, { headers: { cookie } })).json();
  expect(dashboard).toMatchObject({ placements: [
    { placement: 'carousel', occupied: 4, capacity: 4 }, { placement: 'fixed-1', occupied: 2, capacity: null },
    { placement: 'fixed-2', occupied: 1, capacity: null }, { placement: 'fixed-3', occupied: 1, capacity: null },
    { placement: 'fixed-4', occupied: 1, capacity: null },
  ] });
});

it('可原样上传及读取 5 MB 图片，超限不消耗授权码，删除会级联移除分片', async () => {
  for (const entry of (await list('active')).filter(record => record.placement === 'fixed-4')) {
    expect((await post(admin, { action: 'revoke', id: entry.id }, cookie)).status).toBe(200);
  }
  const response = await post(admin, { action: 'create', placement: 'fixed-4', quantity: 1, duration: 1, unit: 'days' }, cookie);
  const { codes: [code] } = await response.json<{ codes: string[] }>();
  const limit = 5 * 1024 * 1024;
  const tooLarge = new Uint8Array(limit + 1);
  tooLarge.set(pngBytes());
  expect((await publish(code, '超限', tooLarge)).status).toBe(400);
  const allowed = tooLarge.subarray(0, limit);
  for (let offset = 1024 * 1024 - 1; offset < limit; offset += 1024 * 1024) allowed[offset] = 207;
  expect((await publish(code, '上限', allowed)).status).toBe(201);
  const entry = await approveCode(code);
  const imageResponse = await SELF.fetch(origin + '/api/sponsors/image/' + entry.id);
  expect(imageResponse.status).toBe(200);
  const reconstructed = await imageResponse.arrayBuffer();
  const fingerprint = async (data: ArrayBuffer | Uint8Array<ArrayBuffer>) =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
  expect(await fingerprint(reconstructed)).toEqual(await fingerprint(allowed));
  expect((await post(admin, { action: 'delete', id: entry.id }, cookie)).status).toBe(200);
  expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM sponsor_image_parts WHERE sponsor_id = ?').bind(entry.id).first('count')).toBe(0);
});

it('通用码可选择轮播或固定，固定并发投稿均衡分配，旧码不能改投', async () => {
  for (const entry of await list('active')) await post(admin, { action: 'revoke', id: entry.id }, cookie);
  const generate = async (placement: string, quantity: number) => {
    const response = await post(admin, { action: 'create', placement, quantity, duration: 1, unit: 'days' }, cookie);
    expect(response.status).toBe(201);
    return (await response.json<{ codes: string[] }>()).codes;
  };
  const [carousel, first, ...otherFixed] = await generate('choose', 7);
  expect(await (await post('/api/sponsors/check', { code: first })).json())
    .toMatchObject({ placement: null, placementChoice: true });
  expect((await publish(first, '未选择')).status).toBe(400);
  const fixed = await Promise.all([first, ...otherFixed].map(code => publish(code, '固定赞助', pngBytes(), 'fixed')));
  expect(fixed.map(response => response.status)).toEqual([201, 201, 201, 201, 201, 201]);
  const placements = await Promise.all(fixed.map(async response => (await response.json<{ placement: string }>()).placement));
  expect(placements.sort()).toEqual(['fixed-1', 'fixed-1', 'fixed-2', 'fixed-2', 'fixed-3', 'fixed-4']);
  expect(await (await publish(carousel, '轮播赞助', pngBytes(), 'carousel')).json()).toMatchObject({ placement: 'carousel' });
  expect(await (await post('/api/sponsors/check', { code: carousel })).json()).toMatchObject({ placement: 'carousel', placementChoice: false });
  const [bound] = await generate('fixed-4', 1);
  expect((await publish(bound, '不匹配', pngBytes(), 'carousel')).status).toBe(409);
  expect(await (await publish(bound, '指定位置', pngBytes(), 'fixed')).json()).toMatchObject({ placement: 'fixed-4' });
});

it('总开关仅管理员可改，关闭时停止公开展示和核销，重新开启保留原到期时间', async () => {
  const toggle = (enabled: boolean, session = cookie) => post(admin, { action: 'set-enabled', enabled }, session);
  expect((await toggle(false, '')).status).toBe(401);
  expect((await post(admin, { action: 'set-enabled', enabled: 'false' }, cookie)).status).toBe(400);
  const generated = await post(admin, { action: 'create', placement: 'fixed-3', quantity: 2, duration: 2, unit: 'days' }, cookie);
  const { codes: [activeCode, unusedCode] } = await generated.json<{ codes: string[] }>();
  expect((await publish(activeCode, '开关验证')).status).toBe(201);
  await approveCode(activeCode);
  const active = (await list('active')).find(record => record.codeHint === activeCode.slice(-8))!;
  const imageUrl = origin + '/api/sponsors/image/' + active.id;
  expect((await SELF.fetch(imageUrl)).status).toBe(200);
  try {
    expect(await (await toggle(false)).json()).toEqual({ enabled: false });
    const disabled = await SELF.fetch(origin + '/api/sponsors');
    expect(disabled.headers.get('Cache-Control')).toBe('no-store');
    expect(await disabled.json()).toEqual({ enabled: false, ads: [] });
    expect((await SELF.fetch(imageUrl)).status).toBe(404);
    expect((await SELF.fetch(imageUrl, { method: 'HEAD' })).status).toBe(404);
    expect((await post('/api/sponsors/check', { code: unusedCode })).status).toBe(403);
    expect((await publish(unusedCode, '不应核销')).status).toBe(403);
    expect((await list('unused')).some(record => record.codeHint === unusedCode.slice(-8))).toBe(true);
    expect((await list('active')).find(record => record.id === active.id)?.expiresAt).toBe(active.expiresAt);
  } finally {
    expect((await toggle(true)).status).toBe(200);
  }
  expect((await SELF.fetch(imageUrl)).status).toBe(200);
  expect(await (await post('/api/sponsors/check', { code: activeCode })).json()).toMatchObject({ status: 'active', expiresAt: active.expiresAt });
});
