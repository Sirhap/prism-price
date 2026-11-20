const PREFIX = '/api/sponsors';
const MAX_IMAGE = 5 * 1024 * 1024;
const IMAGE_PART_SIZE = 1024 * 1024;
const CODE_FORMAT = /^PRISM-[0-9A-F]{32}$/;
const ID_FORMAT = '[a-f0-9-]{36}';
const capacities = { carousel: 4, 'fixed-1': 1, 'fixed-2': 1, 'fixed-3': 1, 'fixed-4': 1 } as const;
type Placement = keyof typeof capacities;
const fixedPlacements = (Object.keys(capacities) as Placement[]).filter(placement => placement !== 'carousel');
function isPlacement(value: unknown): value is Placement {
  return typeof value === 'string' && Object.hasOwn(capacities, value);
}
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const sponsorsEnabledSql = '(SELECT sponsors_enabled FROM admin_settings WHERE id = 1) = 1';
const sponsorDisabledMessage = '赞助推广已关闭';
async function sponsorsEnabled(db: D1Database): Promise<boolean> {
  return (await db.prepare('SELECT sponsors_enabled FROM admin_settings WHERE id = 1').first<number>('sponsors_enabled')) === 1;
}
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
const statusSql = `CASE WHEN revoked_at IS NOT NULL THEN 'revoked'
  WHEN redeemed_at IS NULL THEN 'unused' WHEN expires_at <= ? THEN 'expired' ELSE 'active' END`;
const metadata = `id, code_hint AS codeHint, duration, unit, created_at AS createdAt,
  redeemed_at AS redeemedAt, expires_at AS expiresAt, revoked_at AS revokedAt, title, placement,
  placement_choice AS placementChoice`;
type Unit = 'days' | 'months';
type SponsorStatus = 'unused' | 'active' | 'expired' | 'revoked';
const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
const failure = (error: string, status = 400) => json({ error }, status);

async function readBoundedBody(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const length = Number(request.headers.get('Content-Length') || '0');
  if (length > limit || !request.body) return null;
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    if (size + part.value.length > limit) {
      await reader.cancel();
      return null;
    }
    size += part.value.length;
    parts.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

async function readJson(request: Request, limit: number): Promise<Record<string, unknown> | null> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) return null;
  const bytes = await readBoundedBody(request, limit);
  if (!bytes) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function codeHash(code: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))));
}

/** 自然月按北京时间计算，遇目标月份没有该日时取当月最后一天。 */
export function sponsorExpiry(now: number, duration: number, unit: Unit): number {
  if (unit === 'days') return now + duration * 86_400_000;
  const shift = 8 * 3_600_000;
  const date = new Date(now + shift);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + duration);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return +date - shift;
}

function identifyImage(bytes: Uint8Array) {
  if (bytes.length < 24 || bytes.length > MAX_IMAGE) return null;
  const matches = (offset: number, prefix: number[]) => prefix.every((byte, index) => bytes[offset + index] === byte);
  const imageType = matches(0, [137, 80, 78, 71, 13, 10, 26, 10]) ? 'image/png'
    : matches(0, [255, 216, 255]) ? 'image/jpeg'
    : matches(0, [82, 73, 70, 70]) && matches(8, [87, 69, 66, 80]) ? 'image/webp' : '';
  return imageType || null;
}

async function readSponsorForm(request: Request) {
  const contentType = request.headers.get('Content-Type') || '';
  if (!/^multipart\/form-data\s*;/i.test(contentType)) return null;
  const bytes = await readBoundedBody(request, MAX_IMAGE + 8 * 1024);
  if (!bytes) return null;
  try {
    const form = await new Response(bytes, { headers: { 'Content-Type': contentType } }).formData();
    return { code: form.get('code'), title: form.get('title'), image: form.get('image'), placementType: form.get('placementType') };
  } catch {
    return null;
  }
}

