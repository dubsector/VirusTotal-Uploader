// background.js

// Constants and Configurations
const MAX_FILE_SIZE_FREE = 32 * 1024 * 1024; // 32 MB for free accounts
const MAX_FILE_SIZE_PREMIUM = 550 * 1024 * 1024; // 550 MB for premium accounts
const AVERAGE_UPLOAD_SPEED = 950 * 1024; // 950 KB/s
const MAX_RETRIES = 3; // Maximum number of retries

// Upload queue and state variables
let uploadQueue = [];
let isUploading = false;

// Persistent connection to the popup
let popupPort = null;

// Global request tracking variables for rate limiting
const requestTimestamps = [];

// Helper Functions for Rate Limiting
function canMakeRequest() {
  const now = Date.now();
  // Remove timestamps older than 60,000 ms (1 minute)
  while (requestTimestamps.length > 0 && now - requestTimestamps[0] >= 60000) {
    requestTimestamps.shift();
  }
  return requestTimestamps.length < 4;
}

function getNextAvailableRequestTime() {
  const now = Date.now();
  const oldestTimestamp = requestTimestamps[0];
  const timeUntilNextRequest = 60000 - (now - oldestTimestamp);
  return timeUntilNextRequest > 0 ? timeUntilNextRequest : 0;
}

