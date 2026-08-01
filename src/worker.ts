interface PinRow {
  id: string;
  title: string;
  lat: number;
  lng: number;
  place_name: string | null;
  place_names: string | null;
  region_id: string | null;
  country_code: string | null;
  event_date: string | null;
  color: string;
  content: string;
  photo_style: string | null;
  cover_media_id: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface MediaRow {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  caption: string | null;
  sort_order: number;
}

interface SessionRow {
  token_hash: string;
  csrf_token: string;
  expires_at: string;
}

interface PinPayload {
  title?: unknown;
  lat?: unknown;
  lng?: unknown;
  place_name?: unknown;
  place_names?: unknown;
  region_id?: unknown;
  country_code?: unknown;
  event_date?: unknown;
  color?: unknown;
  content?: unknown;
  photo_style?: unknown;
  cover_media_id?: unknown;
  media?: unknown;
}

interface Candidate {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  regionId: string;
  regionName: string;
  countryCode: string;
  pinCount: number;
  provider: 'Amap' | 'Google';
}

interface CountryRow {
  country_code: string;
  iso3: string | null;
  name_en: string;
  name_zh: string | null;
  status: 'pending' | 'building' | 'ready' | 'failed';
  package_version: string | null;
  manifest_key: string | null;
  bbox_json: string | null;
  last_error: string | null;
  updated_at: string;
}

interface CountryManifest {
  schemaVersion: number;
  countryCode: string;
  iso3: string;
  name: { en: string; zh?: string };
  status: 'ready';
  packageVersion: string;
  bounds: [number, number, number, number];
  baseZoom: number;
  maxZoom: number;
  keepsakesFromZoom: number;
  raster: { key: string; width: number; height: number; sha256: string };
}

interface CountryBuildCallback {
  jobId?: unknown;
  countryCode?: unknown;
  status?: unknown;
  packageVersion?: unknown;
  manifestKey?: unknown;
  githubRunId?: unknown;
  error?: unknown;
}

const SESSION_COOKIE = '__Host-travel_session';
const LOCAL_SESSION_COOKIE = 'travel_session_local';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const COLORS = new Set(['#c85f3c', '#47756f', '#d19a3b', '#805b88', '#55739a', '#9a4d4b']);
const PHOTO_STYLES = new Set(['photo-classic', 'photo-landscape', 'photo-portrait']);
const encoder = new TextEncoder();

function responseHeaders(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('cross-origin-opener-policy', 'same-origin');
  headers.set('x-frame-options', 'DENY');
  return headers;
}

function json(data: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra })
  });
}

function error(code: string, status: number): Response {
  return json({ error: code }, status);
}

function parseCookies(request: Request): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) cookies.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()));
  }
  return cookies;
}

function sessionCookieName(request: Request): string {
  return new URL(request.url).protocol === 'https:' ? SESSION_COOKIE : LOCAL_SESSION_COOKIE;
}

