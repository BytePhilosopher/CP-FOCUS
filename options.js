// CF Focus v2.0 — options.js

const PLATFORMS = {
  codeforces: { name: 'Codeforces',  sub: 'codeforces.com',  abbr: 'CF' },
  leetcode:   { name: 'LeetCode',    sub: 'leetcode.com',    abbr: 'LC' },
  atcoder:    { name: 'AtCoder',     sub: 'atcoder.jp',      abbr: 'AC' },
  hackerrank: { name: 'HackerRank',  sub: 'hackerrank.com',  abbr: 'HR' },
  codechef:   { name: 'CodeChef',    sub: 'codechef.com',    abbr: 'CC' },
  cses:       { name: 'CSES',        sub: 'cses.fi',         abbr: 'CS' },
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
  customPlatforms: [],
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
    aiBlocksAvoided: 0, problemsSolved: 0,
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
    const card = document.createElement('div');
    card.className = `platform-card${enabled ? ' active' : ''}`;
    card.dataset.platform = key;
    card.innerHTML = `
      <div class="platform-planet">${p.abbr}</div>
      <div class="platform-card-name">${p.name}</div>
      <div class="platform-card-domain">${p.sub}</div>
      <div class="platform-dot"></div>`;
    grid.appendChild(card);
  }

  grid.onclick = async e => {
    const card = e.target.closest('[data-platform]');
    if (!card) return;
    const isActive = card.classList.toggle('active');
    const key = card.dataset.platform;
    const s = await getSettings();
    let platforms = [...s.enabledPlatforms];
    if (isActive) {
      if (!platforms.includes(key)) platforms.push(key);
    } else {
      platforms = platforms.filter(p => p !== key);
    }
    await saveSettings({ enabledPlatforms: platforms });
    flashSaved();
  };

  renderCustomPlatforms(settings.customPlatforms || []);
}

function renderCustomPlatforms(customPlatforms) {
  const list = document.getElementById('customPlatformList');
  if (!list) return;
  list.innerHTML = '';

  if (!customPlatforms.length) {
    list.innerHTML = '<div class="cp-empty">No custom platforms added yet</div>';
    return;
  }

  for (const cp of customPlatforms) {
    const item = document.createElement('div');
    item.className = 'cp-item';
    item.innerHTML = `
      <div class="cp-item-badge">${cp.name.slice(0, 2).toUpperCase()}</div>
      <div class="cp-item-info">
        <div class="cp-item-name">${cp.name}</div>
        <div class="cp-item-domain">${cp.domain}</div>
      </div>
      <button class="cp-item-remove" data-remove="${cp.domain}" title="Remove">
        <svg viewBox="0 0 10 10" fill="none" width="12" height="12">
          <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>`;
    list.appendChild(item);
  }

  list.onclick = async e => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    const s = await getSettings();
    const updated = (s.customPlatforms || []).filter(cp => cp.domain !== btn.dataset.remove);
    await saveSettings({ customPlatforms: updated });
    renderCustomPlatforms(updated);
    flashSaved();
  };
}

async function addCustomPlatform() {
  const nameInput   = document.getElementById('cpName');
  const domainInput = document.getElementById('cpDomain');
  const name = nameInput.value.trim();
  let domain = domainInput.value.trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '');

  if (!name) {
    nameInput.style.borderColor = 'var(--red)';
    setTimeout(() => { nameInput.style.borderColor = ''; }, 1500);
    return;
  }

  const domainRe = /^([a-z0-9-]+\.)+[a-z]{2,}(:[0-9]+)?$/;
  if (!domainRe.test(domain)) {
    domainInput.style.borderColor = 'var(--red)';
    setTimeout(() => { domainInput.style.borderColor = ''; }, 1500);
    return;
  }

  const s = await getSettings();
  const existing = s.customPlatforms || [];
  if (existing.some(cp => cp.domain === domain)) {
    nameInput.value = '';
    domainInput.value = '';
    return;
  }

  const updated = [...existing, { name, domain }];
  await saveSettings({ customPlatforms: updated });
  nameInput.value = '';
  domainInput.value = '';
  renderCustomPlatforms(updated);
  flashSaved();
}

function updateSiteCount() {
  const chips = document.querySelectorAll('#defaultSites .ai-chip');
  const active = [...chips].filter(c => c.classList.contains('active')).length;
  const el = document.getElementById('sitesEnabledCount');
  if (el) el.textContent = active;
  const tot = document.getElementById('sitesTotalCount');
  if (tot) tot.textContent = DEFAULT_BLOCKED.length;
}

