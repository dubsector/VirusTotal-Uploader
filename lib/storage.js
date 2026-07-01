// Promise-based wrappers around chrome.storage.
//
// Convention: the VirusTotal API key lives in storage.local only, so it never
// leaves the device via Chrome Sync. Preferences (premiumAccount, theme) live
// in storage.sync so they follow the user across their signed-in browsers.
// The key is stored as plaintext: an extension has to read it back to call the
// API, so any at-rest "encryption" it could also decrypt adds no real
// protection. Chrome's per-extension sandbox is what keeps other extensions
// and web pages out; treat the key as a low-value, rotatable secret.

export function getSync(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(keys, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(err);
      else resolve(result);
    });
  });
}

export function setSync(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(items, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(err);
      else resolve();
    });
  });
}

export function getLocal(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(err);
      else resolve(result);
    });
  });
}

export function setLocal(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(err);
      else resolve();
    });
  });
}

export function removeLocal(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(err);
      else resolve();
    });
  });
}
