// background.js

// Constants and Configurations
const MIN_WAIT_TIME = 15000; // Minimum 15 seconds between uploads
const MAX_WAIT_TIME = 40000; // Maximum 40 seconds between uploads
const MAX_FILE_SIZE_FREE = 32 * 1024 * 1024; // 32 MB for free accounts
const MAX_FILE_SIZE_PREMIUM = 550 * 1024 * 1024; // 550 MB for premium accounts
const AVERAGE_UPLOAD_SPEED = 950 * 1024; // 950 KB/s
const MAX_RETRIES = 3; // Maximum number of retries

// Adaptive wait time variable
let adaptiveWaitTime = MIN_WAIT_TIME; // Default to minimum wait time

// Initialize adaptiveWaitTime from storage
initializeAdaptiveWaitTime();

// Upload queue and state variables
let uploadQueue = [];
let isUploading = false;

// Persistent connection to the popup
let popupPort = null;

// Helper Functions for Chrome Storage with Promises
function getFromStorageSync(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(keys, (result) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(result);
    });
  });
}

function getFromStorageLocal(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(result);
    });
  });
}

function setToStorageLocal(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

function removeFromStorageLocal(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

function setToStorageSync(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(items, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

// Initialize Adaptive Wait Time
function initializeAdaptiveWaitTime() {
  getFromStorageLocal(['adaptiveWaitTime'])
    .then((data) => {
      if (data.adaptiveWaitTime !== undefined) {
        adaptiveWaitTime = data.adaptiveWaitTime;
        console.log(
          `[${new Date().toLocaleTimeString()}] Loaded adaptiveWaitTime from storage: ${adaptiveWaitTime} ms`
        );
      } else {
        console.log(
          `[${new Date().toLocaleTimeString()}] No stored adaptiveWaitTime found. Using default: ${adaptiveWaitTime} ms`
        );
      }
    })
    .catch((error) => {
      console.error('Error retrieving adaptiveWaitTime from storage:', error);
    });
}

// Calculate Wait Time Based on File Size
function calculateWaitTime(fileSize, isPremium) {
  const MAX_FILE_SIZE = isPremium ? MAX_FILE_SIZE_PREMIUM : MAX_FILE_SIZE_FREE;
  const sizeRatio = Math.min(fileSize / MAX_FILE_SIZE, 1);
  const exponent = 0.5; // Adjusting the curve with exponent
  const waitTime =
    MIN_WAIT_TIME +
    (MAX_WAIT_TIME - MIN_WAIT_TIME) * Math.pow(1 - sizeRatio, exponent);
  return Math.max(Math.min(waitTime, MAX_WAIT_TIME), MIN_WAIT_TIME); // Ensure within bounds
}

// Easing Function for Progress Simulation
function easeOutQuad(t) {
  return t * (2 - t);
}

// Handle Messages from Popup
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'queueFile') {
    queueFileForUpload(message.fileName, message.fileSize, message.fileData);
  }
});

// Queue File for Upload
function queueFileForUpload(fileName, fileSize, fileData) {
  uploadQueue.push({ fileName, fileSize, fileData });
  console.log(`[${new Date().toLocaleTimeString()}] Queued file: ${fileName}`);

  // Start processing the queue
  processUploadQueue();
}

// Process Upload Queue
function processUploadQueue() {
  if (isUploading) {
    console.log(`[${new Date().toLocaleTimeString()}] Upload already in progress.`);
    return;
  }

  if (uploadQueue.length === 0) {
    console.log(`[${new Date().toLocaleTimeString()}] Upload queue is empty.`);
    isUploading = false;
    return;
  }

  isUploading = true;
  const { fileName, fileSize, fileData } = uploadQueue.shift();
  console.log(`[${new Date().toLocaleTimeString()}] Starting upload for: ${fileName}`);

  // Initialize upload state
  chrome.storage.local.set({
    fileName,
    percentComplete: 0,
    waitingForNextUpload: false,
    retryCount: 0,
    uploadInProgress: true,
  });

  const startTime = Date.now(); // Record the start time

  // Begin upload attempt
  attemptUpload(fileName, fileSize, fileData, 0, startTime);
}

// Attempt Upload with Retry Logic
async function attemptUpload(fileName, fileSize, fileData, retryCount, startTime) {
  try {
    let result = await getFromStorageSync([
      'apiKey',
      'iv',
      'encryptionKey',
      'nextUploadTime',
      'premiumAccount',
    ]);

    let currentTime = Date.now();

    // Check for required wait time
    if (result.nextUploadTime && currentTime < result.nextUploadTime) {
      await handleWaitPeriod(
        fileName,
        result.nextUploadTime,
        retryCount,
        startTime,
        fileSize,
        fileData
      );
      return;
    }

    // Check for necessary credentials
    if (!result.apiKey || !result.iv || !result.encryptionKey) {
      throw new Error('Missing API key or IV');
    }

    // Proceed with upload
    await processUpload(fileName, fileSize, fileData, result, startTime);
  } catch (error) {
    await handleUploadError(error, fileName, fileSize, retryCount, startTime, fileData);
  }
}

// Handle Wait Period Before Next Upload
async function handleWaitPeriod(
  fileName,
  nextUploadTime,
  retryCount,
  startTime,
  fileSize,
  fileData
) {
  const waitTimeMs = nextUploadTime - Date.now();
  const waitTimeSeconds = Math.ceil(waitTimeMs / 1000); // Round up to nearest whole second

  console.log(
    `[${new Date().toLocaleTimeString()}] Need to wait ${waitTimeSeconds} seconds before the next upload.`
  );

  await setToStorageLocal({
    waitingForNextUpload: true,
    waitTime: waitTimeSeconds, // Store as integer seconds
  });

  if (popupPort) {
    popupPort.postMessage({
      action: 'waitingForNextUpload',
      fileName,
      waitTime: waitTimeSeconds, // Send integer seconds to popup
    });
  }

  // Wait for the required time
  setTimeout(() => {
    console.log(
      `[${new Date().toLocaleTimeString()}] Wait period over. Resuming upload for ${fileName}.`
    );
    attemptUpload(fileName, fileSize, fileData, retryCount, startTime);
  }, waitTimeMs);
}

// Process the Actual Upload
async function processUpload(fileName, fileSize, fileData, credentials, startTime) {
  try {
    const apiKey = await decryptApiKey(credentials);

    const arrayBuffer = new Uint8Array(fileData).buffer;
    const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });

    const isPremium = credentials.premiumAccount || false;

    adaptiveWaitTime = calculateWaitTime(fileSize, isPremium);
    await setToStorageLocal({ adaptiveWaitTime });

    console.log(
      `[${new Date().toLocaleTimeString()}] Calculated adaptiveWaitTime for ${fileName}: ${(
        adaptiveWaitTime / 1000
      ).toFixed(2)} seconds`
    );

    const estimatedUploadDuration = (fileSize / AVERAGE_UPLOAD_SPEED) * 1000;

    console.log(
      `[${new Date().toLocaleTimeString()}] Estimated upload duration for ${fileName}: ${(
        estimatedUploadDuration / 1000
      ).toFixed(2)} seconds`
    );

    await simulateProgress(fileName, estimatedUploadDuration, startTime);

    const uploadStartTimeFetch = Date.now();

    const response = await fetch('https://www.virustotal.com/vtapi/v2/file/scan', {
      method: 'POST',
      body: createFormData(blob, fileName, apiKey),
    });

    const uploadDuration = ((Date.now() - uploadStartTimeFetch) / 1000).toFixed(2);

    await handleUploadResponse(
      response,
      fileName,
      fileSize,
      startTime,
      uploadDuration
    );
  } catch (error) {
    await handleUploadError(error, fileName, fileSize, 0, startTime, fileData);
  }
}

