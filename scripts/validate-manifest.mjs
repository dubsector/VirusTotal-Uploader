// Sanity-checks manifest.json against Chrome MV3 expectations and keeps its
// version in sync with package.json so releases can't drift apart.

import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

const errors = [];

if (manifest.manifest_version !== 3) {
  errors.push('manifest_version must be 3');
}
if (manifest.version !== pkg.version) {
  errors.push(`version mismatch: manifest ${manifest.version} vs package ${pkg.version}`);
}
if (!manifest.background?.service_worker) {
  errors.push('background.service_worker is required');
}
if (manifest.background?.type !== 'module') {
  errors.push('background.type must be "module" (ES module service worker)');
}
if (!Array.isArray(manifest.permissions) || manifest.permissions.includes('tabs')) {
  errors.push('permissions should be minimal and must not include "tabs"');
}

if (errors.length > 0) {
  console.error('manifest.json validation failed:\n- ' + errors.join('\n- '));
  process.exit(1);
}

console.log(`manifest.json OK (v${manifest.version})`);