/** 公共提交只接受自站页面发来的请求，授权码不进入 URL、访问日志或公共广告列表。 */
export async function handleSponsorPublic(request: Request, db: D1Database): Promise<Response | null> {
  const url = new URL(request.url);
  const now = Date.now();
  if (url.pathname === PREFIX && request.method === 'GET') {
    if (!await sponsorsEnabled(db)) return json({ enabled: false, ads: [] });
    const { results } = await db.prepare(`SELECT id, title, expires_at AS expiresAt, placement FROM (
      SELECT id, title, expires_at, placement, ROW_NUMBER() OVER (PARTITION BY placement ORDER BY redeemed_at, id) AS position
      FROM sponsor_ads WHERE revoked_at IS NULL AND redeemed_at IS NOT NULL AND expires_at > ? AND ${sponsorsEnabledSql}
    ) WHERE position <= CASE WHEN placement = 'carousel' THEN ? ELSE 1 END ORDER BY placement, position`)
      .bind(now, capacities.carousel).all();
    return json({ enabled: true, ads: results });
  }
  const image = url.pathname.match(new RegExp(`^${PREFIX}/image/(${ID_FORMAT})$`));
  if (image && (request.method === 'GET' || request.method === 'HEAD')) {
    const row = await db.prepare(`SELECT image_type AS imageType, image_key AS imageKey FROM sponsor_ads
      WHERE id = ? AND revoked_at IS NULL AND redeemed_at IS NOT NULL AND expires_at > ? AND ${sponsorsEnabledSql}`)
      .bind(image[1], now).first<{ imageType: string; imageKey: string | null }>();
    if (!row) return failure('赞助内容不可用', 404);
    let data: Blob | null = null;
    if (request.method === 'GET') {
      const { results } = await db.prepare(`SELECT parts.content FROM sponsor_image_parts AS parts JOIN sponsor_ads AS ads
        ON ads.id = parts.sponsor_id WHERE ads.id = ? AND ads.image_key = ?
        AND ads.revoked_at IS NULL AND ads.expires_at > ? AND ${sponsorsEnabledSql} ORDER BY parts.part`)
        .bind(image[1], row.imageKey, Date.now()).all<{ content: number[] }>();
      if (results.length) data = new Blob(results.map(part => Uint8Array.from(part.content)));
      else if (!row.imageKey) {
        const legacy = await db.prepare(`SELECT image FROM sponsor_ads WHERE id = ? AND image_key IS NULL
          AND revoked_at IS NULL AND expires_at > ? AND ${sponsorsEnabledSql}`).bind(image[1], Date.now()).first<{ image: number[] | null }>();
        if (legacy?.image) data = new Blob([Uint8Array.from(legacy.image)]);
      }
      if (!data) return failure('赞助图片不可用', 404);
    }
    return new Response(data, { headers: {
      ...headers, 'Content-Type': row.imageType, 'Content-Security-Policy': "default-src 'none'; sandbox",
    } });
  }

  const redeem = url.pathname === `${PREFIX}/redeem`;
  if (request.method !== 'POST' || (!redeem && url.pathname !== `${PREFIX}/check`)) return null;
  if (request.headers.get('Origin') !== url.origin) return failure('请求来源不匹配', 403);
  if (!await sponsorsEnabled(db)) return failure(sponsorDisabledMessage, 403);
  const data = redeem ? await readSponsorForm(request) : await readJson(request, 1024);
  if (!data) return failure('提交格式不正确或图片过大');
  const code = typeof data.code === 'string' ? data.code.trim().toUpperCase() : '';
  if (!CODE_FORMAT.test(code)) return failure('授权码格式不正确');
  const hash = await codeHash(code);
  const row = await db.prepare(`SELECT id, duration, unit, placement, placement_choice AS placementChoice, expires_at AS expiresAt, ${statusSql} AS status
    FROM sponsor_ads WHERE code_hash = ?`).bind(now, hash)
    .first<{ id: string; duration: number; unit: Unit; placement: Placement; placementChoice: number; expiresAt: number | null; status: SponsorStatus }>();
  if (!row) return failure('授权码无效', 404);
  const mayChoose = row.status === 'unused' && row.placementChoice === 1;
  if (!redeem) return json({ status: row.status, duration: row.duration, unit: row.unit, expiresAt: row.expiresAt,
    placement: mayChoose ? null : row.placement, placementChoice: mayChoose });
  if (row.status !== 'unused') return failure('授权码已使用、已到期或已作废', 409);
  const requestedType = data.placementType;
  const boundType = row.placement === 'carousel' ? 'carousel' : 'fixed';
  if ((requestedType != null || mayChoose) && requestedType !== 'carousel' && requestedType !== 'fixed') {
    return failure('请选择轮播或固定赞助位');
  }
  if (!mayChoose && requestedType != null && requestedType !== boundType) {
    return failure(boundType === 'carousel' ? '此授权码仅可投放顶部轮播' : '此授权码仅可投放固定赞助位', 409);
  }
  const candidates = mayChoose ? requestedType === 'fixed' ? fixedPlacements : ['carousel'] : [row.placement];
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  if (!title || title.length > 80 || /[\u0000-\u001f\u007f]/.test(title)) return failure('请填写 1～80 字的赞助标题');
  const file = data.image;
  if (!(file instanceof File) || file.size > MAX_IMAGE) return failure('请上传不超过 5 MB 的 JPG、PNG 或 WebP 图片');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const imageType = identifyImage(bytes);
  if (!imageType) return failure('请上传 JPG、PNG 或 WebP 图片');
  const expiresAt = sponsorExpiry(now, row.duration, row.unit);
  const imageKey = crypto.randomUUID();
  const update = db.prepare(`WITH available AS MATERIALIZED (
    SELECT candidate.value AS placement FROM json_each(?) AS candidate WHERE (
      SELECT COUNT(*) FROM sponsor_ads WHERE placement = candidate.value AND revoked_at IS NULL
        AND redeemed_at IS NOT NULL AND expires_at > ?
    ) < CASE WHEN candidate.value = 'carousel' THEN ? ELSE 1 END ORDER BY candidate.key LIMIT 1
  )
  UPDATE sponsor_ads SET title = ?, image_type = ?, image_key = ?, redeemed_at = ?, expires_at = ?,
    placement = (SELECT placement FROM available)
    WHERE id = ? AND redeemed_at IS NULL AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM available)
      AND ${sponsorsEnabledSql}
    RETURNING placement`)
    .bind(JSON.stringify(candidates), now, capacities.carousel, title, imageType, imageKey, now, expiresAt, row.id);
  const insert = db.prepare(`INSERT INTO sponsor_image_parts(sponsor_id, part, content)
    SELECT id, ?, ? FROM sponsor_ads WHERE id = ? AND image_key = ?`);
  const parts = [];
  for (let offset = 0; offset < bytes.length; offset += IMAGE_PART_SIZE) {
    parts.push(insert.bind(offset / IMAGE_PART_SIZE, bytes.slice(offset, offset + IMAGE_PART_SIZE).buffer, row.id, imageKey));
  }
  const [saved] = await db.batch<{ placement: Placement }>([update, ...parts]);
  if (saved.results[0]) return json({ status: 'active', expiresAt, placement: saved.results[0].placement }, 201);
  if (!await sponsorsEnabled(db)) return failure(sponsorDisabledMessage, 403);
  const unused = await db.prepare('SELECT 1 FROM sponsor_ads WHERE id = ? AND redeemed_at IS NULL AND revoked_at IS NULL').bind(row.id).first();
  return failure(unused ? '该赞助位已满，授权码尚未使用' : '授权码已使用或已作废', 409);
}

