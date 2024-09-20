
document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const saveButton = document.getElementById('saveButton');
  const messageDiv = document.getElementById('message');
  const donateButton = document.getElementById('donateButton');
  const closeButton = document.getElementById('closeButton');

  // Load the saved API key
  chrome.storage.sync.get(['apiKey'], function (result) {
    if (result.apiKey) {
      apiKeyInput.value = result.apiKey;
    }
  });

  // Save the API key
  saveButton.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    if (apiKey) {
      chrome.storage.sync.set({ apiKey: apiKey }, function () {
        messageDiv.textContent = 'API key saved successfully.';
        setTimeout(() => {
          messageDiv.textContent = '';
        }, 2000);
      });
    } else {
      messageDiv.textContent = 'Please enter a valid API key.';
    }
  });

  // Donate button: Open BuyMeACoffee link in a new tab
  donateButton.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://buymeacoffee.com/dubsector' });
  });

  // Close button: Close the settings page
  closeButton.addEventListener('click', () => {
    window.close();
  });
});