function sessionCookie(request: Request, value: string, maxAge: number): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${sessionCookieName(request)}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly${secure}; SameSite=Lax`;
}

function randomToken(bytes = 32): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(hash)].map((item) => item.toString(16).padStart(2, '0')).join('');
}

async function tokenHash(token: string, secret: string): Promise<string> {
  return digest(`${secret}\u0000${token}`);
}

async function secureEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right))
  ]);
  return crypto.subtle.timingSafeEqual(leftHash, rightHash);
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isoAfter(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function sameOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const requestOrigin = new URL(request.url).origin;
  return origin === requestOrigin || origin === env.APP_ORIGIN;
}

async function currentSession(request: Request, env: Env): Promise<SessionRow | null> {
  const token = parseCookies(request).get(sessionCookieName(request));
  if (!token) return null;
  const hash = await tokenHash(token, env.TRAVEL_SESSION_SECRET);
  const session = await env.DB.prepare('SELECT token_hash, csrf_token, expires_at FROM sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(hash, new Date().toISOString()).first<SessionRow>();
  return session || null;
}

async function requireMutationAuth(request: Request, env: Env): Promise<SessionRow | Response> {
  if (!sameOrigin(request, env)) return error('INVALID_ORIGIN', 403);
  const session = await currentSession(request, env);
  if (!session) return error('UNAUTHORIZED', 401);
  const csrf = request.headers.get('x-csrf-token') || '';
  if (!csrf || !(await secureEqual(csrf, session.csrf_token))) return error('INVALID_CSRF', 403);
  return session;
}

async function boundedJson<T>(request: Request, maxBytes = 1_000_000): Promise<T> {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > maxBytes) throw new Error('PAYLOAD_TOO_LARGE');
  const text = await request.text();
  if (text.length > maxBytes) throw new Error('PAYLOAD_TOO_LARGE');
  return JSON.parse(text) as T;
}

function asOptionalString(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new Error('INVALID_FIELD');
  return value.trim().slice(0, maxLength) || null;
}

function validatePayload(payload: PinPayload): {
  title: string;
  lat: number;
  lng: number;
  placeName: string | null;
  placeNames: string | null;
  regionId: string | null;
  countryCode: string | null;
  eventDate: string | null;
  color: string;
  content: string;
  photoStyle: string | null;
  coverMediaId: string | null;
  media: Array<{ media_id: string; sort_order: number; caption: string | null }>;
} {
  if (typeof payload.title !== 'string' || !payload.title.trim() || payload.title.trim().length > 160) throw new Error('INVALID_TITLE');
  const lat = Number(payload.lat);
  const lng = Number(payload.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) throw new Error('INVALID_COORDINATES');
  const color = typeof payload.color === 'string' && COLORS.has(payload.color.toLowerCase()) ? payload.color.toLowerCase() : '#c85f3c';
  const eventDate = asOptionalString(payload.event_date, 10);
  if (eventDate && !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) throw new Error('INVALID_DATE');
  const content = typeof payload.content === 'string' ? payload.content.slice(0, 200_000) : '';
  const media = Array.isArray(payload.media) ? payload.media.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error('INVALID_MEDIA');
    const record = item as Record<string, unknown>;
    if (typeof record.media_id !== 'string' || !/^media_[a-f0-9]{32}$/.test(record.media_id)) throw new Error('INVALID_MEDIA');
    return { media_id: record.media_id, sort_order: index, caption: asOptionalString(record.caption, 500) };
  }).slice(0, 30) : [];
  const requestedStyle = asOptionalString(payload.photo_style, 30);
  return {
    title: payload.title.trim(), lat, lng,
    placeName: asOptionalString(payload.place_name, 240),
    placeNames: payload.place_names && typeof payload.place_names === 'object' ? JSON.stringify(payload.place_names).slice(0, 2000) : null,
    regionId: asOptionalString(payload.region_id, 180),
    countryCode: asOptionalString(payload.country_code, 2)?.toUpperCase() || null,
    eventDate, color, content,
    photoStyle: media.length && requestedStyle && PHOTO_STYLES.has(requestedStyle) ? requestedStyle : media.length ? 'photo-classic' : null,
    coverMediaId: media.some((item) => item.media_id === payload.cover_media_id) ? String(payload.cover_media_id) : media[0]?.media_id || null,
    media
  };
}

function requireLocation(value: ReturnType<typeof validatePayload>): void {
  if (!value.placeName || !value.regionId || !value.countryCode || !/^[A-Z]{2}$/.test(value.countryCode)) throw new Error('INVALID_LOCATION');
}

async function requireKnownRegion(env: Env, regionId: string, countryCode: string): Promise<void> {
  const region = await env.DB.prepare('SELECT region_id FROM regions WHERE region_id = ? AND country_code = ?').bind(regionId, countryCode).first();
  if (!region) throw new Error('INVALID_REGION');
}

function mediaUrl(id: string): string { return `/media/${encodeURIComponent(id)}`; }

async function serializePin(env: Env, row: PinRow): Promise<Record<string, unknown>> {
  const mediaResult = await env.DB.prepare(`
    SELECT m.id, m.filename, m.content_type, m.size, pm.caption, pm.sort_order
    FROM pin_media pm JOIN media_assets m ON m.id = pm.media_id
    WHERE pm.pin_id = ? ORDER BY pm.sort_order
  `).bind(row.id).all<MediaRow>();
  return {
    ...row,
    place_names: row.place_names ? JSON.parse(row.place_names) as unknown : null,
    media: mediaResult.results.map((media) => ({ ...media, url: mediaUrl(media.id) }))
  };
}

async function getPin(env: Env, id: string, includeDeleted = false): Promise<Record<string, unknown> | null> {
  const row = await env.DB.prepare(`SELECT * FROM pins WHERE id = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`).bind(id).first<PinRow>();
  return row ? serializePin(env, row) : null;
}

async function listPins(env: Env): Promise<Array<Record<string, unknown>>> {
  const rows = await env.DB.prepare('SELECT * FROM pins WHERE deleted_at IS NULL ORDER BY COALESCE(event_date, created_at) DESC').all<PinRow>();
  return Promise.all(rows.results.map((row) => serializePin(env, row)));
}

async function pinStats(env: Env): Promise<{ cities: number; countries: number }> {
  const row = await env.DB.prepare(`SELECT
    count(DISTINCT region_id) AS cities,
    count(DISTINCT country_code) AS countries
    FROM pins WHERE deleted_at IS NULL AND region_id IS NOT NULL AND country_code IS NOT NULL`)
    .first<{ cities: number; countries: number }>();
  return { cities: Number(row?.cities || 0), countries: Number(row?.countries || 0) };
}

function serializeCountry(row: CountryRow): Record<string, unknown> {
  return {
    countryCode: row.country_code,
    iso3: row.iso3,
    name: { en: row.name_en, zh: row.name_zh || row.name_en },
    status: row.status,
    packageVersion: row.package_version,
    manifestUrl: row.manifest_key ? `/tiles/${row.manifest_key}` : null,
    bounds: row.bbox_json ? JSON.parse(row.bbox_json) as unknown : null,
    updatedAt: row.updated_at
  };
}

async function listReadyCountries(env: Env): Promise<Array<Record<string, unknown>>> {
  const rows = await env.DB.prepare(`SELECT country_code,iso3,name_en,name_zh,status,package_version,manifest_key,bbox_json,last_error,updated_at
    FROM countries WHERE status='ready' AND manifest_key IS NOT NULL ORDER BY country_code`).all<CountryRow>();
  return rows.results.map(serializeCountry);
}

async function dispatchCountryBuild(env: Env, jobId: string, countryCode: string): Promise<void> {
  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/dispatches`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'content-type': 'application/json',
      'user-agent': 'ysoseri-travel-worker',
      'x-github-api-version': '2022-11-28'
    },
    body: JSON.stringify({ event_type: 'travel-country-build', client_payload: { country_code: countryCode, job_id: jobId } })
  });
  if (response.status !== 204) throw new Error(`GITHUB_DISPATCH_${response.status}`);
}

