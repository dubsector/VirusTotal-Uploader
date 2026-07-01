// Service worker: owns the upload queue and talks to the VirusTotal API.
//
// Design notes:
//  - The queue and the in-flight job live in chrome.storage.local, not in
//    memory, so they survive the service worker being torn down while idle.
//  - Every API call goes through the persistent rate limiter. When no slot is
//    free (or the server returns 429) we schedule a chrome.alarms wake-up and
//    stop; resuming re-runs the current job from the top. Re-hashing the file
//    on resume is cheap and keeps the state machine simple and idempotent.

import { getSync, getLocal, setLocal, removeLocal } from './lib/storage.js';
import { getFileData, removeFileData } from './lib/idb.js';
import { reserveSlot, releaseSlot } from './lib/ratelimit.js';

const API = 'https://www.virustotal.com/api/v3';
const DIRECT_UPLOAD_MAX = 32 * 1024 * 1024; // 32 MB before /files/upload_url is required
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 60_000;
const ALARM = 'vtRetry';

// Signal used to unwind out of a job when we've deferred to an alarm.
class Deferred extends Error {}

let pumping = false;
let popupPort = null;

// ---- popup messaging -------------------------------------------------------

function post(message) {
  setLocal({ lastStatus: message });
  if (popupPort) {
    try {
      popupPort.postMessage(message);
    } catch {
      popupPort = null;
    }
  }
}

async function queuedCount() {
  const { queue = [] } = await getLocal(['queue']);
  return queue.length;
}

// ---- queue intake ----------------------------------------------------------

chrome.runtime.onMessage.addListener((message) => {
  if (message?.action === 'queueFile' && message.job) {
    enqueue(message.job);
  }
});

async function enqueue(job) {
  const { queue = [] } = await getLocal(['queue']);
  queue.push(job);
  await setLocal({ queue });
  post({ action: 'queued', fileName: job.fileName, remaining: queue.length });
  pump();
}

// ---- main loop -------------------------------------------------------------

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (true) {
      let { current } = await getLocal(['current']);

      if (!current) {
        const { queue = [] } = await getLocal(['queue']);
        if (queue.length === 0) {
          post({ action: 'idle' });
          break;
        }
        current = { ...queue[0], retryCount: 0, startTime: Date.now() };
        await setLocal({ queue: queue.slice(1), current });
      }

      try {
        await runJob(current);
        await finishJob(current);
      } catch (err) {
        if (err instanceof Deferred) break; // alarm scheduled; resume later
        const moveOn = await handleError(current, err);
        if (!moveOn) break; // retry scheduled
      }
    }
  } finally {
    pumping = false;
  }
}

// ---- single job ------------------------------------------------------------

async function runJob(job) {
  const { apiKey } = await getLocal(['apiKey']);
  const { premiumAccount } = await getSync(['premiumAccount']);
  if (!apiKey) {
    throw new Error('No API key set. Open settings to add one.');
  }
  const isPremium = Boolean(premiumAccount);

  const blob = await getFileData(job.jobId);
  if (!blob) throw new Error('File data was lost before upload.');

  post({ action: 'phase', phase: 'checking', fileName: job.fileName });
  const hash = await sha256(await blob.arrayBuffer());

  // Has this file already been analysed? Cheap GET avoids a redundant upload.
  const existing = await guardedFetch(
    `${API}/files/${hash}`,
    { method: 'GET', headers: { 'x-apikey': apiKey } },
    job,
    isPremium
  );

  if (existing.status === 200) {
    const data = await existing.json();
    openTab(`https://www.virustotal.com/gui/file/${data.data.id}/detection`);
    post({ action: 'done', fileName: job.fileName, existing: true });
    return;
  }
  if (existing.status !== 404) {
    throw new Error(`Lookup failed (${existing.status}).`);
  }

  // Not seen before: upload it.
  post({ action: 'phase', phase: 'uploading', fileName: job.fileName });
  const analysisId = await uploadFile(blob, job, apiKey, isPremium);
  openTab(`https://www.virustotal.com/gui/file-analysis/${analysisId}`);
  post({ action: 'done', fileName: job.fileName, existing: false });
}

