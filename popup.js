document.getElementById('settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('fileInput').addEventListener('change', function () {
  const fileInput = document.getElementById('fileInput');
  const statusDiv = document.getElementById('status');
  const errorDiv = document.getElementById('error');
  const progressContainer = document.getElementById('progressContainer');
  const progressBar = document.getElementById('progressBar');
  statusDiv.textContent = '';
  errorDiv.textContent = '';
  progressBar.style.width = '0%';
  progressContainer.style.display = 'none';

  if (fileInput.files.length === 0) {
    errorDiv.textContent = 'Please select a file to upload.';
    return;
  }

  const file = fileInput.files[0];

  // Check if API key is set
  chrome.storage.sync.get(['apiKey'], async function (result) {
    if (!result.apiKey) {
      errorDiv.textContent = 'Please set your API key in the settings.';
      return;
    }

    const apiKey = result.apiKey;

    // Show the progress bar
    progressContainer.style.display = 'block';

    // Read the file as an ArrayBuffer
    const reader = new FileReader();

    reader.onload = function (e) {
      const arrayBuffer = e.target.result;

      // Create a Blob from the ArrayBuffer
      const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });

      // Create FormData
      const formData = new FormData();
      formData.append('file', blob, file.name);
      formData.append('apikey', apiKey);

      // Perform the upload using XMLHttpRequest
      const xhr = new XMLHttpRequest();
      xhr.open('POST', 'https://www.virustotal.com/vtapi/v2/file/scan');

      xhr.upload.onprogress = function (event) {
        if (event.lengthComputable) {
          const percentComplete = ((event.loaded / event.total) * 100).toFixed(2);
          progressBar.style.width = percentComplete + '%';
          statusDiv.textContent = `Uploading... ${percentComplete}%`;
        }
      };

      xhr.onload = function () {
        console.log('Upload completed with status:', xhr.status);
        console.log('Response:', xhr.responseText);

        if (xhr.status === 200) {
          const result = JSON.parse(xhr.responseText);

          // Open the scan results page automatically
          const resultsUrl = `https://www.virustotal.com/gui/file/${result.sha256}/detection`;
          chrome.tabs.create({ url: resultsUrl });

          statusDiv.textContent = 'Upload complete. Opening report...';

          // Close the popup after a short delay
          setTimeout(() => {
            window.close();
          }, 2000);
        } else {
          const errorMessage = `Error ${xhr.status}: ${xhr.statusText}`;
          console.error(errorMessage);
          errorDiv.textContent = `${errorMessage}\n${xhr.responseText}`;
        }
      };

      xhr.onerror = function () {
        console.error('Upload error:', xhr.statusText);
        errorDiv.textContent = `An error occurred during the upload: ${xhr.statusText}`;
      };

      xhr.send(formData);
    };

    reader.onerror = function () {
      errorDiv.textContent = 'Error reading file.';
    };

    reader.onprogress = function (e) {
      if (e.lengthComputable) {
        const percentComplete = ((e.loaded / e.total) * 100).toFixed(2);
        progressBar.style.width = percentComplete + '%';
        statusDiv.textContent = `Reading file... ${percentComplete}%`;
      }
    };

    reader.readAsArrayBuffer(file);
  });
});