function renderDefaultSites(settings) {
  const list = document.getElementById('defaultSites');
  list.className = 'ai-chips';
  list.innerHTML = '';

  for (const site of DEFAULT_BLOCKED) {
    const enabled = !settings.disabledDefaults.includes(site.id);
    const chip = document.createElement('div');
    chip.className = `ai-chip${enabled ? ' active' : ''}`;
    chip.dataset.site = site.id;
    chip.innerHTML = `<span class="ai-chip-dot"></span>${site.name}`;
    list.appendChild(chip);
  }
  updateSiteCount();

  list.onclick = async e => {
    const chip = e.target.closest('[data-site]');
    if (!chip) return;
    const isActive = chip.classList.toggle('active');
    updateSiteCount();
    const s = await getSettings();
    let disabled = [...s.disabledDefaults];
    if (!isActive) {
      if (!disabled.includes(chip.dataset.site)) disabled.push(chip.dataset.site);
    } else {
      disabled = disabled.filter(d => d !== chip.dataset.site);
    }
    await saveSettings({ disabledDefaults: disabled });
    flashSaved();
  };

  // Bulk toggle buttons
  const enableAll = document.getElementById('enableAllSites');
  const disableAll = document.getElementById('disableAllSites');
  if (enableAll) {
    enableAll.onclick = async () => {
      document.querySelectorAll('#defaultSites .ai-chip').forEach(c => c.classList.add('active'));
      updateSiteCount();
      await saveSettings({ disabledDefaults: [] });
      flashSaved();
    };
  }
  if (disableAll) {
    disableAll.onclick = async () => {
      document.querySelectorAll('#defaultSites .ai-chip').forEach(c => c.classList.remove('active'));
      updateSiteCount();
      await saveSettings({ disabledDefaults: DEFAULT_BLOCKED.map(s => s.id) });
      flashSaved();
    };
  }
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

  container.onclick = async e => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    const s = await getSettings();
    const updated = s.customBlocklist.filter(d => d !== btn.dataset.remove);
    await saveSettings({ customBlocklist: updated });
    renderCustomList(updated);
    flashSaved();
  };
}

function renderSnooze(settings) {
  const current = settings.snoozeDuration || 15;
  const chips = document.querySelectorAll('#snoozeChips .snooze-chip');
  chips.forEach(chip => {
    chip.classList.toggle('selected', Number(chip.dataset.dur) === current);
  });
  document.getElementById('snoozeChips').onclick = async e => {
    const chip = e.target.closest('[data-dur]');
    if (!chip) return;
    chips.forEach(c => c.classList.remove('selected'));
    chip.classList.add('selected');
    await saveSettings({ snoozeDuration: Number(chip.dataset.dur) });
    flashSaved();
  };
}

