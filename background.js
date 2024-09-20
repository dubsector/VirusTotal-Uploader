chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'uploadFile') {
    const { fileName, fileData, apiKey } = message;

    try {
      // Recreate the ArrayBuffer from the serialized Uint8Array
      const arrayBuffer = new Uint8Array(fileData).buffer;

      // Convert ArrayBuffer to Blob
      const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });

      // Simulate progress bar updates
      const fileSize = blob.size;
      const uploadStartTime = Date.now();
      let simulationInterval;

      // Create FormData to attach the Blob
      const formData = new FormData();
      formData.append('file', blob, fileName);
      formData.append('apikey', apiKey);

      // Indicate that the upload is in progress and store progress along with the filename
      chrome.storage.local.set({ uploadInProgress: true, percentComplete: 0, fileName });

      // Use a slower simulation to better match real upload times
      const simulateProgress = () => {
        const elapsedTime = Date.now() - uploadStartTime;
        let simulatedPercent = Math.min(95, (elapsedTime / 15000) * 100);  // Simulate over 15 seconds

        // Update progress in chrome.storage
        chrome.storage.local.set({ percentComplete: simulatedPercent.toFixed(2) });

        // Try to send the progress update to the popup if it's open
        chrome.runtime.sendMessage({ action: 'uploadProgress', percentComplete: simulatedPercent.toFixed(2), fileName }).catch((error) => {
          // Suppress error if the popup is not open
          console.log("Popup not open, but progress continues:", error);
        });

        if (simulatedPercent < 95) {
          simulationInterval = setTimeout(simulateProgress, 300);  // Continue updating progress every 300ms
        }
      };

      simulateProgress();  // Start simulating progress

      // Function to handle retries
      const handleRetry = (retryCount) => {
        if (retryCount > 0) {
          console.log(`Retrying upload... Attempts remaining: ${retryCount}`);
          fetch('https://www.virustotal.com/vtapi/v2/file/scan', {
            method: 'POST',
            body: formData
          }).then(response => {
            if (response.ok) {
              return response.json();
            } else {
              throw new Error(`Error ${response.status}: ${response.statusText}`);
            }
          }).then(result => {
            const resultsUrl = `https://www.virustotal.com/gui/file/${result.sha256}/detection`;

            // Stop the simulation and finalize progress to 100%
            clearTimeout(simulationInterval);  // Stop the progress simulation
            chrome.storage.local.set({ percentComplete: 100 });
            chrome.runtime.sendMessage({ action: 'uploadProgress', percentComplete: 100, fileName }).catch((error) => {
              console.log("Popup not open, but upload complete:", error);
            });

            // Clear stored progress and notify completion
            setTimeout(() => {
              // Clear all stored data related to the upload
              chrome.storage.local.remove(['percentComplete', 'uploadInProgress', 'fileName'], () => {
                console.log('Progress and status cleared after completion');
              });

              // Always attempt to open the report, regardless of whether the popup is open or closed
              chrome.runtime.sendMessage({ action: 'uploadComplete', resultsUrl }).catch((error) => {
                console.log("Popup not open to show completion:", error);
              });

              // Open the report directly regardless of the popup state
              chrome.tabs.create({ url: resultsUrl }, () => {
                console.log("Report opened successfully");
              });
            }, 1000);  // Give a small delay before final completion
          }).catch(error => {
            clearTimeout(simulationInterval);  // Stop the simulation on error
            chrome.runtime.sendMessage({ action: 'uploadError', error: error.message }).catch((error) => {
              console.log("Popup not open to show error:", error);
            });
            handleRetry(retryCount - 1);  // Retry on error
          });
        } else {
          console.log("All retry attempts failed.");
        }
      };

      // Start upload with retries (3 retry attempts)
      handleRetry(3);

    } catch (err) {
      console.error('Error during upload process:', err);
      chrome.runtime.sendMessage({ action: 'uploadError', error: err.message }).catch((error) => {
        console.log("Popup not open to show error:", error);
      });
    }
  }
});
