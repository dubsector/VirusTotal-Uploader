// Service worker.
//
// The extension's action opens upload.html, which embeds VirusTotal's own
// upload page in a sandboxed iframe (framing headers stripped via
// rules.json). The user uploads through VT's real UI — their session, web
// limits, no API quota.
//
// The popup can't read the cross-origin frame, so vt-content.js (injected
// into the frame) reports the result URL once VT navigates there. We pop it
// into a real tab, which takes focus and closes the popup.

import { getSync } from './lib/storage.js';

chrome.runtime.onMessage.addListener((message) => {
  if (message?.action === 'webResult' && message.url) {
    openWebResult(message.url);
  }
});

// VT may report file-analysis then file/{hash} in quick succession for the
// same result; only open the first.
let lastResultAt = 0;

async function openWebResult(url) {
  const now = Date.now();
  if (now - lastResultAt < 8000) return;
  lastResultAt = now;

  chrome.tabs.create({ url, active: true });

  const { notify } = await getSync(['notify']);
  if (notify !== false) {
    chrome.notifications.create(`vtweb-${now}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'VirusTotal result ready',
      message: 'Opened the scan report in a new tab.',
      priority: 0,
    });
  }
}