async function ensureCountryBuild(env: Env, countryCode: string): Promise<void> {
  const normalized = countryCode.toUpperCase();
  const current = await env.DB.prepare('SELECT status FROM countries WHERE country_code=?').bind(normalized).first<{ status: string }>();
  if (current?.status === 'ready' || current?.status === 'building' || current?.status === 'pending') return;
  const jobId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO countries (country_code,iso3,name_en,name_zh,status)
      VALUES (?,NULL,?,NULL,'pending')
      ON CONFLICT(country_code) DO UPDATE SET status='pending',last_error=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE countries.status='failed'`).bind(normalized, normalized),
    env.DB.prepare(`INSERT OR IGNORE INTO country_build_jobs (id,country_code,status) VALUES (?,?,'pending')`).bind(jobId, normalized)
  ]);
  const active = await env.DB.prepare(`SELECT id FROM country_build_jobs WHERE country_code=? AND status IN ('pending','building') ORDER BY requested_at LIMIT 1`)
    .bind(normalized).first<{ id: string }>();
  if (!active || active.id !== jobId) return;
  await env.DB.batch([
    env.DB.prepare("UPDATE countries SET status='building',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE country_code=? AND status='pending'").bind(normalized),
    env.DB.prepare("UPDATE country_build_jobs SET status='building',attempts=attempts+1,started_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending'").bind(jobId)
  ]);
  try {
    await dispatchCountryBuild(env, jobId, normalized);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message.slice(0, 500) : 'GITHUB_DISPATCH_FAILED';
    await env.DB.batch([
      env.DB.prepare("UPDATE countries SET status='failed',last_error=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE country_code=?").bind(message, normalized),
      env.DB.prepare("UPDATE country_build_jobs SET status='failed',error=?,finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(message, jobId)
    ]);
    throw caught;
  }
}

async function handleCountryBuildCallback(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return error('METHOD_NOT_ALLOWED', 405);
  const text = await request.text();
  if (text.length > 20_000) return error('PAYLOAD_TOO_LARGE', 413);
  const supplied = request.headers.get('x-country-build-signature') || '';
  const expected = `sha256=${await hmacHex(env.COUNTRY_BUILD_CALLBACK_SECRET, text)}`;
  if (!(await secureEqual(supplied, expected))) return error('INVALID_SIGNATURE', 401);
  const payload = JSON.parse(text) as CountryBuildCallback;
  const jobId = asOptionalString(payload.jobId, 100);
  const countryCode = asOptionalString(payload.countryCode, 2)?.toUpperCase();
  const status = payload.status === 'ready' || payload.status === 'failed' ? payload.status : null;
  if (!jobId || !countryCode || !/^[A-Z]{2}$/.test(countryCode) || !status) return error('INVALID_CALLBACK', 400);
  const job = await env.DB.prepare('SELECT id FROM country_build_jobs WHERE id=? AND country_code=?').bind(jobId, countryCode).first();
  if (!job) return error('BUILD_JOB_NOT_FOUND', 404);
  if (status === 'failed') {
    const message = asOptionalString(payload.error, 500) || 'COUNTRY_BUILD_FAILED';
    await env.DB.batch([
      env.DB.prepare("UPDATE countries SET status='failed',last_error=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE country_code=?").bind(message, countryCode),
      env.DB.prepare("UPDATE country_build_jobs SET status='failed',github_run_id=?,error=?,finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(asOptionalString(payload.githubRunId, 80), message, jobId)
    ]);
    return json({ ok: true, status: 'failed' });
  }
  const manifestKey = asOptionalString(payload.manifestKey, 300);
  const packageVersion = asOptionalString(payload.packageVersion, 120);
  if (!manifestKey || !packageVersion || manifestKey !== `v3/countries/${countryCode}/manifest.json`) return error('INVALID_MANIFEST', 400);
  const object = await env.TRAVEL_TILES.get(manifestKey);
  if (!object) return error('MANIFEST_NOT_FOUND', 409);
  const manifest = await new Response(object.body).json() as CountryManifest;
  if (manifest.countryCode !== countryCode || manifest.packageVersion !== packageVersion || manifest.status !== 'ready') return error('MANIFEST_MISMATCH', 409);
  await env.DB.batch([
    env.DB.prepare(`UPDATE countries SET iso3=?,name_en=?,name_zh=?,status='ready',package_version=?,manifest_key=?,bbox_json=?,last_error=NULL,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE country_code=?`)
      .bind(manifest.iso3, manifest.name.en, manifest.name.zh || null, packageVersion, manifestKey, JSON.stringify(manifest.bounds), countryCode),
    env.DB.prepare("UPDATE country_build_jobs SET status='ready',github_run_id=?,error=NULL,finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
      .bind(asOptionalString(payload.githubRunId, 80), jobId)
  ]);
  return json({ ok: true, status: 'ready' });
}

async function replaceMedia(env: Env, pinId: string, media: Array<{ media_id: string; sort_order: number; caption: string | null }>): Promise<void> {
  if (media.length) {
    const placeholders = media.map(() => '?').join(',');
    const found = await env.DB.prepare(`SELECT id FROM media_assets WHERE id IN (${placeholders})`).bind(...media.map((item) => item.media_id)).all<{ id: string }>();
    if (found.results.length !== new Set(media.map((item) => item.media_id)).size) throw new Error('MEDIA_NOT_FOUND');
  }
  const statements = [env.DB.prepare('DELETE FROM pin_media WHERE pin_id = ?').bind(pinId)];
  for (const item of media) statements.push(env.DB.prepare('INSERT INTO pin_media (pin_id, media_id, sort_order, caption) VALUES (?, ?, ?, ?)').bind(pinId, item.media_id, item.sort_order, item.caption));
  await env.DB.batch(statements);
}

async function handleAuth(request: Request, env: Env, path: string): Promise<Response> {
  if (path === '/api/auth/session' && request.method === 'GET') {
    const session = await currentSession(request, env);
    return json(session ? { authenticated: true, csrfToken: session.csrf_token, expiresAt: session.expires_at } : { authenticated: false });
  }
  if (path === '/api/auth/login' && request.method === 'POST') {
    if (!sameOrigin(request, env)) return error('INVALID_ORIGIN', 403);
    const payload = await boundedJson<{ password?: unknown }>(request, 10_000);
    if (typeof payload.password !== 'string' || !(await secureEqual(payload.password, env.TRAVEL_PASSWORD))) return error('INVALID_PASSWORD', 401);
    const token = randomToken();
    const csrf = randomToken(24);
    const expiresAt = isoAfter(SESSION_SECONDS);
    await env.DB.prepare('INSERT INTO sessions (token_hash, csrf_token, expires_at) VALUES (?, ?, ?)')
      .bind(await tokenHash(token, env.TRAVEL_SESSION_SECRET), csrf, expiresAt).run();
    return json({ authenticated: true, csrfToken: csrf, expiresAt }, 200, {
      'set-cookie': sessionCookie(request, token, SESSION_SECONDS)
    });
  }
  if (path === '/api/auth/logout' && request.method === 'POST') {
    const auth = await requireMutationAuth(request, env);
    if (auth instanceof Response) return auth;
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(auth.token_hash).run();
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(request, '', 0) });
  }
  return error('NOT_FOUND', 404);
}

async function handlePins(request: Request, env: Env, ctx: ExecutionContext, path: string): Promise<Response> {
  const id = path.match(/^\/api\/pins\/([^/]+)$/)?.[1];
  if (request.method === 'GET' && !id) {
    const [pins, stats] = await Promise.all([listPins(env), pinStats(env)]);
    return json({ pins, stats }, 200, { 'cache-control': 'public, max-age=20, stale-while-revalidate=120' });
  }
  if (request.method === 'GET' && id) {
    const pin = await getPin(env, decodeURIComponent(id));
    return pin ? json(pin, 200, { 'cache-control': 'public, max-age=30, stale-while-revalidate=120' }) : error('PIN_NOT_FOUND', 404);
  }
  const auth = await requireMutationAuth(request, env);
  if (auth instanceof Response) return auth;

  const restoreId = path.match(/^\/api\/pins\/([^/]+)\/restore$/)?.[1];
  if (request.method === 'POST' && restoreId) {
    const pinId = decodeURIComponent(restoreId);
    const cutoff = new Date(Date.now() - SESSION_SECONDS * 1000).toISOString();
    const result = await env.DB.prepare("UPDATE pins SET deleted_at=NULL, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND deleted_at > ?").bind(pinId, cutoff).run();
    return result.meta.changes ? json(await getPin(env, pinId)) : error('PIN_NOT_RECOVERABLE', 404);
  }

  if (request.method === 'POST' && !id) {
    const value = validatePayload(await boundedJson<PinPayload>(request));
    requireLocation(value);
    await requireKnownRegion(env, value.regionId!, value.countryCode!);
    const pinId = `pin_${crypto.randomUUID().replaceAll('-', '')}`;
    await env.DB.prepare(`INSERT INTO pins
      (id,title,lat,lng,place_name,place_names,region_id,country_code,event_date,color,content,photo_style,cover_media_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(pinId, value.title, value.lat, value.lng, value.placeName, value.placeNames, value.regionId, value.countryCode, value.eventDate, value.color, value.content, value.photoStyle, value.coverMediaId).run();
    await replaceMedia(env, pinId, value.media);
    ctx.waitUntil(ensureCountryBuild(env, value.countryCode!).catch((caught: unknown) => {
      console.error(JSON.stringify({ event: 'country_build_dispatch_error', countryCode: value.countryCode, error: caught instanceof Error ? caught.message : 'UNKNOWN' }));
    }));
    return json(await getPin(env, pinId), 201);
  }
  if (request.method === 'PUT' && id) {
    const pinId = decodeURIComponent(id);
    if (!(await getPin(env, pinId))) return error('PIN_NOT_FOUND', 404);
    const value = validatePayload(await boundedJson<PinPayload>(request));
    requireLocation(value);
    await requireKnownRegion(env, value.regionId!, value.countryCode!);
    await env.DB.prepare(`UPDATE pins SET title=?,lat=?,lng=?,place_name=?,place_names=?,region_id=?,country_code=?,event_date=?,color=?,content=?,photo_style=?,cover_media_id=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND deleted_at IS NULL`)
      .bind(value.title, value.lat, value.lng, value.placeName, value.placeNames, value.regionId, value.countryCode, value.eventDate, value.color, value.content, value.photoStyle, value.coverMediaId, pinId).run();
    await replaceMedia(env, pinId, value.media);
    ctx.waitUntil(ensureCountryBuild(env, value.countryCode!).catch((caught: unknown) => {
      console.error(JSON.stringify({ event: 'country_build_dispatch_error', countryCode: value.countryCode, error: caught instanceof Error ? caught.message : 'UNKNOWN' }));
    }));
    return json(await getPin(env, pinId));
  }
  if (request.method === 'DELETE' && id) {
    const payload = await boundedJson<{ confirm?: unknown }>(request, 10_000);
    if (payload.confirm !== true) return error('CONFIRMATION_REQUIRED', 400);
    const pinId = decodeURIComponent(id);
    const result = await env.DB.prepare("UPDATE pins SET deleted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND deleted_at IS NULL").bind(pinId).run();
    return result.meta.changes ? json({ ok: true, recoverableDays: 30 }) : error('PIN_NOT_FOUND', 404);
  }
  return error('METHOD_NOT_ALLOWED', 405);
}

