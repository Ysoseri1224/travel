import { cp, mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const publicDir = new URL('../public/', import.meta.url);
await mkdir(new URL('maps/', publicDir), { recursive: true });
await mkdir(new URL('paper-props/v1/', publicDir), { recursive: true });
await mkdir(new URL('pins/v1/', publicDir), { recursive: true });
await rm(new URL('tiles/v2/', publicDir), { recursive: true, force: true });

await Promise.all([
  cp(new URL('previews/world-parchment-v1.webp', root), new URL('maps/world-parchment-v1.webp', publicDir)),
  cp(new URL('previews/china-prefecture-v1.webp', root), new URL('maps/china-prefecture-v1.webp', publicDir)),
  cp(new URL('previews/new-zealand-territorial-v1.webp', root), new URL('maps/new-zealand-territorial-v1.webp', publicDir)),
  cp(new URL('assets/paper-props/v1/', root), new URL('paper-props/v1/', publicDir), { recursive: true }),
  cp(new URL('assets/pins/v1/', root), new URL('pins/v1/', publicDir), { recursive: true })
]);

await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('render-tiles.mjs', import.meta.url))], { stdio: 'inherit' });
  child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`tile renderer exited with ${code}`)));
  child.once('error', reject);
});