async function uploadFile(blob, job, apiKey, isPremium) {
  const form = new FormData();
  form.append('file', blob, job.fileName);

  let response;
  if (blob.size <= DIRECT_UPLOAD_MAX) {
    response = await guardedFetch(
      `${API}/files`,
      { method: 'POST', headers: { 'x-apikey': apiKey }, body: form },
      job,
      isPremium
    );
  } else {
    // Large files need a one-time upload URL (premium API feature).
    const urlRes = await guardedFetch(
      `${API}/files/upload_url`,
      { method: 'GET', headers: { 'x-apikey': apiKey } },
      job,
      isPremium
    );
    if (!urlRes.ok) throw new Error(`Could not get upload URL (${urlRes.status}).`);
    const { data: uploadUrl } = await urlRes.json();
    response = await guardedFetch(uploadUrl, { method: 'POST', body: form }, job, isPremium);
  }

  if (!response.ok) throw new Error(`Upload failed (${response.status}).`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('Unexpected response from VirusTotal.');
  }
  const data = await response.json();
  return data.data.id;
}

// ---- rate-limited fetch ----------------------------------------------------

async function guardedFetch(url, options, job, isPremium) {
  const slot = await reserveSlot(isPremium);
  if (!slot.ok) {
    await defer(job, slot.waitMs, job.retryCount, /* throttled */ true);
    throw new Deferred();
  }

  const response = await fetch(url, options);

  if (response.status === 429) {
    await releaseSlot();
    const retryAfter = parseInt(response.headers.get('Retry-After'), 10);
    const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : RETRY_DELAY_MS;
    await defer(job, waitMs, job.retryCount, /* throttled */ true);
    throw new Deferred();
  }

  return response;
}

// ---- retries & alarms ------------------------------------------------------

async function defer(job, waitMs, retryCount, throttled) {
  const nextAttemptTime = Date.now() + Math.max(waitMs, 0);
  await setLocal({ current: { ...job, retryCount }, nextAttemptTime });
  chrome.alarms.create(ALARM, { when: nextAttemptTime });
  post({
    action: 'waiting',
    fileName: job.fileName,
    nextAttemptTime,
    retryCount: throttled ? 0 : retryCount,
    maxRetries: MAX_RETRIES,
    remaining: await queuedCount(),
  });
}

// Returns true if the caller should move on to the next job.
async function handleError(job, err) {
  const retryCount = (job.retryCount || 0) + 1;
  if (retryCount <= MAX_RETRIES) {
    await defer({ ...job, retryCount }, RETRY_DELAY_MS, retryCount, false);
    return false;
  }
  post({ action: 'error', fileName: job.fileName, message: err.message });
  await finishJob(job);
  return true;
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) {
    removeLocal(['nextAttemptTime']).finally(pump);
  }
});

// Resume any in-flight job after the worker or browser restarts.
chrome.runtime.onStartup.addListener(pump);
chrome.runtime.onInstalled.addListener(pump);

// ---- completion ------------------------------------------------------------

async function finishJob(job) {
  await removeFileData(job.jobId);
  await removeLocal(['current', 'nextAttemptTime']);
}

// ---- helpers ---------------------------------------------------------------

async function sha256(arrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function openTab(url) {
  chrome.tabs.create({ url });
}

// ---- popup connection ------------------------------------------------------

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'popup') return;
  popupPort = port;
  port.onDisconnect.addListener(() => {
    popupPort = null;
  });

  // Replay the latest known state so a freshly opened popup is in sync.
  getLocal(['lastStatus', 'current', 'nextAttemptTime']).then((data) => {
    if (data.nextAttemptTime && data.current) {
      port.postMessage({
        action: 'waiting',
        fileName: data.current.fileName,
        nextAttemptTime: data.nextAttemptTime,
        retryCount: data.current.retryCount || 0,
        maxRetries: MAX_RETRIES,
      });
    } else if (data.lastStatus) {
      port.postMessage(data.lastStatus);
    }
  });
});
