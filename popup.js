// popup.js

document.addEventListener('DOMContentLoaded', async function () {
  // Initialize IndexedDB
  await initializeIndexedDB();

  const fileInput = document.getElementById('fileInput');
  const statusDiv = document.getElementById('status');
  const errorDiv = document.getElementById('error');
  const progressContainer = document.getElementById('progressContainer');
  const progressBar = document.getElementById('progressBar');

  const freeLimit = 32 * 1024 * 1024; // 32 MB
  const premiumLimit = 550 * 1024 * 1024; // 550 MB
  const maxRetries = 3; // Ensure this matches the value in background.js

  // Initialize UI elements to default hidden state
  progressContainer.style.display = 'none';
  progressBar.style.width = '0%';
  progressBar.style.backgroundColor = '';
  statusDiv.textContent = '';
  errorDiv.textContent = '';

  fileInput.addEventListener('change', function () {
    errorDiv.textContent = ''; // Clear any previous errors
    statusDiv.textContent = ''; // Clear any previous status messages

    if (fileInput.files.length === 0) {
      errorDiv.textContent = 'Please select files to upload.';
      return;
    }

    const files = Array.from(fileInput.files);

    chrome.storage.sync.get(['apiKey', 'premiumAccount'], function (result) {
      if (!result.apiKey) {
        errorDiv.textContent = 'Please set your API key in the settings.';
        return;
      }

      const premiumAccount = result.premiumAccount || false;
      const fileLimit = premiumAccount ? premiumLimit : freeLimit;

      // Filter out files that exceed the size limit
      const validFiles = files.filter(file => file.size <= fileLimit);
      const oversizedFiles = files.filter(file => file.size > fileLimit);

      if (oversizedFiles.length > 0) {
        const limitMB = premiumAccount ? '550MB' : '32MB';
        errorDiv.textContent = `Some files exceed the ${limitMB} limit and will not be uploaded.`;
      }

      if (validFiles.length === 0) {
        errorDiv.textContent = 'No files to upload within the size limit.';
        return;
      }

      // Order the new files by size (smallest to largest)
      validFiles.sort((a, b) => a.size - b.size);

      validFiles.forEach(file => {
        const reader = new FileReader();
        reader.onload = function(event) {
          const arrayBuffer = event.target.result;

          // Save file data into IndexedDB
          saveFileDataToIndexedDB(file.name, Array.from(new Uint8Array(arrayBuffer)))
            .then(() => {
              // Send message to background script to queue the file
              chrome.runtime.sendMessage({
                action: 'queueFile',
                fileName: file.name,
                fileSize: file.size
              });
            })
            .catch(error => {
              console.error('Failed to save file data to IndexedDB:', error);
              errorDiv.textContent = 'Failed to save file data.';
            });
        };
        reader.readAsArrayBuffer(file);
      });

      // Reset file input
      fileInput.value = '';

      // Check if there's an upload in progress or waiting
      chrome.storage.local.get(['uploadInProgress', 'nextAttemptTime'], (data) => {
        if (!data.uploadInProgress && !data.nextAttemptTime) {
          // Show initial status if no upload is in progress or waiting
          progressContainer.style.display = 'block';
          progressBar.style.width = '0%';
          progressBar.style.display = 'block';  // Reset and show the progress bar
          statusDiv.textContent = 'Files queued for processing.';
          progressBar.style.backgroundColor = ''; // Reset color to default
        } else {
          // If an upload is in progress or waiting, do not reset the UI elements
          statusDiv.textContent = 'Files queued for processing. Current operation in progress.';
        }
      });
    });
  });

  document.getElementById('settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Connect to the background script for live updates
  const port = chrome.runtime.connect({ name: "popup" });

  let countdownInterval = null;

  // Fetch the saved progress or waiting state when the popup opens
  chrome.storage.local.get(['uploadInProgress', 'percentComplete', 'fileName', 'retryCount', 'nextAttemptTime'], (data) => {
    // Only update UI after data retrieval
    if (data.uploadInProgress && data.percentComplete && data.fileName) {
      // Show progress
      progressContainer.style.display = 'block';
      progressBar.style.width = `${data.percentComplete}%`;
      statusDiv.textContent = `Processing ${data.fileName}... ${data.percentComplete}%`;
      progressBar.style.backgroundColor = ''; // Reset color to default
    } else if (data.nextAttemptTime && data.fileName) {
      // Show waiting state
      progressContainer.style.display = 'block';
      let scheduledTime = parseInt(data.nextAttemptTime, 10);
      progressBar.style.backgroundColor = 'yellow'; // Change to yellow during waiting
      progressBar.style.width = '100%'; // Ensure the progress bar is fully yellow

      statusDiv.textContent = `Waiting to process ${data.fileName} in ... seconds.`;
      startCountdown(scheduledTime, `Waiting to process ${data.fileName}`);
    } else {
      // No ongoing operation
      progressContainer.style.display = 'none';
      statusDiv.textContent = '';
    }
  });

  // Listen for real-time updates from the background script
  port.onMessage.addListener((message) => {
    if (message.action === 'uploadRetry') {
      // Handle waiting state
      progressContainer.style.display = 'block';
      progressBar.style.width = '100%'; // Ensure the progress bar is fully yellow
      progressBar.style.backgroundColor = 'yellow'; // Change to yellow during waiting

      let scheduledTime = parseInt(message.nextAttemptTime, 10);

      if (message.retryCount === 0) {
        // Waiting due to rate limiting
        statusDiv.textContent = `Waiting to process ${message.fileName} in ... seconds.`;
        startCountdown(scheduledTime, `Waiting to process ${message.fileName}`);
      } else {
        // Waiting due to retry after error
        statusDiv.textContent = `Retry ${message.retryCount} of ${message.maxRetries} for ${message.fileName} in ... seconds.`;
        startCountdown(scheduledTime, `Retry ${message.retryCount} of ${message.maxRetries} for ${message.fileName}`);
      }
    } else if (message.action === 'uploadProgress') {
      // Handle progress
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
      progressContainer.style.display = 'block';
      progressBar.style.width = `${message.percentComplete}%`;
      let actionType = message.actionType || 'Processing';
      statusDiv.textContent = `${actionType} ${message.fileName}... ${message.percentComplete}%`;
      progressBar.style.backgroundColor = ''; // Reset to default color during actual processing
    } else if (message.action === 'uploadStarted' || message.action === 'checkingStarted') {
      // Operation has started
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
      progressContainer.style.display = 'block';
      progressBar.style.width = '0%';
      progressBar.style.backgroundColor = ''; // Reset to default color
      let actionType = message.action === 'checkingStarted' ? 'Checking' : 'Uploading';
      statusDiv.textContent = `${actionType} ${message.fileName}... 0%`;
    } else if (message.action === 'uploadComplete') {
      // Handle completion
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
      statusDiv.textContent = `Completed for ${message.fileName} (100%)`;
      progressBar.style.display = 'none';
    } else if (message.action === 'uploadError') {
      // Handle error
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
      errorDiv.textContent = `Operation failed: ${message.error}`;
      progressBar.style.display = 'none';
    }
  });

  port.onDisconnect.addListener(() => {
    if (countdownInterval) {
      clearInterval(countdownInterval);
    }
    port.disconnect();
  });

  function startCountdown(scheduledTime, statusPrefix) {
    if (countdownInterval) {
      clearInterval(countdownInterval);
    }

    // Update the status immediately
    let remainingTimeMs = scheduledTime - Date.now();
    let remainingTime = Math.ceil(remainingTimeMs / 1000);
    statusDiv.textContent = `${statusPrefix} in ${remainingTime} seconds.`;

    countdownInterval = setInterval(() => {
      remainingTimeMs = scheduledTime - Date.now();
      remainingTime = Math.ceil(remainingTimeMs / 1000);
      if (remainingTime <= 0) {
        clearInterval(countdownInterval);
        countdownInterval = null;
        statusDiv.textContent = 'Processing...';
        progressBar.style.backgroundColor = ''; // Reset to default color
      } else {
        statusDiv.textContent = `${statusPrefix} in ${remainingTime} seconds.`;
      }
    }, 1000);
  }

  // Function to save file data to IndexedDB
  function saveFileDataToIndexedDB(fileName, fileData) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['files'], 'readwrite');
      const objectStore = transaction.objectStore('files');
      const request = objectStore.put({ fileName, fileData });

      request.onsuccess = function () {
        resolve();
      };

      request.onerror = function (event) {
        reject(event.target.error);
      };
    });
  }

  // Initialize IndexedDB
  function initializeIndexedDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('VirusTotalUploaderDB', 1);

      request.onupgradeneeded = function (event) {
        db = event.target.result;
        // Create an object store for files with auto-incrementing keys
        const objectStore = db.createObjectStore('files', { keyPath: 'fileName' });
        objectStore.createIndex('fileName', 'fileName', { unique: true });
      };

      request.onsuccess = function (event) {
        db = event.target.result;
        resolve();
      };

      request.onerror = function (event) {
        console.error('IndexedDB error:', event.target.errorCode);
        reject(event.target.errorCode);
      };
    });
  }
});
