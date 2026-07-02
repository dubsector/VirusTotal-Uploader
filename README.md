<div align="center">

# VirusTotal Uploader

One click from your toolbar to a [VirusTotal](https://www.virustotal.com/) scan — no API key, no quota.

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/ofpejkncbelgldkaimdoakjegifjeljj?label=Chrome%20Web%20Store)](https://chromewebstore.google.com/detail/virustotal-uploader/ofpejkncbelgldkaimdoakjegifjeljj)
[![GitHub Releases](https://img.shields.io/github/release/dubsector/VirusTotal-Uploader.svg?label=Releases)](https://github.com/dubsector/VirusTotal-Uploader/releases)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

</div>

---

## How it works

Click the toolbar icon. A compact window opens with VirusTotal's own upload page — your normal web session, their upload limits, no API key sitting in extension storage. Pick a file, confirm, solve the captcha if VirusTotal asks for one, and the scan report opens in a new tab the moment it's ready.

> **Experimental build.** To show `virustotal.com` inside the extension, this version relaxes its framing headers via `declarativeNetRequest`. That's a fragile trick — it depends on VirusTotal's frontend not changing — and it's **not published to the Chrome Web Store**. Install it unpacked if you want to try it (see below).

## Install

**Load unpacked (current, experimental build)**

1. Download or clone this repository.
2. Open `chrome://extensions` and enable **Developer mode** (top right).
3. Click **Load unpacked** and select the project folder.

**Chrome Web Store / GitHub Releases**

The published listing below tracks the stable API-key-based flow, not the experimental build in this branch.

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/ofpejkncbelgldkaimdoakjegifjeljj?label=Chrome%20Web%20Store)](https://chromewebstore.google.com/detail/virustotal-uploader/ofpejkncbelgldkaimdoakjegifjeljj)

Or grab a packaged `.zip` from the [Releases page](https://github.com/dubsector/VirusTotal-Uploader/releases), unzip it, and load it unpacked the same way.

## Development

Plain ES modules, no build step — edit and reload via `chrome://extensions`.

```bash
npm install      # dev dependencies (ESLint)
npm run lint     # lint all JavaScript
npm run validate # sanity-check manifest.json
```

CI runs the same lint and validation on every push and pull request, and uploads a packaged `.zip` artifact.

## Disclaimer

This extension is not affiliated with VirusTotal. All VirusTotal rights, logos, and trademarks are owned exclusively by VirusTotal.

## License

[GNU General Public License v3.0](LICENSE)

## Contributing

Issues and pull requests welcome.
