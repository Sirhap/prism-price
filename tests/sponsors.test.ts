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
function publish(code: string, title: string, bytes = pngBytes(), placementType?: string) {
  const form = new FormData();
  form.set('code', code);
  form.set('title', title);
  form.set('image', new File([bytes], 'banner.png', { type: 'image/png' }));
  if (placementType) form.set('placementType', placementType);
  return post('/api/sponsors/redeem', form);
}

async function list(status = 'all') {
  const response = await SELF.fetch(origin + admin + '?status=' + status, { headers: { cookie } });
  expect(response.status).toBe(200);
  return (await response.json<{ codes: Array<{ id: string; codeHint: string; status: string; expiresAt: number | null; placement: string }> }>()).codes;
}

it('生成与管理仅限已登录管理员，拒绝越界数量及跨站提交', async () => {
  const batch = { action: 'create', quantity: 2, duration: 1, unit: 'months' };
  expect((await post(admin, batch)).status).toBe(401);
  expect((await post(admin, batch, cookie, 'https://elsewhere.test')).status).toBe(403);
  expect((await post(admin, { ...batch, quantity: 51 }, cookie)).status).toBe(400);
  expect((await post(admin, { ...batch, duration: 13 }, cookie)).status).toBe(400);
  expect((await post('/api/sponsors/check', {}, '', 'https://elsewhere.test')).status).toBe(403);
});

it('授权码免审且只能兑换一次；过期、作废、删除会停发素材', async () => {
  const generated = await post(admin, { action: 'create', quantity: 3, duration: 2, unit: 'days' }, cookie);
  expect(generated.status).toBe(201);
  const { codes } = await generated.json<{ codes: string[] }>();
  expect(new Set(codes).size).toBe(3);
  expect(codes.every(code => /^PRISM-[0-9A-F]{32}$/.test(code))).toBe(true);
  expect(await list('unused')).toHaveLength(3);
  expect(JSON.stringify(await list())).not.toContain(codes[0]);

  const check = async (code: string) => (await post('/api/sponsors/check', { code })).json();
  expect(await check(codes[0])).toMatchObject({ status: 'unused', expiresAt: null, duration: 2 });
  expect((await publish(codes[0], 'Bad', Uint8Array.from(new TextEncoder().encode('<svg>invalid raster image</svg>')))).status).toBe(400);
  expect(await check(codes[0])).toMatchObject({ status: 'unused' });

  const title = '赞助样例';
  const attempts = await Promise.all([publish(codes[0].toLowerCase(), title), publish(codes[0], title)]);
  expect(attempts.map(response => response.status).sort()).toEqual([201, 409]);
  const { expiresAt } = await attempts.find(response => response.status === 201)!.json<{ expiresAt: number }>();
  expect(expiresAt - Date.now()).toBeGreaterThan(86_400_000);
  expect(await check(codes[0])).toMatchObject({ status: 'active', expiresAt });
  const [first] = await list('active');
  const publicList = async () => {
    const response = await SELF.fetch(origin + '/api/sponsors');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    return response.json<{ ads: Array<{ id: string; title: string }> }>();
  };
  expect(await publicList()).toEqual({ enabled: true, ads: [{ id: first.id, title, expiresAt, placement: 'carousel' }] });
  const getImage = (id: string) => SELF.fetch(origin + '/api/sponsors/image/' + id);
  const publicImage = await getImage(first.id);
  expect(publicImage.headers.get('Content-Type')).toBe('image/png');
  expect(new Uint8Array(await publicImage.arrayBuffer())).toEqual(Uint8Array.from(atob(image), char => char.charCodeAt(0)));
  await env.DB.prepare('UPDATE sponsor_ads SET expires_at = ? WHERE id = ?').bind(Date.now() - 1, first.id).run();
  expect(await check(codes[0])).toMatchObject({ status: 'expired' });
  expect((await getImage(first.id)).status).toBe(404);
  expect(await list('expired')).toHaveLength(1);

  expect((await publish(codes[1], title)).status).toBe(201);
  const [second] = await list('active');
  expect((await post(admin, { action: 'revoke', id: second.id }, cookie)).status).toBe(200);
  expect((await getImage(second.id)).status).toBe(404);
  expect(await check(codes[1])).toMatchObject({ status: 'revoked' });
  expect((await publish(codes[2], title)).status).toBe(201);
  const [third] = await list('active');
  expect((await post(admin, { action: 'delete', id: third.id }, cookie)).status).toBe(200);
  expect((await post('/api/sponsors/check', { code: codes[2] })).status).toBe(404);
  expect((await getImage(third.id)).status).toBe(404);
  expect(await publicList()).toEqual({ enabled: true, ads: [] });
});

