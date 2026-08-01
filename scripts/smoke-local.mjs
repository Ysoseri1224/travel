import { readFile } from 'node:fs/promises';

const base = process.env.TRAVEL_SMOKE_ORIGIN || 'http://127.0.0.1:8791';
const vars = Object.fromEntries((await readFile(new URL('../.dev.vars', import.meta.url), 'utf8'))
  .split(/\r?\n/).filter(Boolean).map((line) => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)];
  }));

async function expect(response, status = 200) {
  if (response.status !== status) throw new Error(`${response.url}: expected ${status}, received ${response.status}: ${await response.text()}`);
  return response;
}

const login = await expect(await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { origin: base, 'content-type': 'application/json' },
  body: JSON.stringify({ password: vars.TRAVEL_PASSWORD })
}));
const cookie = login.headers.get('set-cookie')?.split(';')[0];
const auth = await login.json();
if (!cookie || !auth.authenticated || !auth.csrfToken) throw new Error('login did not return a complete session');
const headers = { origin: base, cookie, 'x-csrf-token': auth.csrfToken };

const created = await expect(await fetch(`${base}/api/pins`, {
  method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify({ title: 'Temporary local acceptance pin', lat: -36.8485, lng: 174.7633, place_name: 'Auckland', region_id: 'global-auckland', event_date: '2026-08-01', color: '#c85f3c', content: 'Local **Markdown** check.', media: [] })
}), 201);
const pin = await created.json();

const mediaForm = new FormData();
const image = await readFile(new URL('../option1.png', import.meta.url));
mediaForm.set('file', new File([image], 'local-acceptance.png', { type: 'image/png' }));
const uploadedResponse = await expect(await fetch(`${base}/api/media`, { method: 'POST', headers, body: mediaForm }), 201);
const media = await uploadedResponse.json();
const served = await expect(await fetch(`${base}${media.url}`));

const updatedResponse = await expect(await fetch(`${base}/api/pins/${pin.id}`, {
  method: 'PUT', headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify({ ...pin, title: 'Temporary updated pin', color: '#47756f', event_date: null, photo_style: 'photo-classic', cover_media_id: media.id, media: [{ media_id: media.id, sort_order: 0 }] })
}));
const updated = await updatedResponse.json();
const ssr = await expect(await fetch(`${base}/p/${pin.id}`));
const ssrHtml = await ssr.text();
await expect(await fetch(`${base}/api/pins/${pin.id}`, { method: 'DELETE', headers: { ...headers, 'content-type': 'application/json' }, body: '{"confirm":true}' }));
await expect(await fetch(`${base}/api/pins/${pin.id}`), 404);
const restoredResponse = await expect(await fetch(`${base}/api/pins/${pin.id}/restore`, { method: 'POST', headers }));
const restored = await restoredResponse.json();
await expect(await fetch(`${base}/api/pins/${pin.id}`, { method: 'DELETE', headers: { ...headers, 'content-type': 'application/json' }, body: '{"confirm":true}' }));

console.log(JSON.stringify({
  login: auth.authenticated,
  pinCreated: pin.id.startsWith('pin_'),
  mediaCreated: media.id.startsWith('media_'),
  mediaType: served.headers.get('content-type'),
  update: updated.title === 'Temporary updated pin',
  ssrCanonical: ssrHtml.includes(`https://travel.ysoseri.us/p/${pin.id}`),
  restored: restored.id === pin.id
}, null, 2));