function renderSchedule(settings) {
  const sch        = settings.schedule || DEFAULTS.schedule;
  const enabledCb  = document.getElementById('scheduleEnabled');
  const body       = document.getElementById('scheduleBody');
  const enableCard = document.getElementById('schedEnableCard');

  enabledCb.checked = sch.enabled;
  body.style.display = sch.enabled ? '' : 'none';
  enableCard.classList.toggle('on', sch.enabled);

  // Clicking the card row (not the label) also toggles
  enableCard.onclick = () => {
    enabledCb.checked = !enabledCb.checked;
    enabledCb.dispatchEvent(new Event('change'));
  };

  enabledCb.onchange = async () => {
    const on = enabledCb.checked;
    body.style.display = on ? '' : 'none';
    enableCard.classList.toggle('on', on);
    updatePreview();
    const s = await getSettings();
    await saveSettings({ schedule: { ...s.schedule, enabled: on } });
    flashSaved();
  };

  // Populate hour selects
  const startH = document.getElementById('startHour');
  const endH   = document.getElementById('endHour');

  function fmtHour(h) {
    if (h === 0)  return '12 AM';
    if (h < 12)   return `${h} AM`;
    if (h === 12) return '12 PM';
    return `${h - 12} PM`;
  }

  function populateSelect(sel, current) {
    if (sel.options.length === 0) {
      for (let h = 0; h < 24; h++) {
        const opt = document.createElement('option');
        opt.value = h;
        opt.textContent = fmtHour(h);
        sel.appendChild(opt);
      }
    }
    sel.value = current;
  }

  populateSelect(startH, sch.startHour);
  populateSelect(endH,   sch.endHour);

  // Timeline + preview
  function updateTimeline() {
    const start = Number(startH.value);
    const end   = Number(endH.value);
    const fill  = document.getElementById('schedTimelineFill');
    if (!fill) return;
    const leftPct  = (start / 24) * 100;
    const widthPct = Math.max(0, (end - start) / 24) * 100;
    fill.style.left  = `${leftPct}%`;
    fill.style.width = `${widthPct}%`;
  }

  function updatePreview() {
    const preview = document.getElementById('schedPreview');
    if (!preview) return;
    const start      = Number(startH.value);
    const end        = Number(endH.value);
    const activeDays = [...document.querySelectorAll('#dayGrid .day-chip.selected')]
      .map(c => DAYS[Number(c.dataset.day)]);

    if (!enabledCb.checked) {
      preview.textContent = 'Schedule is disabled.';
      preview.className = 'sched-preview';
      return;
    }
    if (!activeDays.length) {
      preview.innerHTML = '<span style="color:var(--red)">No days selected — pick at least one.</span>';
      preview.className = 'sched-preview live';
      return;
    }
    if (end <= start) {
      preview.innerHTML = '<span style="color:var(--red)">End time must be later than start time.</span>';
      preview.className = 'sched-preview live';
      return;
    }
    const durH = end - start;
    preview.innerHTML =
      `Blocking <strong>${activeDays.join(', ')}</strong> ` +
      `from <strong>${fmtHour(start)}</strong> to <strong>${fmtHour(end)}</strong> ` +
      `<span style="color:var(--muted)">(${durH}h window)</span>`;
    preview.className = 'sched-preview live';
  }

  updateTimeline();
  updatePreview();

  async function saveHours() {
    updateTimeline();
    updatePreview();
    const s = await getSettings();
    await saveSettings({ schedule: { ...s.schedule, startHour: Number(startH.value), endHour: Number(endH.value) } });
    flashSaved();
  }
  startH.onchange = saveHours;
  endH.onchange   = saveHours;

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
  dayGrid.onclick = async e => {
    const chip = e.target.closest('[data-day]');
    if (!chip) return;
    chip.classList.toggle('selected');
    updatePreview();
    const activeDays = [...dayGrid.querySelectorAll('.day-chip.selected')].map(c => Number(c.dataset.day));
    const s = await getSettings();
    await saveSettings({ schedule: { ...s.schedule, days: activeDays } });
    flashSaved();
  };
}

function renderPin(settings) {
  const statusCard  = document.getElementById('pinStatus');
  const statusTitle = document.getElementById('pinStatusTitle');
  const statusSub   = document.getElementById('pinStatusSub');
  const statusBadge = document.getElementById('pinStatusBadge');
  const removeSect  = document.getElementById('removePinSection');
  const setPinBtn   = document.getElementById('setPinBtn');
  const msgEl       = document.getElementById('pinMsg');

  if (settings.pin) {
    statusCard.classList.add('protected');
    statusTitle.textContent = 'Settings are protected';
    statusSub.textContent   = 'A PIN is required to access this page';
    statusBadge.textContent = 'Protected';
    if (removeSect) removeSect.style.display = '';
  } else {
    statusCard.classList.remove('protected');
    statusTitle.textContent = 'No PIN set';
    statusSub.textContent   = 'Your settings are unlocked';
    statusBadge.textContent = 'Unprotected';
    if (removeSect) removeSect.style.display = 'none';
  }

  setPinBtn.onclick = async () => {
    const newPin     = document.getElementById('newPin').value;
    const confirmPin = document.getElementById('confirmPin').value;
    msgEl.className  = 'pin-msg';

    if (!/^\d{4,8}$/.test(newPin)) {
      msgEl.textContent = 'PIN must be 4–8 digits';
      msgEl.className   = 'pin-msg err';
      return;
    }
    if (newPin !== confirmPin) {
      msgEl.textContent = 'PINs do not match';
      msgEl.className   = 'pin-msg err';
      return;
    }

    const hash = await hashPin(newPin);
    await saveSettings({ pin: hash });
    document.getElementById('newPin').value    = '';
    document.getElementById('confirmPin').value = '';
    msgEl.textContent = 'PIN saved successfully';
    msgEl.className   = 'pin-msg ok';
    renderPin({ ...settings, pin: hash });
    flashSaved();
  };

  const removePinBtn = document.getElementById('removePinBtn');
  if (removePinBtn) {
    removePinBtn.onclick = async () => {
      await saveSettings({ pin: null });
      msgEl.textContent = 'PIN removed';
      msgEl.className   = 'pin-msg ok';
      renderPin({ ...settings, pin: null });
      flashSaved();
    };
  }
}

