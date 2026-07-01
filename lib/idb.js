// IndexedDB helpers for staging file bytes between the popup and the
// service worker. The popup reads the file, stores the bytes here, then the
// service worker pulls them out to upload. Keyed by a unique job id so two
// files with the same name never collide.

const DB_NAME = 'VirusTotalUploaderDB';
const DB_VERSION = 2;
const STORE = 'files';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (db.objectStoreNames.contains(STORE)) {
        db.deleteObjectStore(STORE);
      }
      db.createObjectStore(STORE, { keyPath: 'jobId' });
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

export async function saveFileData(jobId, fileData) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE], 'readwrite');
    tx.objectStore(STORE).put({ jobId, fileData });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getFileData(jobId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE], 'readonly');
    const request = tx.objectStore(STORE).get(jobId);
    request.onsuccess = () => resolve(request.result ? request.result.fileData : null);
    request.onerror = () => reject(request.error);
  });
}

export async function removeFileData(jobId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE], 'readwrite');
    tx.objectStore(STORE).delete(jobId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
