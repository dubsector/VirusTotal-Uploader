
document.addEventListener('DOMContentLoaded', function () {
  const fileInput = document.getElementById('fileInput');
  const statusDiv = document.getElementById('status');
  const errorDiv = document.getElementById('error');
  const progressContainer = document.getElementById('progressContainer');
  const progressBar = document.getElementById('progressBar');

  // Check if there's any ongoing upload progress and retrieve the filename when the popup opens
  chrome.storage.local.get(['percentComplete', 'uploadInProgress', 'fileName'], function (result) {
    if (result.uploadInProgress) {
      progressContainer.style.display = 'block';
      progressBar.style.width = `${result.percentComplete}%`;
      statusDiv.textContent = `Uploading ${result.fileName}... ${result.percentComplete}%`;
    }
  });

  fileInput.addEventListener('change', function () {
    if (fileInput.files.length === 0) {
      errorDiv.textContent = 'Please select a file to upload.';
      return;
    }

    const file = fileInput.files[0];

    // Check if API key is set
    chrome.storage.sync.get(['apiKey'], function (result) {
      if (!result.apiKey) {
        errorDiv.textContent = 'Please set your API key in the settings.';
        return;
      }

      const apiKey = result.apiKey;

      // Send the file data to the background script immediately
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
        statusDiv.textContent = `Uploading ${file.name}... 0%`;
      };
      reader.readAsArrayBuffer(file);
    });
  });

  // Listen for updates from the background script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'uploadProgress') {
      progressBar.style.width = `${message.percentComplete}%`;
      statusDiv.textContent = `Uploading ${message.fileName}... ${message.percentComplete}%`;
    } else if (message.action === 'uploadComplete') {
      chrome.tabs.create({ url: message.resultsUrl });
      statusDiv.textContent = 'Upload complete!';
      progressContainer.style.display = 'none';
    } else if (message.action === 'uploadError') {
      errorDiv.textContent = `Upload failed: ${message.error}`;
    }
  });

  // Open settings on gear icon click
  document.getElementById('settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
});
