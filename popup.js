document.addEventListener('DOMContentLoaded', function () {
  const fileInput = document.getElementById('fileInput');
  const statusDiv = document.getElementById('status');
  const errorDiv = document.getElementById('error');
  const progressContainer = document.getElementById('progressContainer');
  const progressBar = document.getElementById('progressBar');

  // File size limits
  const freeLimit = 32 * 1024 * 1024; // 32 MB
  const premiumLimit = 550 * 1024 * 1024; // 550 MB

  fileInput.addEventListener('change', function () {
    if (fileInput.files.length === 0) {
      errorDiv.textContent = 'Please select a file to upload.';
      return;
    }

    const file = fileInput.files[0];

    // Check if API key is set and get the premium account status
    chrome.storage.sync.get(['apiKey', 'premiumAccount'], function (result) {
      if (!result.apiKey) {
        errorDiv.textContent = 'Please set your API key in the settings.';
        return;
      }

      const apiKey = result.apiKey;
      const premiumAccount = result.premiumAccount || false;
      const fileLimit = premiumAccount ? premiumLimit : freeLimit;

      // Check if the file exceeds the allowed size
      if (file.size > fileLimit) {
        const limitMB = premiumAccount ? '550MB' : '32MB';
        errorDiv.innerHTML = `File size exceeds the ${limitMB} limit. <a href="https://www.virustotal.com/gui/home/upload" target="_blank">Upload larger files here</a>.`;
        return;
      }

      // Proceed with the upload if file size is valid
      const reader = new FileReader();
      reader.onload = function(event) {
        const arrayBuffer = event.target.result;
        chrome.runtime.sendMessage({
          action: 'uploadFile',
          fileName: file.name,
          fileData: Array.from(new Uint8Array(arrayBuffer)),
          apiKey: apiKey
        });

        // Show progress container and reset the progress bar
        progressContainer.style.display = 'block';
        progressBar.style.width = '0%';
        progressBar.style.display = 'block';  // Reset and show the progress bar
        statusDiv.textContent = `Uploading ${file.name}... 0%`;
      };
      reader.readAsArrayBuffer(file);
    });
  });

  // Ensure the settings gear icon can open the settings page
  document.getElementById('settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Listen for messages from the background script (handle real progress updates)
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'uploadProgress') {
      progressBar.style.width = `${message.percentComplete}%`;
      statusDiv.textContent = `Uploading ${message.fileName}... ${message.percentComplete}%`;
    } else if (message.action === 'uploadComplete') {
      chrome.tabs.create({ url: message.resultsUrl });
      statusDiv.textContent = `Upload complete for ${message.fileName} (100%)`;

      // Hide the progress bar once the upload is complete
      progressBar.style.display = 'none';
    } else if (message.action === 'uploadError') {
      errorDiv.textContent = `Upload failed: ${message.error}`;
    }
  });
});