/** 由后台路由完成同源和管理员鉴权后调用；只在生成时返回完整授权码。 */
export async function handleSponsorAdmin(request: Request, db: D1Database): Promise<Response> {
  const url = new URL(request.url);
  const now = Date.now();
  if (request.method === 'GET') {
    const filter = url.searchParams.get('status') || 'all';
    const page = Number(url.searchParams.get('page') || 1);
    if (!['all', 'unused', 'active', 'expired', 'revoked'].includes(filter) || !Number.isSafeInteger(page) || page < 1 || page > 10000) return failure('筛选条件无效');
    const { results } = await db.prepare(`SELECT * FROM (SELECT ${metadata}, ${statusSql} AS status FROM sponsor_ads)
      WHERE ? = 'all' OR status = ? ORDER BY createdAt DESC, id DESC LIMIT 51 OFFSET ?`)
      .bind(now, filter, filter, (page - 1) * 50).all();
    const { results: occupied } = await db.prepare(`SELECT placement, COUNT(*) AS count FROM sponsor_ads
      WHERE revoked_at IS NULL AND redeemed_at IS NOT NULL AND expires_at > ? GROUP BY placement`)
      .bind(now).all<{ placement: Placement; count: number }>();
    const placements = Object.entries(capacities).map(([placement, capacity]) => ({
      placement, capacity, occupied: occupied.find(row => row.placement === placement)?.count || 0,
    }));
    return json({ enabled: await sponsorsEnabled(db), codes: results.slice(0, 50), page, hasMore: results.length > 50, placements });
  }
  if (request.method !== 'POST') return failure('请求方法无效', 405);
  const data = await readJson(request, 2048);
  if (!data) return failure('请求格式错误');
  if (data.action === 'set-enabled') {
    if (typeof data.enabled !== 'boolean') return failure('赞助推广状态无效');
    await db.prepare('UPDATE admin_settings SET sponsors_enabled = ? WHERE id = 1').bind(Number(data.enabled)).run();
    return json({ enabled: data.enabled });
  }
  if (data.action === 'create') {
    const { quantity, duration, unit } = data;
    const placement = data.placement ?? 'carousel';
    if (placement !== 'choose' && !isPlacement(placement)) return failure('赞助位无效');
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 50 ||
        typeof duration !== 'number' || !Number.isInteger(duration) || duration < 1 ||
        (unit !== 'days' && unit !== 'months') || duration > (unit === 'days' ? 365 : 12)) return failure('每批 1～50 个，支持 1～365 天或 1～12 个月');
    const codes = Array.from({ length: quantity }, () => `PRISM-${hex(crypto.getRandomValues(new Uint8Array(16)))}`);
    const prepared = db.prepare('INSERT INTO sponsor_ads(id, code_hash, code_hint, duration, unit, created_at, placement, placement_choice) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    await db.batch(await Promise.all(codes.map(async code => prepared.bind(crypto.randomUUID(), await codeHash(code), code.slice(-8),
      duration, unit, now, placement === 'choose' ? 'carousel' : placement, Number(placement === 'choose')))));
    return json({ codes }, 201);
  }
  if (typeof data.id !== 'string' || !new RegExp(`^${ID_FORMAT}$`).test(data.id)) return failure('授权记录无效');
  if (data.action === 'revoke') {
    const result = await db.prepare('UPDATE sponsor_ads SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? RETURNING id').bind(now, data.id).first();
    return result ? json({ ok: true }) : failure('授权记录不存在', 404);
  }
  if (data.action === 'delete') {
    const result = await db.prepare('DELETE FROM sponsor_ads WHERE id = ? RETURNING id').bind(data.id).first();
    return result ? json({ ok: true }) : failure('授权记录不存在', 404);
  }
  return failure('未知操作');
}
