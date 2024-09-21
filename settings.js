document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const premiumAccountCheckbox = document.getElementById('premiumAccount');
  const saveButton = document.getElementById('saveButton');
  const closeButton = document.getElementById('closeButton');
  const donateButton = document.getElementById('donateButton');
  const messageDiv = document.getElementById('message');

  // Load the saved API key and premium account status
  chrome.storage.sync.get(['apiKey', 'premiumAccount'], function (result) {
    if (result.apiKey) {
      apiKeyInput.value = result.apiKey;
    }
    if (result.premiumAccount) {
      premiumAccountCheckbox.checked = result.premiumAccount;
    }
  });

  // Save the API key and premium account status
  saveButton.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    const premiumAccount = premiumAccountCheckbox.checked;

    chrome.storage.sync.set({ apiKey: apiKey, premiumAccount: premiumAccount }, function () {
      messageDiv.textContent = 'Settings saved successfully.';
      setTimeout(() => {
        messageDiv.textContent = '';
      }, 2000);
    });
  });

  // Close button: Close the settings page
  closeButton.addEventListener('click', () => {
    window.close(); // This will close the settings page in the extension
  });

  // Donate button: Open BuyMeACoffee link in a new tab
  donateButton.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://buymeacoffee.com/dubsector' });
  });
});
