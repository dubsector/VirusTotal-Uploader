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

const notice = document.getElementById('notice');
const jobList = document.getElementById('jobList');

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
    showNotice('Set your VirusTotal API key in settings first.', true);
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
    showNotice(
      `Skipped (over ${cap}): ${names}. ` +
        (isPremium ? '' : 'Larger files need a Premium key or virustotal.com.'),
      true
    );
  } else {
    showNotice('');
  }
}

function showNotice(text, isError = false) {
  notice.textContent = text;
  notice.classList.toggle('error', isError);
  notice.style.display = text ? 'block' : 'none';
}

// ---- live status -----------------------------------------------------------

const port = chrome.runtime.connect({ name: 'popup' });
port.onMessage.addListener(render);

const ACTIVE_LABELS = {
  checking: 'Checking',
  uploading: 'Uploading',
};

// The background sends a full snapshot: the active job (or null) plus the list
// of queued files. We rebuild the card list from scratch each time.
function render(msg) {
  if (msg.action !== 'render') return;
  clearCountdown();
  jobList.innerHTML = '';

  if (msg.active) {
    jobList.appendChild(activeCard(msg.active));
  }

  (msg.queue || []).forEach((job, index) => {
    jobList.appendChild(queuedCard(job.fileName, index + 1));
  });
}

function activeCard(active) {
  switch (active.state) {
    case 'waiting': {
      const label =
        active.retryCount > 0
          ? `Retry ${active.retryCount} of ${active.maxRetries}`
          : 'Rate limited';
      const card = buildCard(active.fileName, label, 'waiting', '');
      startCountdown(active.nextAttemptTime, card.querySelector('.meta'));
      return card;
    }
    case 'done':
      return buildCard(
        active.fileName,
        active.existing ? 'Already scanned' : 'Uploaded',
        'done',
        active.existing ? 'Opened existing report.' : 'Opened analysis report.'
      );
    case 'error':
      return buildCard(active.fileName, 'Failed', 'error', active.message || 'Something went wrong.', true);
    default:
      return buildCard(active.fileName, ACTIVE_LABELS[active.state] || 'Working', 'indeterminate', '');
  }
}

function queuedCard(fileName, position) {
  return buildCard(fileName, `Queued · #${position}`, 'queued', '', false, 'queued');
}

function buildCard(fileName, status, barClass, metaText, metaError = false, extraClass = 'active') {
  const card = document.createElement('div');
  card.className = `job-card ${extraClass}`;

  const line = document.createElement('div');
  line.className = 'job-line';

  const name = document.createElement('span');
  name.className = 'job-file';
  name.textContent = fileName || '';

  const status_ = document.createElement('span');
  status_.className = 'job-status';
  status_.textContent = status;

  line.append(name, status_);

  const progress = document.createElement('div');
  progress.className = 'progress';
  const bar = document.createElement('div');
  bar.className = `progress-bar ${barClass}`;
  progress.appendChild(bar);

  card.append(line, progress);

  const meta = document.createElement('div');
  meta.className = metaError ? 'meta error' : 'meta';
  meta.textContent = metaText || '';
  if (!metaText) meta.style.display = 'none';
  card.appendChild(meta);

  return card;
}

function startCountdown(nextAttemptTime, metaEl) {
  const tick = () => {
    const remaining = Math.max(0, Math.ceil((nextAttemptTime - Date.now()) / 1000));
    metaEl.style.display = 'block';
    if (remaining <= 0) {
      metaEl.textContent = 'Resuming…';
      clearCountdown();
    } else {
      metaEl.textContent = `Waiting ${remaining}s to respect the API limit.`;
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
