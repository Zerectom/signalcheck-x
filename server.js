import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const allowedStatic = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
  ['/robots.txt', ['robots.txt', 'text/plain; charset=utf-8']]
]);

const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'"
};

export function normalizeHandle(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^(?:(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/)?@?([A-Za-z0-9_]{1,15})(?:\/)?(?:\?.*)?$/i);
  return match ? match[1] : null;
}

function sendJson(res, status, object, extraHeaders = {}) {
  res.writeHead(status, {
    ...HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(JSON.stringify(object));
}

function checkStatus(value, fallback) {
  const allowed = ['clean', 'banned', 'unknown'];
  const status = allowed.includes(value?.status) ? value.status : 'unknown';
  const reason = typeof value?.reason === 'string' ? value.reason.slice(0, 320) : fallback;
  return { status, reason };
}

export function normalizeProviderResult(result, username, time = Date.now()) {
  const raw = result?.data?.checks ? result.data : result;
  if (!raw || typeof raw !== 'object' || !raw.checks || typeof raw.checks !== 'object') {
    throw new Error('Unexpected upstream response');
  }
  const profile = raw.profile && typeof raw.profile === 'object' ? raw.profile : {};
  const protectedAccount = typeof raw.protected === 'boolean' ? raw.protected : typeof profile.protected === 'boolean' ? profile.protected : null;
  const possiblySensitive = typeof raw.possibly_sensitive === 'boolean' ? raw.possibly_sensitive : typeof profile.possibly_sensitive === 'boolean' ? profile.possibly_sensitive : null;
  const unknown = 'Could not establish this signal from public data.';
  const search = checkStatus(raw.checks.search_ban, unknown);
  const suggestion = checkStatus(raw.checks.search_suggestion_ban, unknown);
  if (protectedAccount === true) {
    search.status = 'unknown';
    suggestion.status = 'unknown';
    search.reason = 'Protected accounts cannot be reliably checked from a public view.';
    suggestion.reason = search.reason;
  }
  const checkedTime = typeof raw.checked_at === 'string' && !Number.isNaN(Date.parse(raw.checked_at))
    ? new Date(raw.checked_at).toISOString() : new Date(time).toISOString();
  return {
    username,
    mode: 'automatic',
    checkedAt: checkedTime,
    provider: 'Sorsa API',
    checks: { search, suggestion },
    account: { protected: protectedAccount, possiblySensitive }
  };
}

async function jsonBody(req, maxBytes = 2048) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

export function createHandler({ apiKey = process.env.SORSA_API_KEY || '', fetcher = fetch, now = () => Date.now() } = {}) {
  const resultsCache = new Map();
  const limitStore = new Map();
  const CACHE_MS = 60 * 60 * 1000; // Provider reports up to one hour of caching, too.
  const LIMIT_WINDOW_MS = 10 * 60 * 1000;
  const LIMIT_COUNT = 12;

  return async function handler(req, res) {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    try {
      if (req.method === 'GET' && pathname === '/health') {
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === 'GET' && pathname === '/api/config') {
        sendJson(res, 200, { automatic: Boolean(apiKey), guided: true });
        return;
      }
      if (req.method === 'POST' && pathname === '/api/check') {
        if (!apiKey) {
          sendJson(res, 503, { error: 'Automatic tests are not configured. The guided checks are still available.' });
          return;
        }
        if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
          sendJson(res, 415, { error: 'Send a JSON body.' });
          return;
        }
        const data = await jsonBody(req);
        const username = normalizeHandle(data?.username);
        if (!username) {
          sendJson(res, 400, { error: 'Use a valid X handle (1–15 letters, numbers or underscores) or profile URL.' });
          return;
        }
        const key = username.toLowerCase();
        const current = now();
        // Use socket IP by default; only trust forwarded IP behind a known, configured proxy.
        const identifier = process.env.TRUST_PROXY === 'true'
          ? ((req.headers['x-forwarded-for'] || '').split(',')[0]?.trim() || req.socket.remoteAddress)
          : req.socket.remoteAddress;
        const bucket = limitStore.get(identifier) || { count: 0, reset: current + LIMIT_WINDOW_MS };
        if (current > bucket.reset) { bucket.count = 0; bucket.reset = current + LIMIT_WINDOW_MS; }
        bucket.count += 1;
        limitStore.set(identifier, bucket);
        if (bucket.count > LIMIT_COUNT) {
          sendJson(res, 429, { error: 'Too many checks. Try again in a few minutes.' }, {
            'Retry-After': String(Math.max(1, Math.ceil((bucket.reset - current) / 1000)))
          });
          return;
        }
        if (limitStore.size > 3000) {
          for (const [id, value] of limitStore) if (current > value.reset) limitStore.delete(id);
        }
        const cached = resultsCache.get(key);
        if (cached && current < cached.expires) {
          sendJson(res, 200, { ...cached.result, cached: true });
          return;
        }
        const target = new URL('https://api.sorsa.io/v3/check-shadowban');
        target.searchParams.set('username', username);
        let upstream;
        try {
          upstream = await fetcher(target, {
            method: 'GET',
            headers: { ApiKey: apiKey, Accept: 'application/json' },
            signal: AbortSignal.timeout(15000)
          });
        } catch {
          sendJson(res, 502, { error: 'The visibility service is temporarily unreachable. Try guided checks.' });
          return;
        }
        if (!upstream.ok) {
          const status = upstream.status === 429 ? 429 : 502;
          sendJson(res, status, {
            error: upstream.status === 429
              ? 'The visibility provider has reached its rate limit. Try later or use guided checks.'
              : 'The visibility provider could not complete this check. Try guided checks.'
          });
          return;
        }
        let result;
        try { result = normalizeProviderResult(await upstream.json(), username, current); }
        catch {
          sendJson(res, 502, { error: 'Unexpected response from the visibility provider. Try guided checks.' });
          return;
        }
        resultsCache.set(key, { result, expires: current + CACHE_MS });
        if (resultsCache.size > 2000) {
          for (const [id, value] of resultsCache) if (current > value.expires) resultsCache.delete(id);
          if (resultsCache.size > 2000) resultsCache.delete(resultsCache.keys().next().value);
        }
        sendJson(res, 200, { ...result, cached: false });
        return;
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && allowedStatic.has(pathname)) {
        const [file, contentType] = allowedStatic.get(pathname);
        const body = await readFile(path.join(dirname, 'public', file));
        res.writeHead(200, { ...HEADERS, 'Content-Type': contentType, 'Cache-Control': pathname === '/' ? 'no-cache' : 'public, max-age=3600' });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }
      sendJson(res, 404, { error: 'Not found' });
    } catch (error) {
      sendJson(res, error?.status || 500, { error: error?.status ? error.message : 'An unexpected error occurred.' });
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 3000);
  http.createServer(createHandler()).listen(port, '0.0.0.0', () => {
    console.log(`SignalCheck is running on http://localhost:${port}`);
    console.log(process.env.SORSA_API_KEY ? 'Automatic checks enabled.' : 'Guided mode: set SORSA_API_KEY to enable automatic tests.');
  });
}
