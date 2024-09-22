document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const premiumAccountCheckbox = document.getElementById('premiumAccount');
  const saveButton = document.getElementById('saveButton');
  const closeButton = document.getElementById('closeButton');
  const donateButton = document.getElementById('donateButton');
  const messageDiv = document.getElementById('message');

  // Function to generate an AES-GCM key dynamically
  async function getEncryptionKey() {
    return await window.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  }

  // Function to export the key to a format we can store
  async function exportKey(key) {
    return await window.crypto.subtle.exportKey('raw', key);
  }

  // Function to encrypt the API key
  async function encryptText(text, key) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 12 bytes IV for AES-GCM
    const encryptedData = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, data);
    return { encryptedData: new Uint8Array(encryptedData), iv };
  }

  // Load the saved premium account status (we no longer load the API key)
  chrome.storage.sync.get(['premiumAccount'], function (result) {
    if (result.premiumAccount) {
      premiumAccountCheckbox.checked = result.premiumAccount;
    }
  });

  // Save the API key and premium account status
  saveButton.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    const premiumAccount = premiumAccountCheckbox.checked;

    try {
      const encryptionKey = await getEncryptionKey(); // Generate a new encryption key
      const { encryptedData, iv } = await encryptText(apiKey, encryptionKey);

      // Export the encryption key to a storable format
      const rawKey = await exportKey(encryptionKey);

      // Save encrypted data, IV, and the encryption key
      chrome.storage.sync.set({
        apiKey: Array.from(encryptedData),
        iv: Array.from(iv),
        premiumAccount: premiumAccount,
        encryptionKey: Array.from(new Uint8Array(rawKey)) // Save the exported key
      }, function () {
        messageDiv.textContent = 'Settings saved successfully.';
        setTimeout(() => {
          messageDiv.textContent = '';
        }, 2000);
      });
    } catch (error) {
      console.error('Error encrypting the API key:', error);
      messageDiv.textContent = 'Failed to save settings.';
    }
  });

  // Close button: Close the settings page
  closeButton.addEventListener('click', () => {
    window.close();
  });

  // Donate button: Open BuyMeACoffee link in a new tab
  donateButton.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://buymeacoffee.com/dubsector' });
  });
});