it('自然月按北京时间月末截断，天数按完整 24 小时计', () => {
  const start = Date.parse('2027-01-31T01:25:00+08:00');
  expect(sponsorExpiry(start, 1, 'months')).toBe(Date.parse('2027-02-28T01:25:00+08:00'));
  expect(sponsorExpiry(start, 2, 'days')).toBe(Date.parse('2027-02-02T01:25:00+08:00'));
});

it('轮播最多四张、每个固定位独立限一张，满位不消耗授权码', async () => {
  async function generate(placement: string, quantity: number) {
    const response = await post(admin, { action: 'create', placement, quantity, duration: 1, unit: 'days' }, cookie);
    expect(response.status).toBe(201);
    return (await response.json<{ codes: string[] }>()).codes;
  }
  const redeem = (code: string) => publish(code, '位置验证');
  const slides = await generate('carousel', 5);
  for (const code of slides.slice(0, 3)) expect((await redeem(code)).status).toBe(201);
  const finalists = await Promise.all(slides.slice(3).map(redeem));
  expect(finalists.map(response => response.status).sort()).toEqual([201, 409]);
  const blocked = slides[3 + finalists.findIndex(response => response.status === 409)];
  expect(await (await post('/api/sponsors/check', { code: blocked })).json()).toMatchObject({ status: 'unused', placement: 'carousel' });
  const [first, extra] = await generate('fixed-1', 2);
  expect((await redeem(first)).status).toBe(201);
  expect((await redeem(extra)).status).toBe(409);
  for (const slot of ['fixed-2', 'fixed-3']) {
    const [code] = await generate(slot, 1);
    expect((await redeem(code)).status).toBe(201);
  }
  const [fourth, fourthExtra] = await generate('fixed-4', 2);
  expect((await redeem(fourth)).status).toBe(201);
  expect((await redeem(fourthExtra)).status).toBe(409);
  expect(await (await post('/api/sponsors/check', { code: fourthExtra })).json()).toMatchObject({ status: 'unused', placement: 'fixed-4' });
  const { ads } = await (await SELF.fetch(origin + '/api/sponsors')).json<{ ads: Array<{ id: string; placement: string }> }>();
  expect(ads.map(ad => ad.placement)).toEqual(['carousel', 'carousel', 'carousel', 'carousel', 'fixed-1', 'fixed-2', 'fixed-3', 'fixed-4']);
  expect((await post(admin, { action: 'revoke', id: ads[0].id }, cookie)).status).toBe(200);
  expect((await redeem(blocked)).status).toBe(201);
  const dashboard = await (await SELF.fetch(origin + admin, { headers: { cookie } })).json();
  expect(dashboard).toMatchObject({ placements: [
    { placement: 'carousel', occupied: 4, capacity: 4 }, { placement: 'fixed-1', occupied: 1, capacity: 1 },
    { placement: 'fixed-2', occupied: 1, capacity: 1 }, { placement: 'fixed-3', occupied: 1, capacity: 1 },
    { placement: 'fixed-4', occupied: 1, capacity: 1 },
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
  const entry = (await list('active')).find(record => record.codeHint === code.slice(-8))!;
  const imageResponse = await SELF.fetch(origin + '/api/sponsors/image/' + entry.id);
  expect(imageResponse.status).toBe(200);
  const reconstructed = await imageResponse.arrayBuffer();
  const fingerprint = async (data: ArrayBuffer | Uint8Array<ArrayBuffer>) =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
  expect(await fingerprint(reconstructed)).toEqual(await fingerprint(allowed));
  expect((await post(admin, { action: 'delete', id: entry.id }, cookie)).status).toBe(200);
  expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM sponsor_image_parts WHERE sponsor_id = ?').bind(entry.id).first('count')).toBe(0);
});

it('通用码可选择轮播或固定，固定并发投稿安排到不同空位，旧码不能改投', async () => {
  for (const entry of await list('active')) await post(admin, { action: 'revoke', id: entry.id }, cookie);
  const generate = async (placement: string, quantity: number) => {
    const response = await post(admin, { action: 'create', placement, quantity, duration: 1, unit: 'days' }, cookie);
    expect(response.status).toBe(201);
    return (await response.json<{ codes: string[] }>()).codes;
  };
  const [first, second, carousel] = await generate('choose', 3);
  expect(await (await post('/api/sponsors/check', { code: first })).json())
    .toMatchObject({ placement: null, placementChoice: true });
  expect((await publish(first, '未选择')).status).toBe(400);
  const fixed = await Promise.all([first, second].map(code => publish(code, '固定赞助', pngBytes(), 'fixed')));
  expect(fixed.map(response => response.status)).toEqual([201, 201]);
  const placements = await Promise.all(fixed.map(async response => (await response.json<{ placement: string }>()).placement));
  expect(placements.sort()).toEqual(['fixed-1', 'fixed-2']);
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