async function makeApiRequest(url, options, fileName) {
  // First, check if we can make the request now
  if (canMakeRequest()) {
    // Proceed with the request
    requestTimestamps.push(Date.now());
    const response = await fetch(url, options);
    if (response.status === 429) {
      // Handle rate limit exceeded
      console.warn(
        `[${new Date().toLocaleTimeString()}] Received 429 Too Many Requests for ${url}`
      );
      // Remove the timestamp we just added
      requestTimestamps.pop();
      // Get Retry-After header, if present
      let retryAfter = response.headers.get('Retry-After');
      let retryDelayMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60000;
      const nextAttemptTime = Date.now() + retryDelayMs;
      // Update storage with nextAttemptTime if needed
      await setToStorageLocal({ nextAttemptTime });
      // Notify popup about the delay
      if (popupPort) {
        popupPort.postMessage({
          action: 'uploadRetry',
          retryCount: 0,
          maxRetries: MAX_RETRIES,
          fileName,
          nextAttemptTime,
        });
      }
      console.log(
        `[${new Date().toLocaleTimeString()}] Waiting ${Math.ceil(
          retryDelayMs / 1000
        )} seconds before retrying request to ${url}`
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      // After waiting, retry
      return await makeApiRequest(url, options, fileName);
    } else {
      return response;
    }
  } else {
    // Need to wait
    const delayMs = getNextAvailableRequestTime();
    console.log(
      `[${new Date().toLocaleTimeString()}] Rate limit reached. Waiting ${Math.ceil(
        delayMs / 1000
      )} seconds before making request to ${url}`
    );
    // Update storage with nextAttemptTime if needed
    const nextAttemptTime = Date.now() + delayMs;
    await setToStorageLocal({ nextAttemptTime });
    // Notify popup about the delay
    if (popupPort) {
      popupPort.postMessage({
        action: 'uploadRetry',
        retryCount: 0,
        maxRetries: MAX_RETRIES,
        fileName,
        nextAttemptTime,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    // After waiting, retry
    return await makeApiRequest(url, options, fileName);
  }
}

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
  console.log(`[${new Date().toLocaleTimeString()}] Starting processing for: ${fileName}`);

  // Initialize upload state
  chrome.storage.local.set({
    fileName,
    percentComplete: 0,
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
      'premiumAccount',
    ]);

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

// Process the Actual Upload
async function processUpload(fileName, fileSize, fileData, credentials, startTime) {
  // Notify popup that checking has started
  if (popupPort) {
    popupPort.postMessage({
      action: 'checkingStarted',
      fileName,
    });
  }

  try {
    const apiKey = await decryptApiKey(credentials);

    const arrayBuffer = new Uint8Array(fileData).buffer;
    const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });

    const isPremium = credentials.premiumAccount || false;

    const estimatedCheckDuration = 2000; // Estimated time for computing hash and checking (2 seconds)

    console.log(
      `[${new Date().toLocaleTimeString()}] Estimated checking duration for ${fileName}: ${(
        estimatedCheckDuration / 1000
      ).toFixed(2)} seconds`
    );

    await simulateProgress(fileName, estimatedCheckDuration, startTime, 'Checking');

    const checkStartTime = Date.now();

    // Compute the SHA-256 hash of the file
    const fileHash = await computeSHA256(arrayBuffer);

    // Check if the file has already been analyzed
    const existingAnalysis = await checkExistingAnalysis(fileHash, apiKey, fileName);

    if (existingAnalysis) {
      console.log(
        `[${new Date().toLocaleTimeString()}] Existing analysis found for ${fileName}. Opening report.`
      );
      await handleExistingAnalysis(existingAnalysis, fileName, fileSize, startTime);
    } else {
      // Notify popup that upload is starting
      if (popupPort) {
        popupPort.postMessage({
          action: 'uploadStarted',
          fileName,
        });
      }

      // Proceed to upload the file
      const estimatedUploadDuration = (fileSize / AVERAGE_UPLOAD_SPEED) * 1000;

      console.log(
        `[${new Date().toLocaleTimeString()}] Estimated upload duration for ${fileName}: ${(
          estimatedUploadDuration / 1000
        ).toFixed(2)} seconds`
      );

      await simulateProgress(fileName, estimatedUploadDuration, startTime, 'Uploading');

      await uploadFile(blob, fileName, fileSize, apiKey, startTime);
    }
  } catch (error) {
    await handleUploadError(error, fileName, fileSize, 0, startTime, fileData);
  }
}

// Compute SHA-256 Hash
async function computeSHA256(arrayBuffer) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

// Check for Existing Analysis
async function checkExistingAnalysis(fileHash, apiKey, fileName) {
  const url = `https://www.virustotal.com/api/v3/files/${fileHash}`;
  const options = {
    method: 'GET',
    headers: {
      'x-apikey': apiKey,
    },
  };
  const response = await makeApiRequest(url, options, fileName);

  if (response.status === 200) {
    const resultData = await response.json();
    return resultData;
  } else if (response.status === 404) {
    // File not found, proceed to upload
    return null;
  } else {
    const responseText = await response.text();
    console.error(
      `[${new Date().toLocaleTimeString()}] Error checking existing analysis ${response.status}: ${responseText}`
    );
    throw new Error(`Error ${response.status}: ${response.statusText}`);
  }
}

// Handle Existing Analysis
async function handleExistingAnalysis(resultData, fileName, fileSize, startTime) {
  if (popupPort) {
    popupPort.postMessage({
      action: 'uploadProgress',
      percentComplete: 100,
      fileName,
    });
    // Optionally, send a message indicating completion
    popupPort.postMessage({
      action: 'uploadComplete',
      fileName,
    });
  }

  await clearUploadState();

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(
    `[${new Date().toLocaleTimeString()}] Retrieval complete for ${fileName}. Total time: ${totalTime} seconds.`
  );

  // Open the analysis URL
  const fileId = resultData.data.id;
  chrome.tabs.create({
    url: `https://www.virustotal.com/gui/file/${fileId}/detection`,
  });

  // Proceed to the next file in the queue
  isUploading = false;
  processUploadQueue();
}

// Upload File
async function uploadFile(blob, fileName, fileSize, apiKey, startTime) {
  let response;
  if (fileSize <= 32 * 1024 * 1024) {
    // File size <=32MB, upload directly to /api/v3/files
    const formData = new FormData();
    formData.append('file', blob, fileName);

    response = await makeApiRequest(
      'https://www.virustotal.com/api/v3/files',
      {
        method: 'POST',
        headers: {
          'x-apikey': apiKey,
        },
        body: formData,
      },
      fileName
    );
  } else {
    // File size >32MB, get upload URL first
    const uploadUrlResponse = await makeApiRequest(
      'https://www.virustotal.com/api/v3/files/upload_url',
      {
        method: 'GET',
        headers: {
          'x-apikey': apiKey,
        },
      },
      fileName
    );

    if (!uploadUrlResponse.ok) {
      const responseText = await uploadUrlResponse.text();
      console.error(
        `[${new Date().toLocaleTimeString()}] Error getting upload URL ${uploadUrlResponse.status}: ${responseText}`
      );
      throw new Error(`Error ${uploadUrlResponse.status}: ${uploadUrlResponse.statusText}`);
    }

    const uploadUrlData = await uploadUrlResponse.json();
    const uploadUrl = uploadUrlData.data;

    // Now upload the file to the uploadUrl
    const formData = new FormData();
    formData.append('file', blob, fileName);

    response = await makeApiRequest(
      uploadUrl,
      {
        method: 'POST',
        body: formData,
      },
      fileName
    );
  }

  await handleUploadResponse(response, fileName, fileSize, startTime);
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

// Simulate Progress Bar
async function simulateProgress(fileName, estimatedDuration, startTime, actionType) {
  const startTimeSimulate = Date.now();

  return new Promise((resolve) => {
    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - startTimeSimulate;
      const progress = Math.min(1, elapsed / estimatedDuration);

      const simulatedPercent = progress * 96; // Adjusted scaling to 96%

      setToStorageLocal({ percentComplete: simulatedPercent.toFixed(2) });

      if (popupPort) {
        popupPort.postMessage({
          action: 'uploadProgress',
          percentComplete: simulatedPercent.toFixed(2),
          fileName,
          actionType,
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
async function handleUploadResponse(response, fileName, fileSize, startTime) {
  try {
    if (!response.ok) {
      const responseText = await response.text();
      console.error(
        `[${new Date().toLocaleTimeString()}] Error ${response.status}: ${responseText}`
      );

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
      `[${new Date().toLocaleTimeString()}] Upload complete for ${fileName}. Total time: ${totalTime} seconds.`
    );

    // Open the analysis URL using the analysis ID
    const analysisId = resultData.data.id;
    chrome.tabs.create({
      url: `https://www.virustotal.com/gui/file-analysis/${analysisId}`,
    });

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
    const retryDelayMs = 60000; // 1 minute delay
    const nextAttemptTime = Date.now() + retryDelayMs;

    await setToStorageLocal({
      retryCount,
      nextAttemptTime,
    });

    console.log(
      `[${new Date().toLocaleTimeString()}] Retrying upload (${retryCount}/${MAX_RETRIES}) for ${fileName} after ${Math.ceil(
        retryDelayMs / 1000
      )} seconds.`
    );

    // Send the wait time to the popup
    if (popupPort) {
      popupPort.postMessage({
        action: 'uploadRetry',
        retryCount,
        maxRetries: MAX_RETRIES,
        fileName,
        nextAttemptTime,
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
    'retryCount',
    'nextAttemptTime',
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
      'retryCount',
      'nextAttemptTime',
    ]).then((data) => {
      if (data.fileName && popupPort) {
        if (data.uploadInProgress && data.percentComplete) {
          popupPort.postMessage({
            action: 'uploadProgress',
            percentComplete: data.percentComplete,
            fileName: data.fileName,
          });
        } else if (data.nextAttemptTime) {
          if (data.retryCount && data.nextAttemptTime) {
            popupPort.postMessage({
              action: 'uploadRetry',
              retryCount: data.retryCount,
              maxRetries: MAX_RETRIES,
              fileName: data.fileName,
              nextAttemptTime: data.nextAttemptTime,
            });
          }
        }
      }
    });

    port.onDisconnect.addListener(() => {
      popupPort = null;
    });
  }
});
