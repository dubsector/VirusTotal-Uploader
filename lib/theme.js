// Theme handling. 'system' (default) follows the OS/browser via the CSS
// prefers-color-scheme query; 'light' and 'dark' force a mode by setting
// data-theme on <html>, which the stylesheet uses to override the query.

import { getSync } from './storage.js';

export function applyTheme(mode) {
  document.documentElement.dataset.theme = mode || 'system';
}

export async function initTheme() {
  const { theme } = await getSync(['theme']);
  applyTheme(theme || 'system');
}