// Decrypt the API Key
async function decryptApiKey(credentials) {
  try {
    const rawKey = new Uint8Array(credentials.encryptionKey);
    const encryptionKey = await crypto.subtle.importKey(
      'raw',
      rawKey,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );

    const decryptedApiKey = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(credentials.iv) },
      encryptionKey,
      new Uint8Array(credentials.apiKey)
    );

    return new TextDecoder().decode(decryptedApiKey);
  } catch (error) {
    throw new Error('Failed to decrypt API key');
  }
}

// Create Form Data for Upload
function createFormData(blob, fileName, apiKey) {
  const formData = new FormData();
  formData.append('file', blob, fileName);
  formData.append('apikey', apiKey);
  return formData;
}

// Simulate Progress Bar
async function simulateProgress(fileName, estimatedUploadDuration, startTime) {
  const uploadStartTime = Date.now();

  return new Promise((resolve) => {
    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - uploadStartTime;
      const progress = Math.min(1, elapsed / estimatedUploadDuration);

      const simulatedPercent = easeOutQuad(progress) * 96; // Adjusted scaling to 96%

      setToStorageLocal({ percentComplete: simulatedPercent.toFixed(2) });

      if (popupPort) {
        popupPort.postMessage({
          action: 'uploadProgress',
          percentComplete: simulatedPercent.toFixed(2),
          fileName,
        });
      }

      if (progress >= 1) {
        clearInterval(progressInterval);
        resolve();
      }
    }, 200);
  });
}

