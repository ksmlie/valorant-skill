const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const VLR_BASE = 'https://www.vlr.gg';
const CACHE_ROOT = path.join(__dirname, '..', 'data', 'http-cache');
const HTML_CACHE_DIR = path.join(CACHE_ROOT, 'html');
const RESULT_CACHE_DIR = path.join(CACHE_ROOT, 'result');
const FAILURE_CACHE_FILE = path.join(CACHE_ROOT, 'failures.json');
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:139.0) Gecko/20100101 Firefox/139.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:139.0) Gecko/20100101 Firefox/139.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36'
];
const HOST_STATE = new Map();
const TIMEOUT_WINDOW_MS = 5 * 60 * 1000;
let failureCache = null;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function ensureCacheDirs() {
  ensureDir(CACHE_ROOT);
  ensureDir(HTML_CACHE_DIR);
  ensureDir(RESULT_CACHE_DIR);
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function pickUserAgent() {
  return USER_AGENTS[randomBetween(0, USER_AGENTS.length - 1)];
}

function toAbsoluteVlrUrl(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${VLR_BASE}${url.startsWith('/') ? '' : '/'}${url}`;
}

function sha1(input) {
  return crypto.createHash('sha1').update(String(input || '')).digest('hex');
}

function safeReadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function safeWriteJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function getFailureCache() {
  if (failureCache) return failureCache;
  failureCache = safeReadJson(FAILURE_CACHE_FILE, { version: 1, updated_at: null, entries: {} });
  if (!failureCache.entries || typeof failureCache.entries !== 'object') failureCache.entries = {};
  return failureCache;
}

function saveFailureCache() {
  const cache = getFailureCache();
  cache.updated_at = nowIso();
  safeWriteJson(FAILURE_CACHE_FILE, cache);
}

function getFailureEntry(url) {
  const cache = getFailureCache();
  return cache.entries[url] || null;
}

function setFailureEntry(url, entry) {
  const cache = getFailureCache();
  cache.entries[url] = { ...(cache.entries[url] || {}), ...entry, updated_at: nowIso() };
  saveFailureCache();
}

function clearFailureEntry(url) {
  const cache = getFailureCache();
  if (cache.entries[url]) {
    delete cache.entries[url];
    saveFailureCache();
  }
}

function isTimeoutError(error) {
  return /timed?out|request timeout/i.test(String(error?.message || error || ''));
}

function isChallengeOrBlockedPage(body) {
  const text = String(body || '').toLowerCase();
  if (!text) return false;
  return [
    'cf-chl',
    'captcha',
    'attention required',
    'verify you are human',
    'access denied',
    'temporarily blocked',
    'blocked by security',
    'sorry, you have been blocked',
    'anti-bot',
  ].some((keyword) => text.includes(keyword));
}

function getTimeoutState(entry) {
  return {
    consecutive_timeouts: Number(entry?.consecutive_timeouts || 0),
    last_timeout_at: entry?.last_timeout_at || null,
  };
}


function recordTimeoutAndMaybeCooldown(url) {
  const entry = getFailureEntry(url);
  const state = getTimeoutState(entry);
  const lastTimeoutTs = Date.parse(state.last_timeout_at || 0);
  const withinWindow = lastTimeoutTs && Date.now() - lastTimeoutTs <= TIMEOUT_WINDOW_MS;
  const consecutiveTimeouts = withinWindow ? state.consecutive_timeouts + 1 : 1;
  const baseEntry = {
    ...(entry || {}),
    consecutive_timeouts: consecutiveTimeouts,
    last_timeout_at: nowIso(),
    last_error: 'Request timeout',
  };

  if (consecutiveTimeouts === 2) {
    const cooldownMs = randomBetween(15 * 1000, 30 * 1000);
    setFailureEntry(url, {
      ...baseEntry,
      timeout_cooldown_level: 2,
      blocked_until: new Date(Date.now() + cooldownMs).toISOString(),
    });
    return getFailureEntry(url);
  }

  if (consecutiveTimeouts >= 3) {
    const cooldownMs = randomBetween(60 * 1000, 120 * 1000);
    setFailureEntry(url, {
      ...baseEntry,
      timeout_cooldown_level: 3,
      blocked_until: new Date(Date.now() + cooldownMs).toISOString(),
    });
    return getFailureEntry(url);
  }

  const nextEntry = { ...baseEntry };
  delete nextEntry.blocked_until;
  delete nextEntry.status_code;
  setFailureEntry(url, nextEntry);
  return getFailureEntry(url);
}

function applyHardFailureCooldown(url, statusCode, errorMessage, reason) {
  let cooldownMs = randomBetween(60 * 1000, 3 * 60 * 1000);
  if (statusCode === 429) cooldownMs = randomBetween(5 * 60 * 1000, 10 * 60 * 1000);
  if (statusCode === 403) cooldownMs = randomBetween(10 * 60 * 1000, 20 * 60 * 1000);
  if (reason === 'challenge_or_blocked_page') cooldownMs = randomBetween(10 * 60 * 1000, 20 * 60 * 1000);

  setFailureEntry(url, {
    status_code: statusCode || null,
    last_error: errorMessage,
    failure_reason: reason || 'hard_failure',
    blocked_until: new Date(Date.now() + cooldownMs).toISOString(),
    consecutive_timeouts: 0,
    last_timeout_at: null,
    timeout_cooldown_level: null,
  });
  return getFailureEntry(url);
}

function getHtmlCacheFile(url) {
  return path.join(HTML_CACHE_DIR, `${sha1(url)}.json`);
}

function getResultCacheFile(namespace, key) {
  return path.join(RESULT_CACHE_DIR, `${namespace}--${sha1(key)}.json`);
}

function readHtmlCache(url) {
  return safeReadJson(getHtmlCacheFile(url), null);
}

function writeHtmlCache(url, payload) {
  safeWriteJson(getHtmlCacheFile(url), payload);
}

function getResultCache(namespace, key, ttlMs) {
  const payload = safeReadJson(getResultCacheFile(namespace, key), null);
  if (!payload || typeof payload !== 'object') return null;
  const fetchedAt = Date.parse(payload.cached_at || 0);
  if (!fetchedAt) return null;
  if (Date.now() - fetchedAt > ttlMs) return null;
  return payload;
}

function getResultCacheAnyAge(namespace, key) {
  const payload = safeReadJson(getResultCacheFile(namespace, key), null);
  return payload && typeof payload === 'object' ? payload : null;
}

function setResultCache(namespace, key, value, meta = {}) {
  safeWriteJson(getResultCacheFile(namespace, key), {
    namespace,
    key,
    cached_at: nowIso(),
    meta,
    value,
  });
}

async function throttleHost(hostname, options = {}) {
  const minDelayMs = options.minDelayMs ?? 1200;
  const maxDelayMs = options.maxDelayMs ?? 2800;
  const state = HOST_STATE.get(hostname) || { nextAllowedAt: 0, chain: Promise.resolve() };

  const runner = state.chain.then(async () => {
    const waitMs = Math.max(0, state.nextAllowedAt - Date.now());
    if (waitMs > 0) await sleep(waitMs);
    state.nextAllowedAt = Date.now() + randomBetween(minDelayMs, maxDelayMs);
  });

  state.chain = runner.catch(() => {});
  HOST_STATE.set(hostname, state);
  await runner;
}

function buildHeaders(url, referer) {
  return {
    'user-agent': pickUserAgent(),
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
    'accept-encoding': 'identity',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    referer: referer || VLR_BASE,
    'upgrade-insecure-requests': '1',
    connection: 'keep-alive',
    host: new URL(url).host,
  };
}

function shouldRetry(statusCode, errorMessage) {
  if ([403, 408, 425, 429, 500, 502, 503, 504].includes(statusCode)) return true;
  return /timed?out|socket hang up|econnreset|econnrefused|enetunreach|temporary/i.test(String(errorMessage || ''));
}

function requestOnce(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: buildHeaders(url, options.referer),
        timeout: options.timeoutMs ?? 15000,
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          resolve({ redirect: toAbsoluteVlrUrl(res.headers.location), statusCode: res.statusCode, headers: res.headers });
          return;
        }

        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode || 0, headers: res.headers, body });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Request timeout'));
    });
    req.on('error', reject);
  });
}

async function fetchHtmlWithCache(url, options = {}) {
  ensureCacheDirs();
  const cacheTtlMs = options.cacheTtlMs ?? 5 * 60 * 1000;
  const staleTtlMs = options.staleTtlMs ?? 6 * 60 * 60 * 1000;
  const retries = options.retries ?? 3;
  const hostname = new URL(url).hostname;
  const cached = readHtmlCache(url);
  const cachedAt = Date.parse(cached?.fetched_at || 0);
  const freshCache = cached && cached.body && cachedAt && Date.now() - cachedAt <= cacheTtlMs;
  if (freshCache) {
    return {
      ok: true,
      statusCode: cached.status_code || 200,
      body: cached.body,
      finalUrl: cached.final_url || url,
      cache: { hit: true, stale: false, source: 'html_cache_fresh' },
      degraded: false,
    };
  }

  const failureEntry = getFailureEntry(url);
  const blockedUntil = Date.parse(failureEntry?.blocked_until || 0);
  if (blockedUntil && blockedUntil > Date.now()) {
    const staleAllowed = cached && cached.body && cachedAt && Date.now() - cachedAt <= staleTtlMs;
    if (staleAllowed) {
      return {
        ok: true,
        statusCode: cached.status_code || 200,
        body: cached.body,
        finalUrl: cached.final_url || url,
        cache: { hit: true, stale: true, source: 'html_cache_stale_failure_cooldown' },
        degraded: true,
        degradation_reason: 'upstream_rate_limited_or_temporarily_blocked',
        failure: failureEntry,
      };
    }

    const error = new Error(failureEntry?.last_error || 'Request blocked by failure cache cooldown');
    error.code = 'UPSTREAM_COOLDOWN';
    error.failureEntry = failureEntry;
    throw error;
  }

  let currentUrl = url;
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await throttleHost(hostname, options.throttle);
      const response = await requestOnce(currentUrl, options);

      if (response.redirect) {
        currentUrl = response.redirect;
        continue;
      }

      if (response.statusCode >= 200 && response.statusCode < 300 && response.body) {
        if (isChallengeOrBlockedPage(response.body)) {
          const error = new Error('Challenge or blocked page detected');
          error.statusCode = response.statusCode;
          error.isChallengePage = true;
          throw error;
        }

        clearFailureEntry(url);
        writeHtmlCache(url, {
          url,
          final_url: currentUrl,
          status_code: response.statusCode,
          fetched_at: nowIso(),
          headers: response.headers,
          body: response.body,
        });
        return {
          ok: true,
          statusCode: response.statusCode,
          body: response.body,
          finalUrl: currentUrl,
          cache: { hit: false, stale: false, source: 'network' },
          degraded: false,
        };
      }

      const error = new Error(`HTTP ${response.statusCode}`);
      error.statusCode = response.statusCode;
      throw error;
    } catch (error) {
      lastError = error;
      const statusCode = Number(error.statusCode || String(error.message || '').match(/HTTP\s+(\d+)/i)?.[1] || 0) || 0;
      const isTimeout = isTimeoutError(error);
      const isChallenge = Boolean(error.isChallengePage);
      const retryable = shouldRetry(statusCode, error.message) || isTimeout || isChallenge;
      const isLastAttempt = attempt >= retries;

      if (statusCode === 429 || statusCode === 403) {
        applyHardFailureCooldown(url, statusCode, error.message, 'hard_failure_http_status');
      } else if (isChallenge) {
        applyHardFailureCooldown(url, statusCode, error.message, 'challenge_or_blocked_page');
      } else if (isTimeout) {
        const timeoutState = recordTimeoutAndMaybeCooldown(url);
        if (!timeoutState.blocked_until) {
          const staleAllowed = cached && cached.body && cachedAt && Date.now() - cachedAt <= staleTtlMs;
          if (staleAllowed) {
            return {
              ok: true,
              statusCode: cached.status_code || 200,
              body: cached.body,
              finalUrl: cached.final_url || url,
              cache: { hit: true, stale: true, source: 'html_cache_stale_after_timeout' },
              degraded: true,
              degradation_reason: 'timeout_no_cooldown_yet_stale_cache_used',
              failure: timeoutState,
            };
          }
          if (!retryable || isLastAttempt) throw error;
          await sleep(randomBetween(900, 2200) * (attempt + 1));
          continue;
        }
      }

      if (!retryable || isLastAttempt) {
        const staleAllowed = cached && cached.body && cachedAt && Date.now() - cachedAt <= staleTtlMs;
        if (staleAllowed) {
          return {
            ok: true,
            statusCode: cached.status_code || 200,
            body: cached.body,
            finalUrl: cached.final_url || url,
            cache: { hit: true, stale: true, source: 'html_cache_stale_after_failure' },
            degraded: true,
            degradation_reason: isTimeout ? 'network_timeout_stale_cache_used' : 'network_failed_stale_cache_used',
            failure: getFailureEntry(url),
          };
        }
        throw error;
      }

      await sleep(randomBetween(900, 2200) * (attempt + 1));
    }
  }

  throw lastError || new Error('Unknown fetch failure');
}

function buildDegradedMeta(namespace, key, liveMeta, stalePayload, error) {
  return {
    namespace,
    key,
    live: liveMeta || null,
    stale_cache_available: Boolean(stalePayload),
    stale_cached_at: stalePayload?.cached_at || null,
    error: error ? String(error.message || error) : null,
  };
}

module.exports = {
  VLR_BASE,
  toAbsoluteVlrUrl,
  fetchHtmlWithCache,
  getResultCache,
  getResultCacheAnyAge,
  setResultCache,
  buildDegradedMeta,
};