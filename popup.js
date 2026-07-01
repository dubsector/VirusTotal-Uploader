import { getSync, getLocal } from './lib/storage.js';
import { saveFileData } from './lib/idb.js';
import { initTheme } from './lib/theme.js';

initTheme();

const FREE_LIMIT = 32 * 1024 * 1024;
const PREMIUM_LIMIT = 650 * 1024 * 1024;

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const limitHint = document.getElementById('limitHint');
const settingsBtn = document.getElementById('settingsBtn');

const statusCard = document.getElementById('statusCard');
const statusFile = document.getElementById('statusFile');
const statusPhase = document.getElementById('statusPhase');
const progressBar = document.getElementById('progressBar');
const statusMeta = document.getElementById('statusMeta');
const queueBadge = document.getElementById('queueBadge');

let countdownTimer = null;

// ---- settings-driven UI ----------------------------------------------------

let isPremium = false;
let hasKey = false;

Promise.all([getLocal(['apiKey']), getSync(['premiumAccount'])]).then(([local, sync]) => {
  hasKey = Boolean(local.apiKey);
  isPremium = Boolean(sync.premiumAccount);
  limitHint.innerHTML = isPremium
    ? 'Up to 650&nbsp;MB per file (Premium)'
    : 'Up to 32&nbsp;MB per file';
  if (!hasKey) {
    limitHint.textContent = 'Set your API key in settings first';
  }
});

settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

// ---- file intake -----------------------------------------------------------

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

['dragenter', 'dragover'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
  })
);
dropzone.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
fileInput.addEventListener('change', () => {
  handleFiles(fileInput.files);
  fileInput.value = '';
});

async function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return;

  if (!hasKey) {
    showMeta('Set your VirusTotal API key in settings first.', true);
    return;
  }

  const limit = isPremium ? PREMIUM_LIMIT : FREE_LIMIT;
  const valid = files.filter((f) => f.size <= limit);
  const oversized = files.filter((f) => f.size > limit);

  // Smallest first so quick wins land before the big uploads.
  valid.sort((a, b) => a.size - b.size);

  for (const file of valid) {
    const jobId = crypto.randomUUID();
    // Store the File blob directly — IndexedDB clones it natively, no need to
    // marshal it into a giant plain array like the old version did.
    await saveFileData(jobId, file);
    chrome.runtime.sendMessage({
      action: 'queueFile',
      job: { jobId, fileName: file.name, fileSize: file.size },
    });
  }

  if (oversized.length > 0) {
    const cap = isPremium ? '650 MB' : '32 MB';
    const names = oversized.map((f) => f.name).join(', ');
    showMeta(
      `Skipped (over ${cap}): ${names}. ` +
        (isPremium ? '' : 'Larger files need a Premium key or virustotal.com.'),
      true
    );
  } else if (valid.length > 0) {
    showMeta(`${valid.length} file${valid.length > 1 ? 's' : ''} queued.`);
  }
}

// ---- live status -----------------------------------------------------------

const port = chrome.runtime.connect({ name: 'popup' });
port.onMessage.addListener(render);

// Also hydrate from stored state in case a message was missed.
getLocal(['lastStatus', 'current', 'nextAttemptTime']).then((data) => {
  if (data.nextAttemptTime && data.current) {
    render({
      action: 'waiting',
      fileName: data.current.fileName,
      nextAttemptTime: data.nextAttemptTime,
      retryCount: data.current.retryCount || 0,
      maxRetries: 3,
    });
  } else if (data.lastStatus) {
    render(data.lastStatus);
  }
});

function render(msg) {
  clearCountdown();

  switch (msg.action) {
    case 'idle':
      statusCard.classList.remove('show');
      queueBadge.textContent = '';
      return;

    case 'queued':
      setCard(msg.fileName, 'Queued', 'indeterminate');
      showMeta('');
      break;

    case 'phase':
      setCard(msg.fileName, msg.phase === 'checking' ? 'Checking' : 'Uploading', 'indeterminate');
      showMeta('');
      break;

    case 'waiting': {
      const label =
        msg.retryCount > 0
          ? `Retry ${msg.retryCount} of ${msg.maxRetries}`
          : 'Rate limited';
      setCard(msg.fileName, label, 'waiting');
      startCountdown(msg.nextAttemptTime);
      break;
    }

    case 'done':
      setCard(msg.fileName, msg.existing ? 'Already scanned' : 'Uploaded', 'done');
      showMeta(msg.existing ? 'Opened existing report.' : 'Opened analysis report.');
      break;

    case 'error':
      setCard(msg.fileName, 'Failed', 'error');
      showMeta(msg.message || 'Something went wrong.', true);
      break;

    default:
      return;
  }

  if (typeof msg.remaining === 'number') {
    queueBadge.textContent = msg.remaining > 0 ? `${msg.remaining} in queue` : '';
  }
}

function setCard(fileName, phase, barClass) {
  statusCard.classList.add('show');
  statusFile.textContent = fileName || '';
  statusPhase.textContent = phase;
  progressBar.className = `progress-bar ${barClass}`;
}

function showMeta(text, isError = false) {
  statusMeta.textContent = text;
  statusMeta.classList.toggle('error', isError);
  if (text) statusCard.classList.add('show');
}

function startCountdown(nextAttemptTime) {
  const tick = () => {
    const remaining = Math.max(0, Math.ceil((nextAttemptTime - Date.now()) / 1000));
    if (remaining <= 0) {
      showMeta('Resuming…');
      clearCountdown();
    } else {
      showMeta(`Waiting ${remaining}s to respect the API limit.`);
    }
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

function clearCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}