async function handleMedia(request: Request, env: Env, path: string): Promise<Response> {
  if (request.method === 'POST' && path === '/api/media') {
    const auth = await requireMutationAuth(request, env);
    if (auth instanceof Response) return auth;
    const size = Number(request.headers.get('content-length') || 0);
    if (size > 30_000_000) return error('MEDIA_TOO_LARGE', 413);
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || !file.size || file.size > 25_000_000) return error('INVALID_MEDIA', 400);
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) return error('UNSUPPORTED_MEDIA', 415);
    const id = `media_${crypto.randomUUID().replaceAll('-', '')}`;
    const cleanName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-120) || 'upload';
    const now = new Date();
    const key = `travel/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}/${cleanName}`;
    await env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' }, customMetadata: { mediaId: id, source: 'travel' } });
    await env.DB.prepare('INSERT INTO media_assets (id, object_key, filename, content_type, size) VALUES (?, ?, ?, ?, ?)').bind(id, key, file.name.slice(0, 240), file.type, file.size).run();
    return json({ id, url: mediaUrl(id), filename: file.name, content_type: file.type, size: file.size, sort_order: 0 }, 201);
  }
  const id = path.match(/^\/media\/(media_[a-f0-9]{32})$/)?.[1];
  if (request.method === 'GET' && id) {
    const media = await env.DB.prepare('SELECT object_key, content_type FROM media_assets WHERE id = ?').bind(id).first<{ object_key: string; content_type: string }>();
    if (!media) return new Response('Not found', { status: 404 });
    const object = await env.MEDIA.get(media.object_key);
    if (!object) return new Response('Not found', { status: 404 });
    const headers = responseHeaders();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('cache-control', 'public, max-age=31536000, immutable');
    return new Response(object.body, { headers });
  }
  return error('NOT_FOUND', 404);
}

