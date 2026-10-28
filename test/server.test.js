import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHandler, normalizeHandle, normalizeProviderResult } from '../server.js';

async function withServer(options, callback) {
  const server = http.createServer(createHandler(options));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try { await callback(url); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}
const postCheck = (url, username, headers = {}) => fetch(`${url}/api/check`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify({ username })
});

test('accepts handles and profile URLs, rejects other inputs', () => {
  assert.equal(normalizeHandle('@hello_world'), 'hello_world');
  assert.equal(normalizeHandle('https://x.com/SomeUser'), 'SomeUser');
  assert.equal(normalizeHandle('twitter.com/example/'), 'example');
  assert.equal(normalizeHandle('https://x.com/example?lang=en'), 'example');
  for (const bad of ['https://evil.com/user', 'example/status/123', 'a'.repeat(16), '@@bad', '', 'https://x.com/a/other']) {
    assert.equal(normalizeHandle(bad), null, bad);
  }
});

test('normalizes measured results without claiming unknown status as clean', () => {
  const result = normalizeProviderResult({
    checks: {
      search_ban: { status: 'banned', reason: 'Missing from search.' },
      search_suggestion_ban: { status: 'unknown', reason: 'No autocomplete data.' }
    },
    protected: false,
    checked_at: '2026-10-28T11:00:00Z'
  }, 'someone');
  assert.equal(result.checks.search.status, 'banned');
  assert.equal(result.checks.suggestion.status, 'unknown');
  assert.equal(result.account.protected, false);
  assert.equal(result.checkedAt, '2026-10-28T11:00:00.000Z');
  const privateResult = normalizeProviderResult({ checks: { search_ban: { status: 'banned' }, search_suggestion_ban: { status: 'clean' } }, protected: true }, 'someone');
  assert.equal(privateResult.checks.search.status, 'unknown');
  assert.equal(privateResult.checks.suggestion.status, 'unknown');
});

test('guided mode serves files and refuses automatic claims without key', async () => {
  await withServer({ apiKey: '' }, async (base) => {
    const config = await (await fetch(base + '/api/config')).json();
    assert.deepEqual(config, { automatic: false, guided: true });
    const html = await fetch(base + '/');
    assert.equal(html.status, 200);
    assert.match(await html.text(), /Is X hiding/);
    assert.match(html.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal((await postCheck(base, 'user')).status, 503);
    assert.equal((await fetch(base + '/server.js')).status, 404);
    assert.equal((await fetch(base + '/health')).status, 200);
  });
});

test('automatic mode uses server-held provider key, normalizes response, and caches handle', async () => {
  let callCount = 0;
  const fetcher = async (url, options) => {
    callCount++;
    assert.equal(new URL(url).hostname, 'api.sorsa.io');
    assert.equal(new URL(url).searchParams.get('username'), 'Alice');
    assert.equal(options.headers.ApiKey, 'SECRET_TEST_KEY');
    return new Response(JSON.stringify({ checks: {
      search_ban: { status: 'clean', reason: 'Indexed' },
      search_suggestion_ban: { status: 'banned', reason: 'Missing' }
    } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  await withServer({ apiKey: 'SECRET_TEST_KEY', fetcher }, async (base) => {
    const config = await (await fetch(base + '/api/config')).json();
    assert.equal(config.automatic, true);
    const first = await postCheck(base, '@Alice');
    assert.equal(first.status, 200);
    const data = await first.json();
    assert.equal(data.checks.search.status, 'clean');
    assert.equal(data.checks.suggestion.status, 'banned');
    assert.equal(data.cached, false);
    assert.equal(JSON.stringify(data).includes('SECRET_TEST_KEY'), false);
    const second = await (await postCheck(base, 'alice')).json();
    assert.equal(second.cached, true);
    assert.equal(callCount, 1);
  });
});

test('bad inputs, provider errors, and request throttling are handled', async () => {
  const fetcher = async () => new Response('slow down', { status: 429 });
  await withServer({ apiKey: 'test', fetcher }, async (base) => {
    assert.equal((await postCheck(base, 'invalid$')).status, 400);
    assert.equal((await postCheck(base, 'valid')).status, 429);
    let last;
    for (let n = 0; n < 12; n++) last = await postCheck(base, 'valid');
    assert.equal(last.status, 429);
    assert.match((await last.json()).error, /Too many checks/);
  });
});
