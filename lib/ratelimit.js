// Persistent sliding-window rate limiter.
//
// The original version kept the request timestamps in a module-level array.
// MV3 service workers are torn down when idle, so that array was wiped between
// alarm firings: on wake the extension believed it had a full quota, fired
// immediately, got another 429, and looped forever. Persisting the window to
// chrome.storage.local fixes that — the window survives worker restarts.

import { getLocal, setLocal } from './storage.js';

const WINDOW_MS = 60_000;
const FREE_LIMIT = 4;      // public API: 4 requests / minute
const PREMIUM_LIMIT = 240; // premium self-throttle; server 429s remain the real backstop
const KEY = 'rateWindow';

function limitFor(isPremium) {
  return isPremium ? PREMIUM_LIMIT : FREE_LIMIT;
}

async function loadWindow() {
  const { [KEY]: window = [] } = await getLocal([KEY]);
  const cutoff = Date.now() - WINDOW_MS;
  return window.filter((t) => t > cutoff);
}

// Try to claim a slot. Returns { ok: true } if a request may proceed now, or
// { ok: false, waitMs } with how long to wait before the oldest slot frees up.
export async function reserveSlot(isPremium) {
  const window = await loadWindow();
  const limit = limitFor(isPremium);

  if (window.length < limit) {
    window.push(Date.now());
    await setLocal({ [KEY]: window });
    return { ok: true };
  }

  await setLocal({ [KEY]: window }); // persist the pruned window
  const waitMs = window[0] + WINDOW_MS - Date.now();
  return { ok: false, waitMs: Math.max(waitMs, 0) };
}

// Roll back the most recent reservation, e.g. when the server returns 429 and
// we want the retry to respect Retry-After instead of our own accounting.
export async function releaseSlot() {
  const window = await loadWindow();
  window.pop();
  await setLocal({ [KEY]: window });
}
