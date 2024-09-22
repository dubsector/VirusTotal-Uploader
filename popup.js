// popup.js

document.addEventListener('DOMContentLoaded', function () {
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
        errorDiv.innerHTML = `Some files exceed the ${limitMB} limit and will not be uploaded.`;
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
          chrome.runtime.sendMessage({
            action: 'queueFile',
            fileName: file.name,
            fileSize: file.size,
            fileData: Array.from(new Uint8Array(arrayBuffer))
          });
        };
        reader.readAsArrayBuffer(file);
      });

      // Reset file input
      fileInput.value = '';

      // **Modification Start**
      // Before resetting UI elements, check if there's an upload in progress or waiting
      chrome.storage.local.get(['uploadInProgress', 'waitingForNextUpload'], (data) => {
        if (!data.uploadInProgress && !data.waitingForNextUpload) {
          // Show initial status if no upload is in progress or waiting
          progressContainer.style.display = 'block';
          progressBar.style.width = '0%';
          progressBar.style.display = 'block';  // Reset and show the progress bar
          statusDiv.textContent = `Files queued for upload.`;
          progressBar.style.backgroundColor = ''; // Reset color to default
        } else {
          // If an upload is in progress or waiting, do not reset the UI elements
          statusDiv.textContent = `Files queued for upload. Current upload in progress.`;
        }
      });
      // **Modification End**
    });
  });

  document.getElementById('settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Connect to the background script for live updates
  const port = chrome.runtime.connect({ name: "popup" });

  let countdownInterval = null;

  // Fetch the saved progress or waiting state when the popup opens
  chrome.storage.local.get(['uploadInProgress', 'percentComplete', 'fileName', 'waitingForNextUpload', 'retryCount', 'nextUploadTime', 'nextAttemptTime'], (data) => {
    // Only update UI after data retrieval
    if (data.uploadInProgress && data.percentComplete && data.fileName) {
      // Show upload progress
      progressContainer.style.display = 'block';
      progressBar.style.width = `${data.percentComplete}%`;
      statusDiv.textContent = `Uploading ${data.fileName}... ${data.percentComplete}%`;
      progressBar.style.backgroundColor = ''; // Reset color to default
    } else if (data.waitingForNextUpload && data.fileName) {
      // Show waiting state
      progressContainer.style.display = 'block';

      if (data.retryCount && data.retryCount > 0) {
        // Handle retry waiting state
        let scheduledTime = parseInt(data.nextAttemptTime, 10);
        statusDiv.textContent = `Retry ${data.retryCount} of ${maxRetries} for ${data.fileName} in ... seconds.`;
        progressBar.style.backgroundColor = 'yellow'; // Change to yellow during waiting
        progressBar.style.width = '100%'; // Ensure the progress bar is fully yellow
        startCountdown(scheduledTime, `Retry ${data.retryCount} of ${maxRetries} for ${data.fileName}`);
      } else {
        if (data.nextUploadTime) {
          let scheduledTime = parseInt(data.nextUploadTime, 10);
          statusDiv.textContent = `Waiting to upload ${data.fileName} in ... seconds.`;
          startCountdown(scheduledTime, `Waiting to upload ${data.fileName}`);
        } else {
          statusDiv.textContent = `Waiting to upload ${data.fileName}...`;
        }
        progressBar.style.backgroundColor = 'yellow'; // Change to yellow during waiting
        progressBar.style.width = '100%'; // Ensure the progress bar is fully yellow
      }
    } else {
      // No ongoing upload
      progressContainer.style.display = 'none';
      statusDiv.textContent = '';
    }
  });

  // Listen for real-time updates from the background script
  port.onMessage.addListener((message) => {
    if (message.action === 'uploadRetry') {
      // Handle retry state
      progressContainer.style.display = 'block';
      progressBar.style.width = '100%'; // Ensure the progress bar is fully yellow
      progressBar.style.backgroundColor = 'yellow'; // Change to yellow during waiting

      let scheduledTime = parseInt(message.nextAttemptTime, 10);
      statusDiv.textContent = `Retry ${message.retryCount} of ${message.maxRetries} for ${message.fileName} in ... seconds.`;
      startCountdown(scheduledTime, `Retry ${message.retryCount} of ${message.maxRetries} for ${message.fileName}`);
    } else if (message.action === 'uploadProgress') {
      // Handle upload progress
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
      progressContainer.style.display = 'block';
      progressBar.style.width = `${message.percentComplete}%`;
      statusDiv.textContent = `Uploading ${message.fileName}... ${message.percentComplete}%`;
      progressBar.style.backgroundColor = ''; // Reset to default color during actual upload
    } else if (message.action === 'waitingForNextUpload') {
      // Handle waiting state
      progressContainer.style.display = 'block';
      progressBar.style.width = '100%'; // Show the bar as full to indicate waiting
      progressBar.style.backgroundColor = 'yellow'; // Change to yellow during waiting

      let scheduledTime = parseInt(message.nextUploadTime, 10);
      statusDiv.textContent = `Waiting to upload ${message.fileName} in ... seconds.`;
      startCountdown(scheduledTime, `Waiting to upload ${message.fileName}`);
    } else if (message.action === 'uploadStarted') {
      // Upload has started
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
      progressContainer.style.display = 'block';
      progressBar.style.width = '0%';
      progressBar.style.backgroundColor = ''; // Reset to default color
      statusDiv.textContent = `Uploading ${message.fileName}... 0%`;
    } else if (message.action === 'uploadComplete') {
      // Handle upload completion
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
      statusDiv.textContent = `Upload complete for ${message.fileName} (100%)`;
      progressBar.style.display = 'none';

      // **New: Display a link to view the results**
      const resultLink = document.createElement('a');
      resultLink.href = `https://www.virustotal.com/gui/file/${message.sha256}/detection`;
      resultLink.textContent = 'View Results';
      resultLink.target = '_blank';
      errorDiv.innerHTML = ''; // Clear previous errors
      statusDiv.appendChild(document.createElement('br')); // Line break
      statusDiv.appendChild(resultLink);
    } else if (message.action === 'uploadError') {
      // Handle upload error
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
      errorDiv.textContent = `Upload failed: ${message.error}`;
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
        statusDiv.textContent = `Uploading...`;
        progressBar.style.backgroundColor = ''; // Reset to default color
      } else {
        statusDiv.textContent = `${statusPrefix} in ${remainingTime} seconds.`;
      }
    }, 1000);
  }
});
