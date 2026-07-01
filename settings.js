import { getSync, setSync, getLocal, setLocal, removeLocal } from './lib/storage.js';
import { applyTheme } from './lib/theme.js';

const apiKeyInput = document.getElementById('apiKey');
const premiumCheckbox = document.getElementById('premiumAccount');
const themeRadios = document.querySelectorAll('input[name="theme"]');
const saveButton = document.getElementById('saveButton');
const closeButton = document.getElementById('closeButton');
const donateButton = document.getElementById('donateButton');
const messageDiv = document.getElementById('message');

// Shown in place of the real key when one is already stored, so we never
// surface the key and can tell "unchanged" from "cleared".
const PLACEHOLDER = '••••••••••••••••••••••••••••••••';

let hasStoredKey = false;

function selectedTheme() {
  const checked = document.querySelector('input[name="theme"]:checked');
  return checked ? checked.value : 'system';
}

Promise.all([getLocal(['apiKey']), getSync(['premiumAccount', 'theme'])]).then(
  ([local, sync]) => {
    premiumCheckbox.checked = Boolean(sync.premiumAccount);
    const theme = sync.theme || 'system';
    const radio = document.querySelector(`input[name="theme"][value="${theme}"]`);
    if (radio) radio.checked = true;
    applyTheme(theme);
    if (local.apiKey) {
      hasStoredKey = true;
      apiKeyInput.value = PLACEHOLDER;
    }
  }
);

// Live-preview the theme as it's picked, before saving.
themeRadios.forEach((radio) =>
  radio.addEventListener('change', () => applyTheme(selectedTheme()))
);

saveButton.addEventListener('click', async () => {
  const value = apiKeyInput.value.trim();

  try {
    // The key is device-local and never synced. See lib/storage.js note.
    if (value === '') {
      await removeLocal(['apiKey']);
      hasStoredKey = false;
    } else if (value !== PLACEHOLDER || !hasStoredKey) {
      await setLocal({ apiKey: value });
      hasStoredKey = true;
      apiKeyInput.value = PLACEHOLDER;
    }

    await setSync({ premiumAccount: premiumCheckbox.checked, theme: selectedTheme() });
    flash('Settings saved.');
  } catch {
    flash('Could not save settings.', true);
  }
});

closeButton.addEventListener('click', () => window.close());
donateButton.addEventListener('click', () =>
  chrome.tabs.create({ url: 'https://buymeacoffee.com/dubsector' })
);

let flashTimer = null;
function flash(text, isError = false) {
  messageDiv.textContent = text;
  messageDiv.classList.toggle('error', isError);
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    messageDiv.textContent = '';
  }, 2500);
}
