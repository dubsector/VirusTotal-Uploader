import { getSync, setSync } from './lib/storage.js';
import { applyTheme } from './lib/theme.js';

const notifyToggle = document.getElementById('notifyToggle');
const themeRadios = document.querySelectorAll('input[name="theme"]');
const saveButton = document.getElementById('saveButton');
const closeButton = document.getElementById('closeButton');
const donateButton = document.getElementById('donateButton');
const messageDiv = document.getElementById('message');

function selectedTheme() {
  const checked = document.querySelector('input[name="theme"]:checked');
  return checked ? checked.value : 'system';
}

getSync(['theme', 'notify']).then((sync) => {
  notifyToggle.checked = sync.notify !== false; // default on
  const theme = sync.theme || 'system';
  const radio = document.querySelector(`input[name="theme"][value="${theme}"]`);
  if (radio) radio.checked = true;
  applyTheme(theme);
});

// Live-preview the theme as it's picked, before saving.
themeRadios.forEach((radio) =>
  radio.addEventListener('change', () => applyTheme(selectedTheme()))
);

saveButton.addEventListener('click', async () => {
  try {
    await setSync({ notify: notifyToggle.checked, theme: selectedTheme() });
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