const PI = Math.PI;
const A = 6378245;
const EE = 0.006693421622965943;
function outsideChina(lng: number, lat: number): boolean { return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271; }
function transformLat(x: number, y: number): number { return -100 + 2*x + 3*y + .2*y*y + .1*x*y + .2*Math.sqrt(Math.abs(x)) + (20*Math.sin(6*x*PI)+20*Math.sin(2*x*PI))*2/3 + (20*Math.sin(y*PI)+40*Math.sin(y/3*PI))*2/3 + (160*Math.sin(y/12*PI)+320*Math.sin(y*PI/30))*2/3; }
function transformLng(x: number, y: number): number { return 300 + x + 2*y + .1*x*x + .1*x*y + .1*Math.sqrt(Math.abs(x)) + (20*Math.sin(6*x*PI)+20*Math.sin(2*x*PI))*2/3 + (20*Math.sin(x*PI)+40*Math.sin(x/3*PI))*2/3 + (150*Math.sin(x/12*PI)+300*Math.sin(x/30*PI))*2/3; }
function gcjToWgs(lng: number, lat: number): [number, number] {
  if (outsideChina(lng, lat)) return [lng, lat];
  let dLat = transformLat(lng - 105, lat - 35);
  let dLng = transformLng(lng - 105, lat - 35);
  const radLat = lat / 180 * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = dLat * 180 / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
  dLng = dLng * 180 / (A / sqrtMagic * Math.cos(radLat) * PI);
  return [lng * 2 - (lng + dLng), lat * 2 - (lat + dLat)];
}

function normalizeRegion(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 160) || 'unknown';
}

interface CatalogRegion {
  id: string;
  name: string;
  countryCode: string;
  sourceId: string;
  bbox: [number, number, number, number];
  centroid: [number, number];
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] };
}

type CatalogRegionSummary = Omit<CatalogRegion, 'geometry'>;

function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const [currentLng, currentLat] = ring[current];
    const [previousLng, previousLat] = ring[previous];
    const intersects = (currentLat > lat) !== (previousLat > lat)
      && lng < ((previousLng - currentLng) * (lat - currentLat)) / ((previousLat - currentLat) || Number.EPSILON) + currentLng;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lng: number, lat: number, polygon: number[][][]): boolean {
  if (!polygon.length || !pointInRing(lng, lat, polygon[0])) return false;
  return !polygon.slice(1).some((hole) => pointInRing(lng, lat, hole));
}

function regionContains(region: CatalogRegion, lng: number, lat: number): boolean {
  const [west, south, east, north] = region.bbox;
  if (lng < west || lng > east || lat < south || lat > north) return false;
  if (region.geometry.type === 'Polygon') return pointInPolygon(lng, lat, region.geometry.coordinates as number[][][]);
  return (region.geometry.coordinates as number[][][][]).some((polygon) => pointInPolygon(lng, lat, polygon));
}

async function readRegionCell(env: Env, countryCode: string, x: number, y: number): Promise<CatalogRegionSummary[]> {
  const object = await env.TRAVEL_TILES.get(`v2/regions/${countryCode}/${x}/${y}.json.gz`);
  if (!object) return [];
  const stream = object.body.pipeThrough(new DecompressionStream('gzip'));
  const payload = await new Response(stream).json() as { regions?: CatalogRegionSummary[] };
  return payload.regions || [];
}

async function readCountryCatalog(env: Env, countryCode: string): Promise<CatalogRegion[]> {
  const object = await env.TRAVEL_TILES.get(`v2/regions/${countryCode}/catalog.json.gz`);
  if (!object) return [];
  const stream = object.body.pipeThrough(new DecompressionStream('gzip'));
  const payload = await new Response(stream).json() as { regions?: CatalogRegion[] };
  return payload.regions || [];
}

