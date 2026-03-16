// CF Focus v2.0 — options.js

const PLATFORMS = {
  codeforces: { name: 'Codeforces',  sub: 'codeforces.com' },
  leetcode:   { name: 'LeetCode',    sub: 'leetcode.com' },
  atcoder:    { name: 'AtCoder',     sub: 'atcoder.jp' },
  hackerrank: { name: 'HackerRank',  sub: 'hackerrank.com' },
  codechef:   { name: 'CodeChef',    sub: 'codechef.com' },
  cses:       { name: 'CSES',        sub: 'cses.fi' },
};

const DEFAULT_BLOCKED = [
  { id: 'chatgpt',    name: 'ChatGPT' },
  { id: 'openai',     name: 'OpenAI Chat' },
  { id: 'claude',     name: 'Claude' },
  { id: 'gemini',     name: 'Gemini' },
  { id: 'copilot',    name: 'Copilot' },
  { id: 'bingchat',   name: 'Bing Chat' },
  { id: 'perplexity', name: 'Perplexity' },
  { id: 'phind',      name: 'Phind' },
  { id: 'poe',        name: 'Poe' },
  { id: 'deepseek',   name: 'DeepSeek' },
  { id: 'grok',       name: 'Grok' },
  { id: 'mistral',    name: 'Mistral' },
  { id: 'you',        name: 'You.com' },
  { id: 'cohere',     name: 'Cohere' },
  { id: 'hfchat',     name: 'HF Chat' },
  { id: 'aistudio',   name: 'AI Studio' },
  { id: 'writesonic', name: 'Writesonic' },
  { id: 'xai',        name: 'xAI' },
  { id: 'character',  name: 'Character.AI' },
];

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const DEFAULTS = {
  enabledPlatforms: ['codeforces', 'leetcode', 'atcoder', 'hackerrank', 'codechef'],
  disabledDefaults: [],
  customBlocklist: [],
  snoozeUntil: 0,
  snoozeDuration: 15,
  schedule: { enabled: false, days: [1, 2, 3, 4, 5], startHour: 9, endHour: 21 },
  pin: null,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSettings() {
  return new Promise(resolve => chrome.storage.sync.get(DEFAULTS, resolve));
}
function getStats() {
  return new Promise(resolve => chrome.storage.local.get({
    totalSessions: 0, totalMinutes: 0, currentStreak: 0, longestStreak: 0,
  }, resolve));
}
function saveSettings(partial) {
  return new Promise(resolve => chrome.storage.sync.set(partial, () => {
    chrome.runtime.sendMessage({ type: 'SETTINGS_CHANGED' });
    resolve();
  }));
}

async function hashPin(pin) {
  const data = new TextEncoder().encode('cf-focus-v2:' + pin);
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

let saveTimer = null;
function flashSaved() {
  const el = document.getElementById('saveIndicator');
  el.classList.add('show');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

// ─── PIN modal ────────────────────────────────────────────────────────────────

async function checkPin() {
  const settings = await getSettings();
  if (!settings.pin) {
    showPage();
    return;
  }
  const modal = document.getElementById('pinModal');
  modal.classList.remove('hidden');
  const input  = document.getElementById('pinModalInput');
  const errEl  = document.getElementById('pinModalError');
  const submit = document.getElementById('pinModalSubmit');

  async function verify() {
    const hash = await hashPin(input.value);
    if (hash === settings.pin) {
      modal.classList.add('hidden');
      showPage();
    } else {
      errEl.textContent = 'Incorrect PIN';
      input.value = '';
      input.focus();
    }
  }
  submit.addEventListener('click', verify);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') verify(); });
  input.focus();
}

function showPage() {
  loadAll();
}

// ─── Render ───────────────────────────────────────────────────────────────────

async function loadAll() {
  const [settings, stats] = await Promise.all([getSettings(), getStats()]);
  renderPlatforms(settings);
  renderDefaultSites(settings);
  renderCustomList(settings.customBlocklist);
  renderSnooze(settings);
  renderSchedule(settings);
  renderPin(settings);
  renderStats(stats);
}

function renderPlatforms(settings) {
  const grid = document.getElementById('platformGrid');
  grid.innerHTML = '';
  for (const [key, p] of Object.entries(PLATFORMS)) {
    const enabled = settings.enabledPlatforms.includes(key);
    const div = document.createElement('label');
    div.className = 'toggle-item';
    div.innerHTML = `
      <div>
        <div class="toggle-item-name">${p.name}</div>
        <div class="toggle-item-sub">${p.sub}</div>
      </div>
      <label class="toggle-switch">
        <input type="checkbox" data-platform="${key}" ${enabled ? 'checked' : ''}>
        <span class="toggle-track"></span>
      </label>`;
    grid.appendChild(div);
  }

  grid.addEventListener('change', async e => {
    const cb = e.target.closest('[data-platform]');
    if (!cb) return;
    const s = await getSettings();
    let platforms = [...s.enabledPlatforms];
    if (cb.checked) {
      if (!platforms.includes(cb.dataset.platform)) platforms.push(cb.dataset.platform);
    } else {
      platforms = platforms.filter(p => p !== cb.dataset.platform);
    }
    await saveSettings({ enabledPlatforms: platforms });
    flashSaved();
  });
}

function renderDefaultSites(settings) {
  const list = document.getElementById('defaultSites');
  list.innerHTML = '';
  for (const site of DEFAULT_BLOCKED) {
    const enabled = !settings.disabledDefaults.includes(site.id);
    const label = document.createElement('label');
    label.className = 'site-item';
    label.innerHTML = `
      <label class="toggle-switch" style="margin-right:8px">
        <input type="checkbox" data-site="${site.id}" ${enabled ? 'checked' : ''}>
        <span class="toggle-track"></span>
      </label>
      <span class="site-name">${site.name}</span>`;
    list.appendChild(label);
  }

  list.addEventListener('change', async e => {
    const cb = e.target.closest('[data-site]');
    if (!cb) return;
    const s = await getSettings();
    let disabled = [...s.disabledDefaults];
    if (!cb.checked) {
      if (!disabled.includes(cb.dataset.site)) disabled.push(cb.dataset.site);
    } else {
      disabled = disabled.filter(d => d !== cb.dataset.site);
    }
    await saveSettings({ disabledDefaults: disabled });
    flashSaved();
  });
}

function renderCustomList(customBlocklist) {
  const container = document.getElementById('customList');
  container.innerHTML = '';
  if (!customBlocklist.length) {
    container.innerHTML = '<div class="custom-empty">No custom sites added</div>';
    return;
  }
  for (const domain of customBlocklist) {
    const tag = document.createElement('span');
    tag.className = 'custom-tag';
    tag.innerHTML = `${domain}<button data-remove="${domain}" title="Remove">×</button>`;
    container.appendChild(tag);
  }

  container.addEventListener('click', async e => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    const s = await getSettings();
    const updated = s.customBlocklist.filter(d => d !== btn.dataset.remove);
    await saveSettings({ customBlocklist: updated });
    renderCustomList(updated);
    flashSaved();
  });
}

function renderSnooze(settings) {
  const sel = document.getElementById('snoozeDuration');
  sel.value = String(settings.snoozeDuration || 15);
  sel.onchange = async () => {
    await saveSettings({ snoozeDuration: Number(sel.value) });
    flashSaved();
  };
}

function renderSchedule(settings) {
  const sch = settings.schedule || DEFAULTS.schedule;

  const enabledCb = document.getElementById('scheduleEnabled');
  const body      = document.getElementById('scheduleBody');
  enabledCb.checked = sch.enabled;
  body.style.display = sch.enabled ? '' : 'none';

  enabledCb.onchange = async () => {
    body.style.display = enabledCb.checked ? '' : 'none';
    const s = await getSettings();
    await saveSettings({ schedule: { ...s.schedule, enabled: enabledCb.checked } });
    flashSaved();
  };

  // Day chips
  const dayGrid = document.getElementById('dayGrid');
  dayGrid.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const chip = document.createElement('div');
    chip.className = 'day-chip' + (sch.days.includes(i) ? ' selected' : '');
    chip.textContent = DAYS[i];
    chip.dataset.day = i;
    dayGrid.appendChild(chip);
  }
  dayGrid.addEventListener('click', async e => {
    const chip = e.target.closest('[data-day]');
    if (!chip) return;
    chip.classList.toggle('selected');
    const activeDays = [...dayGrid.querySelectorAll('.day-chip.selected')].map(c => Number(c.dataset.day));
    const s = await getSettings();
    await saveSettings({ schedule: { ...s.schedule, days: activeDays } });
    flashSaved();
  });

  // Hours
  const startH = document.getElementById('startHour');
  const endH   = document.getElementById('endHour');
  startH.value = sch.startHour;
  endH.value   = sch.endHour;

  async function saveHours() {
    const s = await getSettings();
    await saveSettings({ schedule: { ...s.schedule, startHour: Number(startH.value), endHour: Number(endH.value) } });
    flashSaved();
  }
  startH.onchange = saveHours;
  endH.onchange   = saveHours;
}

function renderPin(settings) {
  const statusEl   = document.getElementById('pinStatus');
  const removePinBtn = document.getElementById('removePinBtn');
  const setPinBtn  = document.getElementById('setPinBtn');
  const msgEl      = document.getElementById('pinMsg');

  if (settings.pin) {
    statusEl.textContent = '🔒 PIN is set — settings are protected';
    statusEl.className = 'pin-status set';
    removePinBtn.style.display = '';
  } else {
    statusEl.textContent = 'No PIN set — settings are unlocked';
    statusEl.className = 'pin-status';
    removePinBtn.style.display = 'none';
  }

  setPinBtn.onclick = async () => {
    const newPin     = document.getElementById('newPin').value;
    const confirmPin = document.getElementById('confirmPin').value;
    msgEl.className = 'pin-msg';

    if (!/^\d{4,8}$/.test(newPin)) {
      msgEl.textContent = 'PIN must be 4–8 digits';
      msgEl.className = 'pin-msg err';
      return;
    }
    if (newPin !== confirmPin) {
      msgEl.textContent = 'PINs do not match';
      msgEl.className = 'pin-msg err';
      return;
    }

    const hash = await hashPin(newPin);
    await saveSettings({ pin: hash });
    document.getElementById('newPin').value = '';
    document.getElementById('confirmPin').value = '';
    msgEl.textContent = 'PIN saved';
    msgEl.className = 'pin-msg ok';
    renderPin({ ...settings, pin: hash });
    flashSaved();
  };

  removePinBtn.onclick = async () => {
    await saveSettings({ pin: null });
    msgEl.textContent = 'PIN removed';
    msgEl.className = 'pin-msg ok';
    renderPin({ ...settings, pin: null });
    flashSaved();
  };
}

function renderStats(stats) {
  document.getElementById('statStreak').textContent   = stats.currentStreak  || 0;
  document.getElementById('statLongest').textContent  = stats.longestStreak  || 0;
  document.getElementById('statSessions').textContent = stats.totalSessions  || 0;
  document.getElementById('statMinutes').textContent  = stats.totalMinutes   || 0;
}

// ─── Custom blocklist: add ────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  checkPin();

  document.getElementById('customAddBtn').addEventListener('click', addCustomSite);
  document.getElementById('customInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') addCustomSite();
  });

  document.getElementById('resetStatsBtn').addEventListener('click', async () => {
    if (!confirm('Reset all focus stats? This cannot be undone.')) return;
    await new Promise(r => chrome.storage.local.set({
      totalSessions: 0, totalMinutes: 0, currentStreak: 0,
      longestStreak: 0, lastSessionDate: null, sessionStart: null,
    }, r));
    renderStats({ totalSessions: 0, totalMinutes: 0, currentStreak: 0, longestStreak: 0 });
    flashSaved();
  });
});

async function addCustomSite() {
  const input = document.getElementById('customInput');
  let domain = input.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!domain) return;

  const s = await getSettings();
  if (s.customBlocklist.includes(domain)) {
    input.value = '';
    return;
  }
  const updated = [...s.customBlocklist, domain];
  await saveSettings({ customBlocklist: updated });
  input.value = '';
  renderCustomList(updated);
  flashSaved();
}
