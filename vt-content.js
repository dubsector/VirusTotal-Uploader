// Injected into VirusTotal pages (all frames). It only acts when running inside
// a sub-frame — i.e. our embedded upload iframe, which the popup can't read
// across origins. When the framed page lands on a result URL (after an upload
// or an existing-hash lookup), it tells the service worker so the report can be
// popped into a real tab.
//
// VirusTotal is a single-page app, so navigation happens via client-side route
// changes. Hooking history.pushState from a content script's isolated world
// wouldn't see the page's own calls, so we just poll location, which reflects
// the real URL in any world.

(function () {
  if (window.top === window.self) return; // only inside the embedded frame

  const RESULT = /\/gui\/(file-analysis|file)\//;
  let last = '';

  function check() {
    const url = location.href;
    if (url === last) return;
    last = url;
    if (RESULT.test(url)) {
      chrome.runtime.sendMessage({ action: 'webResult', url });
    }
  }

  check();
  setInterval(check, 800);
})();