function renderStats(stats) {
  document.getElementById('statStreak').textContent   = stats.currentStreak  || 0;
  document.getElementById('statLongest').textContent  = stats.longestStreak  || 0;
  document.getElementById('statSessions').textContent = stats.totalSessions  || 0;
  const hours = ((stats.totalMinutes || 0) / 60).toFixed(1);
  document.getElementById('statHours').textContent    = hours;
  document.getElementById('statBlocks').textContent   = stats.aiBlocksAvoided || 0;
  document.getElementById('statSolved').textContent   = stats.problemsSolved  || 0;

  // Update vertical bar chart (relative height scale)
  const chartVals = [
    { id: 'chartSessions', valId: 'chartSessionsVal', val: stats.totalSessions || 0 },
    { id: 'chartHours',    valId: 'chartHoursVal',    val: parseFloat(hours) },
    { id: 'chartBlocks',   valId: 'chartBlocksVal',   val: stats.aiBlocksAvoided || 0 },
    { id: 'chartSolved',   valId: 'chartSolvedVal',   val: stats.problemsSolved || 0 },
  ];
  const chartMax = Math.max(...chartVals.map(v => v.val), 1);
  // Delay height transition so it animates in after paint
  requestAnimationFrame(() => {
    chartVals.forEach(({ id, valId, val }) => {
      const bar = document.getElementById(id);
      if (bar) bar.style.height = `${Math.max(Math.round((val / chartMax) * 100), val > 0 ? 4 : 0)}%`;
      const valEl = document.getElementById(valId);
      if (valEl) valEl.textContent = Number.isInteger(val) ? val : val.toFixed(1);
    });
  });

  // Resistance rate → donut arc
  const total = (stats.aiBlocksAvoided || 0) + (stats.problemsSolved || 0);
  const rate = total > 0 ? Math.round((stats.aiBlocksAvoided / total) * 100) : 0;
  const rateStr = `${rate}%`;
  const DONUT_C = 289.03; // 2π × 46
  const donutArc = document.getElementById('donutArc');
  requestAnimationFrame(() => {
    if (donutArc) donutArc.style.strokeDashoffset = String(DONUT_C * (1 - rate / 100));
  });
  const rateFooterEl = document.getElementById('statResistRateFooter');
  if (rateFooterEl) rateFooterEl.textContent = rateStr;
}

// ─── Custom blocklist: add ────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  checkPin();

  // ─── Sidebar navigation ──────────────────────────────────────────────────
  const navItems = document.querySelectorAll('.nav-item[data-view]');
  const views    = document.querySelectorAll('.view[id^="view-"]');

  navItems.forEach(item => {
    item.onclick = () => {
      navItems.forEach(n => n.classList.remove('active'));
      views.forEach(v => v.classList.remove('active'));
      item.classList.add('active');
      const target = document.getElementById('view-' + item.dataset.view);
      if (target) target.classList.add('active');
    };
  });

  document.getElementById('customAddBtn').addEventListener('click', addCustomSite);
  document.getElementById('customInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') addCustomSite();
  });

  document.getElementById('cpAddBtn').addEventListener('click', addCustomPlatform);
  document.getElementById('cpDomain').addEventListener('keydown', e => {
    if (e.key === 'Enter') addCustomPlatform();
  });

  document.getElementById('resetStatsBtn').addEventListener('click', async () => {
    if (!confirm('Reset all focus stats? This cannot be undone.')) return;
    await new Promise(r => chrome.storage.local.set({
      totalSessions: 0, totalMinutes: 0, currentStreak: 0,
      longestStreak: 0, lastSessionDate: null, sessionStart: null,
      aiBlocksAvoided: 0, problemsSolved: 0,
    }, r));
    renderStats({ totalSessions: 0, totalMinutes: 0, currentStreak: 0, longestStreak: 0, aiBlocksAvoided: 0, problemsSolved: 0 });
    flashSaved();
  });
});

async function addCustomSite() {
  const input = document.getElementById('customInput');
  let domain = input.value.trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!domain) return;

  // Basic domain validation — must look like a real hostname
  const domainRe = /^([a-z0-9-]+\.)+[a-z]{2,}(:[0-9]+)?$/;
  if (!domainRe.test(domain)) {
    input.style.borderColor = 'var(--red)';
    setTimeout(() => { input.style.borderColor = ''; }, 1500);
    return;
  }

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