async function catalogRegionAt(env: Env, countryCode: string, lng: number, lat: number): Promise<CatalogRegion | null> {
  const cellX = Math.floor((lng + 180) / 4);
  const cellY = Math.floor((lat + 90) / 4);
  let summaries = await readRegionCell(env, countryCode, cellX, cellY);
  let candidates = summaries.filter((region) => lng >= region.bbox[0] && lng <= region.bbox[2] && lat >= region.bbox[1] && lat <= region.bbox[3]);
  if (!candidates.length) {
    const adjacent = await Promise.all([
      [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]
    ].map(([dx, dy]) => readRegionCell(env, countryCode, cellX + dx, cellY + dy)));
    summaries = adjacent.flat();
    candidates = summaries.filter((region) => lng >= region.bbox[0] && lng <= region.bbox[2] && lat >= region.bbox[1] && lat <= region.bbox[3]);
  }
  if (!candidates.length) return null;
  const candidateIds = new Set(candidates.map((region) => region.id));
  const containing = (await readCountryCatalog(env, countryCode)).filter((region) => candidateIds.has(region.id) && regionContains(region, lng, lat));
  return containing.sort((left, right) => {
    const leftArea = (left.bbox[2] - left.bbox[0]) * (left.bbox[3] - left.bbox[1]);
    const rightArea = (right.bbox[2] - right.bbox[0]) * (right.bbox[3] - right.bbox[1]);
    return leftArea - rightArea;
  })[0] || null;
}

