import { createHmac } from 'node:crypto';

const required = ['COUNTRY_CODE', 'COUNTRY_JOB_ID', 'COUNTRY_PACKAGE_VERSION', 'TRAVEL_CALLBACK_URL', 'TRAVEL_BUILD_CALLBACK_SECRET', 'BUILD_STATUS'];
for (const name of required) if (!process.env[name]) throw new Error(`${name} is required`);

const ready = process.env.BUILD_STATUS === 'success';
const body = JSON.stringify({
  jobId: process.env.COUNTRY_JOB_ID,
  countryCode: process.env.COUNTRY_CODE.toUpperCase(),
  status: ready ? 'ready' : 'failed',
  packageVersion: ready ? process.env.COUNTRY_PACKAGE_VERSION : null,
  manifestKey: ready ? `v3/countries/${process.env.COUNTRY_CODE.toUpperCase()}/manifest.json` : null,
  githubRunId: process.env.GITHUB_RUN_ID || null,
  error: ready ? null : `GitHub Actions run ${process.env.GITHUB_RUN_ID || 'unknown'} failed`
});
const signature = createHmac('sha256', process.env.TRAVEL_BUILD_CALLBACK_SECRET).update(body).digest('hex');
const response = await fetch(process.env.TRAVEL_CALLBACK_URL, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-country-build-signature': `sha256=${signature}` },
  body
});
if (!response.ok) throw new Error(`Callback failed: ${response.status} ${await response.text()}`);
console.log(`callback accepted for ${process.env.COUNTRY_CODE}: ${ready ? 'ready' : 'failed'}`);
