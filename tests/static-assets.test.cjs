const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const http = require('node:http');

test('hashed assets negotiate compression, validate ETag and remain cacheable without caching private APIs', async () => {
  const { registerBuiltAssets } = require('../dist/web/static-assets');
  const app = express();
  registerBuiltAssets(app, path.resolve('dist/web/public'));
  app.get('/api/private', (_req, res) => res.set('Cache-Control', 'no-store').json({ private: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const manifest = JSON.parse(fs.readFileSync('dist/web/public/asset-manifest.json'));
    const resource = Object.keys(manifest).find(key => key.endsWith('.js'));
    const gzip = await fetch(base + resource, { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(gzip.headers.get('content-encoding'), 'gzip');
    assert.match(gzip.headers.get('cache-control'), /immutable/);
    assert.match(gzip.headers.get('vary'), /Accept-Encoding/);
    assert.equal(await gzip.text(), fs.readFileSync(path.join('dist/web/public', resource), 'utf8'));
    // Native fetch adds Cache-Control:no-cache to manual validators; exercise
    // a real browser conditional request without that reload directive.
    const status = await new Promise((resolve, reject) => {
      http.get(base + resource, { headers: { 'accept-encoding': 'gzip', 'if-none-match': gzip.headers.get('etag') } }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      }).on('error', reject);
    });
    assert.equal(status, 304);
    const identity = await fetch(base + resource, { headers: { 'accept-encoding': 'gzip;q=0, br;q=0, identity;q=1' } });
    assert.equal(identity.headers.get('content-encoding'), null);
    assert.equal((await identity.text()).length > 0, true);
    const brotli = await fetch(base + resource, { headers: { 'accept-encoding': 'br' } });
    assert.equal(brotli.headers.get('content-encoding'), 'br');
    assert.equal((await brotli.text()).length > 0, true);
    const privateApi = await fetch(base + '/api/private');
    assert.equal(privateApi.headers.get('cache-control'), 'no-store');
    const head = await fetch(base + resource, { method: 'HEAD', headers: { 'accept-encoding': 'br' } });
    assert.equal(head.status, 200);
    assert.equal((await head.text()).length, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