async function resolveCandidateRegion(candidate: Candidate, lang: 'zh' | 'en', env: Env): Promise<Candidate | null> {
  const region = await catalogRegionAt(env, candidate.countryCode, candidate.lng, candidate.lat);
  if (!region) return null;
  const nameZh = lang === 'zh' ? candidate.regionName || region.name : null;
  const nameEn = lang === 'en' ? candidate.regionName || region.name : region.name;
  await env.DB.prepare(`INSERT INTO regions
    (region_id,country_code,name_en,name_zh,parent_name_en,parent_name_zh,centroid_lat,centroid_lng,source_id)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(region_id) DO UPDATE SET
      name_en=excluded.name_en,
      name_zh=COALESCE(excluded.name_zh,regions.name_zh),
      parent_name_en=COALESCE(excluded.parent_name_en,regions.parent_name_en),
      parent_name_zh=COALESCE(excluded.parent_name_zh,regions.parent_name_zh),
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
    .bind(region.id, candidate.countryCode, nameEn, nameZh, lang === 'en' ? candidate.regionName : null, lang === 'zh' ? candidate.regionName : null, region.centroid[1], region.centroid[0], region.sourceId)
    .run();
  return { ...candidate, regionId: region.id, regionName: candidate.regionName || region.name };
}

async function amapSearch(query: string, lang: string, env: Env): Promise<Candidate[]> {
  const url = new URL('https://restapi.amap.com/v3/place/text');
  url.search = new URLSearchParams({ key: env.AMAP_PLACE_API_KEY, keywords: query, offset: '5', page: '1', extensions: 'all', citylimit: 'false' }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(4500) });
  if (!response.ok) throw new Error('AMAP_HTTP');
  const payload = await response.json() as { status?: string; pois?: Array<Record<string, unknown>> };
  if (payload.status !== '1') throw new Error('AMAP_ERROR');
  return (payload.pois || []).flatMap((poi): Candidate[] => {
    const location = typeof poi.location === 'string' ? poi.location.split(',').map(Number) : [];
    if (location.length !== 2 || !location.every(Number.isFinite)) return [];
    const [lng, lat] = gcjToWgs(location[0], location[1]);
    const city = String(poi.cityname || poi.pname || '');
    const district = String(poi.adname || '');
    const regionName = [city, district].filter(Boolean).join(' · ');
    return [{ id: `amap-${String(poi.id || `${lng},${lat}`)}`, name: String(poi.name || query), address: [regionName, String(poi.address || '')].filter(Boolean).join(' · '), lat, lng, regionId: '', regionName, countryCode: 'CN', pinCount: 0, provider: 'Amap' }];
  });
}

async function googleSearch(query: string, lang: string, env: Env): Promise<Candidate[]> {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.search = new URLSearchParams({ address: query, language: lang === 'zh' ? 'zh-CN' : 'en', key: env.GOOGLE_PLACES_API_KEY }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('GOOGLE_HTTP');
  const payload = await response.json() as { status?: string; results?: Array<Record<string, unknown>> };
  if (payload.status !== 'OK' && payload.status !== 'ZERO_RESULTS') throw new Error('GOOGLE_ERROR');
  return (payload.results || []).slice(0, 5).flatMap((result): Candidate[] => {
    const geometry = result.geometry as { location?: { lat?: number; lng?: number } } | undefined;
    const lat = geometry?.location?.lat;
    const lng = geometry?.location?.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    const components = (result.address_components || []) as Array<{ long_name?: string; short_name?: string; types?: string[] }>;
    const locality = components.find((item) => item.types?.some((type) => ['locality', 'administrative_area_level_2'].includes(type)))?.long_name || '';
    const countryComponent = components.find((item) => item.types?.includes('country'));
    const country = countryComponent?.long_name || '';
    const countryCode = String(countryComponent?.short_name || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(countryCode)) return [];
    const regionName = [locality, country].filter(Boolean).join(' · ');
    const name = components.find((item) => item.types?.some((type) => ['point_of_interest', 'establishment'].includes(type)))?.long_name || String(result.formatted_address || query).split(',')[0];
    return [{ id: `google-${String(result.place_id || `${lng},${lat}`)}`, name, address: String(result.formatted_address || regionName), lat: Number(lat), lng: Number(lng), regionId: '', regionName, countryCode, pinCount: 0, provider: 'Google' }];
  });
}

async function searchPlaces(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') || '').normalize('NFKC').trim().slice(0, 120);
  const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'zh';
  if (query.length < 2) return error('QUERY_TOO_SHORT', 400);
  const ipHash = await digest(`${env.TRAVEL_SESSION_SECRET}:${request.headers.get('cf-connecting-ip') || 'unknown'}`);
  const minute = new Date().toISOString().slice(0, 16);
  const limit = await env.DB.prepare(`INSERT INTO search_limits (client_hash, window_start, request_count) VALUES (?, ?, 1)
    ON CONFLICT(client_hash,window_start) DO UPDATE SET request_count=request_count+1 RETURNING request_count`).bind(ipHash, minute).first<{ request_count: number }>();
  if ((limit?.request_count || 0) > 30) return error('RATE_LIMITED', 429);

  const cacheKey = await digest(`v2:${lang}:${query.toLowerCase()}`);
  const cached = await env.DB.prepare('SELECT payload FROM search_cache WHERE cache_key = ? AND expires_at > ?').bind(cacheKey, new Date().toISOString()).first<{ payload: string }>();
  if (cached) return json(JSON.parse(cached.payload), 200, { 'cache-control': 'public, max-age=300' });

  const likelyChina = /[\u3400-\u9fff]/u.test(query);
  let candidates: Candidate[] = [];
  try { candidates = likelyChina ? await amapSearch(query, lang, env) : await googleSearch(query, lang, env); } catch { candidates = []; }
  if (!candidates.length) {
    try { candidates = likelyChina ? await googleSearch(query, lang, env) : await amapSearch(query, lang, env); } catch { candidates = []; }
  }
  const resolved = (await Promise.all(candidates.map((candidate) => resolveCandidateRegion(candidate, lang, env)))).filter((candidate): candidate is Candidate => Boolean(candidate));
  const unique = [...new Map(resolved.map((item) => [`${normalizeRegion(item.name)}:${item.lat.toFixed(4)}:${item.lng.toFixed(4)}`, item])).values()].slice(0, 5);
  if (unique.length) {
    const counts = await env.DB.batch(unique.map((item) => env.DB.prepare('SELECT count(*) AS count FROM pins WHERE region_id = ? AND deleted_at IS NULL').bind(item.regionId)));
    unique.forEach((item, index) => { item.pinCount = Number((counts[index].results[0] as { count?: number } | undefined)?.count || 0); });
  }
  const payload = { candidates: unique };
  await env.DB.prepare(`INSERT INTO search_cache (cache_key,payload,expires_at) VALUES (?,?,?)
    ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at,created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
    .bind(cacheKey, JSON.stringify(payload), isoAfter(7 * 24 * 60 * 60)).run();
  return json(payload, 200, { 'cache-control': 'public, max-age=300' });
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function escapeJson(value: unknown): string { return JSON.stringify(value).replaceAll('<', '\\u003c'); }

async function shellResponse(request: Request, env: Env, mode: 'root' | 'manage' | 'pin', pin?: Record<string, unknown> | null): Promise<Response> {
  const assetPath = mode === 'manage' ? '/manage/index.html' : '/index.html';
  const asset = await env.ASSETS.fetch(new Request(new URL(assetPath, request.url)));
  if (!asset.ok) return new Response('Application shell unavailable', { status: 503 });
  let html = await asset.text();
  let status = 200;
  const pins = mode === 'root' ? await listPins(env) : [];
  let head = '';
  if (mode === 'pin') {
    if (!pin) {
      status = 404;
      head = '<meta name="robots" content="noindex"><title>Pin not found · Travel Map</title>';
    } else {
      const title = escapeHtml(String(pin.title || 'Travel Map'));
      const content = String(pin.content || '').replace(/[#*_`>\[\]()]/g, '').replace(/\s+/g, ' ').trim();
      const description = escapeHtml(content.slice(0, 180) || String(pin.place_name || 'A note on the travel map.'));
      const canonical = `${env.APP_ORIGIN}/p/${encodeURIComponent(String(pin.id))}`;
      const media = Array.isArray(pin.media) ? pin.media as Array<{ id?: string; content_type?: string }> : [];
      const coverId = String(pin.cover_media_id || media[0]?.id || '');
      const image = coverId && !media.find((item) => item.id === coverId)?.content_type?.startsWith('video/') ? `${env.APP_ORIGIN}${mediaUrl(coverId)}` : `${env.APP_ORIGIN}/maps/world-parchment-v1.webp`;
      head = `<meta name="description" content="${description}"><meta property="og:type" content="article"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${image}"><link rel="canonical" href="${canonical}"><title>${title} · Travel Map</title>`;
    }
  }
  const links = pins.length ? `<h2>Map notes</h2><ul>${pins.map((item) => `<li><a href="/p/${encodeURIComponent(String(item.id))}">${escapeHtml(String(item.title))}</a></li>`).join('')}</ul>` : '';
  const initial = mode === 'pin' && pin ? { pin } : mode === 'root' ? { pins } : {};
  if (mode === 'pin') {
    html = html
      .replace(/<meta name="description"[^>]*>/, '')
      .replace(/<meta name="robots"[^>]*>/, '')
      .replace(/<link rel="canonical"[^>]*>/, '')
      .replace(/<meta property="og:(?:type|title|description|url|image)"[^>]*>/g, '')
      .replace(/<title>[^<]*<\/title>/, '');
  }
  html = html.replace('<!--TRAVEL_HEAD-->', head)
    .replace('<!--TRAVEL_PIN_LINKS-->', links)
    .replace('<!--TRAVEL_INITIAL_DATA-->', `<script>window.__TRAVEL_INITIAL__=${escapeJson(initial)}</script>`);
  const headers = responseHeaders({
    'content-type': 'text/html; charset=utf-8',
    'cache-control': mode === 'manage' ? 'no-store' : 'public, max-age=30, stale-while-revalidate=120',
    'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
  });
  if (mode === 'manage') headers.set('x-robots-tag', 'noindex, nofollow');
  return new Response(html, { status, headers });
}

async function serveTile(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/tiles\/(v[\w.-]+)\/([\w./-]+)$/);
  if (!match) return new Response('Not found', { status: 404 });
  if (match[2].includes('..')) return new Response('Not found', { status: 404 });
  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  const rangeHeader = request.headers.get('range');
  const object = await env.TRAVEL_TILES.get(`${match[1]}/${match[2]}`, rangeHeader ? { range: request.headers } : undefined);
  if (!object) return env.ASSETS.fetch(request);
  const contentType = match[2].endsWith('.webp') ? 'image/webp'
    : match[2].endsWith('.mvt') ? 'application/vnd.mapbox-vector-tile'
      : match[2].endsWith('.pmtiles') ? 'application/octet-stream'
        : 'application/json';
  const headers = responseHeaders({
    'content-type': contentType,
    'cache-control': match[2].endsWith('manifest.json') ? 'public, max-age=60, stale-while-revalidate=300' : 'public, max-age=31536000, immutable',
    etag: object.httpEtag,
    'accept-ranges': 'bytes'
  });
  let status = 200;
  if (rangeHeader) {
    const explicit = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
    const suffix = rangeHeader.match(/^bytes=-(\d+)$/);
    const offset = explicit ? Number(explicit[1]) : suffix ? Math.max(0, object.size - Number(suffix[1])) : 0;
    const requestedEnd = explicit?.[2] ? Number(explicit[2]) : object.size - 1;
    const end = Math.min(object.size - 1, requestedEnd);
    const length = Math.max(0, end - offset + 1);
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set('content-length', String(length));
    status = 206;
  }
  const response = new Response(object.body, { status, headers });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

async function sitemap(env: Env): Promise<Response> {
  const rows = await env.DB.prepare('SELECT id, updated_at FROM pins WHERE deleted_at IS NULL ORDER BY updated_at DESC').all<{ id: string; updated_at: string }>();
  const urls = [`<url><loc>${env.APP_ORIGIN}/</loc><changefreq>weekly</changefreq></url>`, ...rows.results.map((pin) => `<url><loc>${env.APP_ORIGIN}/p/${encodeURIComponent(pin.id)}</loc><lastmod>${escapeHtml(pin.updated_at)}</lastmod></url>`)].join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, { headers: responseHeaders({ 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=300' }) });
}

async function scheduledBackup(env: Env): Promise<void> {
  const [pins, pinMedia, mediaAssets] = await Promise.all([
    env.DB.prepare('SELECT * FROM pins').all(),
    env.DB.prepare('SELECT * FROM pin_media').all(),
    env.DB.prepare('SELECT * FROM media_assets').all()
  ]);
  const day = new Date().toISOString().slice(0, 10);
  const stream = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), pins: pins.results, pinMedia: pinMedia.results, mediaAssets: mediaAssets.results })]).stream().pipeThrough(new CompressionStream('gzip'));
  const compressed = await new Response(stream).arrayBuffer();
  await env.BACKUPS.put(`daily/${day}.json.gz`, compressed, { httpMetadata: { contentType: 'application/gzip' } });
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let cursor: string | undefined;
  do {
    const listed = await env.BACKUPS.list({ prefix: 'daily/', cursor });
    const expired = listed.objects.filter((object) => object.key.slice(6, 16) < cutoff).map((object) => object.key);
    if (expired.length) await env.BACKUPS.delete(expired);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  const deletedCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM pins WHERE deleted_at IS NOT NULL AND deleted_at < ?').bind(deletedCutoff),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(new Date().toISOString()),
    env.DB.prepare('DELETE FROM search_cache WHERE expires_at < ?').bind(new Date().toISOString()),
    env.DB.prepare("DELETE FROM search_limits WHERE window_start < strftime('%Y-%m-%dT%H:%M', 'now', '-2 days')")
  ]);
}

async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  try {
    if (request.method === 'GET' && path === '/') return shellResponse(request, env, 'root');
    if (request.method === 'GET' && path === '/manage') return shellResponse(request, env, 'manage');
    if (request.method === 'GET' && path.startsWith('/p/')) return shellResponse(request, env, 'pin', await getPin(env, decodeURIComponent(path.slice(3))));
    if (request.method === 'GET' && path === '/robots.txt') return new Response(`User-agent: *\nAllow: /\nDisallow: /manage\nDisallow: /api/\nSitemap: ${env.APP_ORIGIN}/sitemap.xml\n`, { headers: responseHeaders({ 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' }) });
    if (request.method === 'GET' && path === '/sitemap.xml') return sitemap(env);
    if (request.method === 'GET' && path.startsWith('/tiles/')) return serveTile(request, env, ctx);
    if (path === '/api/internal/country-build/callback') return handleCountryBuildCallback(request, env);
    if (path.startsWith('/api/auth/')) return handleAuth(request, env, path);
    if (path === '/api/countries' && request.method === 'GET') return json({ countries: await listReadyCountries(env) }, 200, { 'cache-control': 'public, max-age=60, stale-while-revalidate=300' });
    if (path === '/api/search/places' && request.method === 'GET') return searchPlaces(request, env);
    if (path === '/api/media' || path.startsWith('/media/')) return handleMedia(request, env, path);
    if (path === '/api/pins' || path.startsWith('/api/pins/')) return handlePins(request, env, ctx, path);
    if (path.startsWith('/api/')) return error('NOT_FOUND', 404);
    return env.ASSETS.fetch(request);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'UNKNOWN';
    console.error(JSON.stringify({ event: 'request_error', path, method: request.method, error: message }));
    if (message === 'PAYLOAD_TOO_LARGE') return error(message, 413);
    if (message.startsWith('INVALID_') || message === 'MEDIA_NOT_FOUND') return error(message, 400);
    return error('INTERNAL_ERROR', 500);
  }
}

export default {
  fetch(request, env, ctx) { return handleRequest(request, env, ctx); },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(scheduledBackup(env).catch((caught: unknown) => {
      console.error(JSON.stringify({ event: 'backup_error', error: caught instanceof Error ? caught.message : 'UNKNOWN' }));
      throw caught;
    }));
  }
} satisfies ExportedHandler<Env>;