// Handle Upload Response
async function handleUploadResponse(
  response,
  fileName,
  fileSize,
  startTime,
  uploadDuration
) {
  try {
    if (!response.ok) {
      const responseText = await response.text();
      console.error(
        `[${new Date().toLocaleTimeString()}] Error ${response.status}: ${responseText}`
      );

      if (
        response.status === 204 ||
        responseText.includes('Too many requests')
      ) {
        console.warn(
          `[${new Date().toLocaleTimeString()}] Rate limit exceeded. Adjusting wait time.`
        );
        adaptiveWaitTime = Math.min(adaptiveWaitTime + 3000, MAX_WAIT_TIME);
        await setToStorageLocal({ adaptiveWaitTime });
      }

      throw new Error(`Error ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const responseText = await response.text();
      console.error(
        `[${new Date().toLocaleTimeString()}] Unexpected response format for ${fileName}: ${responseText}`
      );
      throw new Error('Unexpected response format');
    }

    const resultData = await response.json();

    if (popupPort) {
      popupPort.postMessage({
        action: 'uploadProgress',
        percentComplete: 100,
        fileName,
      });
      // Optionally, send a message indicating upload completion
      popupPort.postMessage({
        action: 'uploadComplete',
        fileName,
      });
    }

    await clearUploadState();

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(
      `[${new Date().toLocaleTimeString()}] Upload complete for ${fileName}. Total time (including wait): ${totalTime} seconds.`
    );
    console.log(
      `[${new Date().toLocaleTimeString()}] Upload duration for ${fileName}: ${uploadDuration} seconds.`
    );

    chrome.tabs.create({
      url: `https://www.virustotal.com/gui/file/${resultData.sha256}/detection`,
    });

    // Update adaptiveWaitTime for the next upload
    const result = await getFromStorageSync(['premiumAccount']);
    const isPremium = result.premiumAccount || false;
    adaptiveWaitTime = calculateWaitTime(fileSize, isPremium);
    await setToStorageLocal({ adaptiveWaitTime });

    const nextUploadTime = Date.now() + adaptiveWaitTime;
    console.log(
      `[${new Date().toLocaleTimeString()}] Next upload allowed in ${(
        adaptiveWaitTime / 1000
      ).toFixed(2)} seconds.`
    );

    await setToStorageSync({ nextUploadTime });

    // Proceed to the next file in the queue
    isUploading = false;
    processUploadQueue();
  } catch (error) {
    await handleUploadError(error, fileName, fileSize, 0, startTime, []);
  }
}

// Handle Upload Errors and Retry Logic
async function handleUploadError(
  error,
  fileName,
  fileSize,
  retryCount,
  startTime,
  fileData
) {
  console.error(
    `[${new Date().toLocaleTimeString()}] Upload failed for ${fileName}: ${error.message}`
  );

  if (retryCount < MAX_RETRIES) {
    retryCount += 1;
    adaptiveWaitTime = Math.min(adaptiveWaitTime + 3000, MAX_WAIT_TIME);
    const retryDelayMs = adaptiveWaitTime;
    const retryDelaySeconds = Math.ceil(retryDelayMs / 1000); // Round up to nearest whole second

    await setToStorageLocal({
      adaptiveWaitTime,
      retryCount,
      waitTime: retryDelaySeconds, // Store as integer seconds
    });

    console.log(
      `[${new Date().toLocaleTimeString()}] Retrying upload (${retryCount}/${MAX_RETRIES}) for ${fileName} after ${retryDelaySeconds} seconds.`
    );

    // Send the wait time to the popup
    if (popupPort) {
      popupPort.postMessage({
        action: 'uploadRetry',
        retryCount,
        maxRetries: MAX_RETRIES,
        fileName,
        waitTime: retryDelaySeconds, // Send integer seconds to popup
      });
    }

    // Wait before retrying
    setTimeout(() => {
      attemptUpload(fileName, fileSize, fileData, retryCount, startTime);
    }, retryDelayMs);
  } else {
    console.error(
      `[${new Date().toLocaleTimeString()}] Max retries reached for ${fileName}. Skipping to next file.`
    );

    await clearUploadState();

    if (popupPort) {
      popupPort.postMessage({
        action: 'uploadError',
        error: error.message,
      });
    }

    // Proceed to the next file in the queue
    isUploading = false;
    processUploadQueue();
  }
}

// Clear Upload State After Completion or Failure
async function clearUploadState() {
  await removeFromStorageLocal([
    'percentComplete',
    'uploadInProgress',
    'fileName',
    'waitingForNextUpload',
    'retryCount',
    'adaptiveWaitTime',
    'waitTime',
  ]);
}

// Handle Popup Connections for Real-time Updates
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    popupPort = port;

    getFromStorageLocal([
      'fileName',
      'percentComplete',
      'uploadInProgress',
      'waitingForNextUpload',
      'retryCount',
      'waitTime',
    ]).then((data) => {
      if (data.fileName && popupPort) {
        if (data.uploadInProgress && data.percentComplete) {
          popupPort.postMessage({
            action: 'uploadProgress',
            percentComplete: data.percentComplete,
            fileName: data.fileName,
          });
        } else if (data.waitingForNextUpload) {
          popupPort.postMessage({
            action: 'waitingForNextUpload',
            fileName: data.fileName,
            waitTime: data.waitTime || '', // Send integer seconds
          });
        }

        if (data.retryCount) {
          popupPort.postMessage({
            action: 'uploadRetry',
            retryCount: data.retryCount,
            maxRetries: MAX_RETRIES,
            fileName: data.fileName,
            waitTime: data.waitTime || '', // Send integer seconds
          });
        }
      }
    });

    port.onDisconnect.addListener(() => {
      popupPort = null;
    });
  }
});
