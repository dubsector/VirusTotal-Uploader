document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const premiumAccountCheckbox = document.getElementById('premiumAccount');
  const saveButton = document.getElementById('saveButton');
  const closeButton = document.getElementById('closeButton');
  const donateButton = document.getElementById('donateButton');
  const messageDiv = document.getElementById('message');

  // Placeholder to indicate that an API key is stored
  const PLACEHOLDER = '************************************************************'; // 64 asterisks

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

  // Load the saved premium account status and API key placeholder
  chrome.storage.sync.get(['premiumAccount', 'apiKey'], function (result) {
    if (result.premiumAccount) {
      premiumAccountCheckbox.checked = result.premiumAccount;
    }

    if (result.apiKey) {
      apiKeyInput.value = PLACEHOLDER;
    }
  });

  // Save the API key and premium account status
  saveButton.addEventListener('click', async () => {
    const apiKeyValue = apiKeyInput.value.trim();
    const premiumAccount = premiumAccountCheckbox.checked;

    // Get the current stored API key data
    chrome.storage.sync.get(['apiKey', 'iv', 'encryptionKey'], async function (storedData) {
      let newApiKeyData = {};

      if (apiKeyValue === '') {
        // User cleared the password field, delete the stored API key
        newApiKeyData = {
          apiKey: null,
          iv: null,
          encryptionKey: null
        };
      } else if (apiKeyValue === PLACEHOLDER) {
        // User did not change the password field, keep existing API key
        newApiKeyData = {
          apiKey: storedData.apiKey,
          iv: storedData.iv,
          encryptionKey: storedData.encryptionKey
        };
      } else {
        // User entered a new API key, encrypt and store it
        try {
          const encryptionKey = await getEncryptionKey(); // Generate a new encryption key
          const { encryptedData, iv } = await encryptText(apiKeyValue, encryptionKey);

          // Export the encryption key to a storable format
          const rawKey = await exportKey(encryptionKey);

          newApiKeyData = {
            apiKey: Array.from(encryptedData),
            iv: Array.from(iv),
            encryptionKey: Array.from(new Uint8Array(rawKey))
          };
        } catch (error) {
          console.error('Error encrypting the API key:', error);
          messageDiv.textContent = 'Failed to save settings.';
          return; // Exit the function
        }
      }

      // Save the new data
      chrome.storage.sync.set({
        ...newApiKeyData,
        premiumAccount: premiumAccount
      }, function () {
        messageDiv.textContent = 'Settings saved successfully.';
        setTimeout(() => {
          messageDiv.textContent = '';
        }, 2000);
      });
    });
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
