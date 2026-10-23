// CF Focus — options.js

const { PLATFORMS, DEFAULT_BLOCKED } = CF;
const DEFAULTS = CF.DEFAULT_SETTINGS;
const DEFAULT_UNLOCK = DEFAULTS.hintTiers;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Everything in chrome.storage.local that counts as "stats" (exported, reset).
const STAT_DEFAULTS = {
  totalSessions: 0, totalMinutes: 0, currentStreak: 0, longestStreak: 0,
  lastSessionDate: null, aiBlocksAvoided: 0, problemsSolved: 0, focusSessionsCompleted: 0,
  dayLog: {}, todayDate: null, todayMinutes: 0, todayBlocks: 0, todaySolved: 0, todaySessions: 0,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSettings() {
  return new Promise(resolve => chrome.storage.sync.get(DEFAULTS, resolve));
}
function getStats() {
  return new Promise(resolve => chrome.storage.local.get(STAT_DEFAULTS, resolve));
}
function saveSettings(partial) {
  return new Promise(resolve => chrome.storage.sync.set(partial, () => {
    chrome.runtime.sendMessage({ type: 'SETTINGS_CHANGED' }, () => {
      void chrome.runtime.lastError;
    });
    resolve();
  }));
}
function send(msg) {
  return new Promise(resolve => chrome.runtime.sendMessage(msg, resp => {
    void chrome.runtime.lastError;
    resolve(resp);
  }));
}

async function hashPin(pin) {
  const data = new TextEncoder().encode('cf-focus-v2:' + pin);
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// The streak stored on disk only changes when a session ends, so it reads as
// still alive after a missed day. Mirror background.js's liveStreak().
function liveStreak(stats) {
  const today = CF.dayKey();
  const yesterday = CF.dayKey(CF.addDays(new Date(), -1));
  return (stats.lastSessionDate === today || stats.lastSessionDate === yesterday)
    ? (stats.currentStreak || 0) : 0;
}

// Archived days, with today overlaid from the live counters.
function daysWithToday(stats) {
  const days = { ...(stats.dayLog || {}) };
  const todayKey = CF.dayKey();
  if (stats.todayDate === todayKey &&
      (stats.todayMinutes || stats.todayBlocks || stats.todaySolved)) {
    days[todayKey] = {
      m: stats.todayMinutes || 0, b: stats.todayBlocks || 0,
      s: stats.todaySolved || 0,  n: stats.todaySessions || 0,
    };
  }
  return days;
}

// Ask Chrome for host access to a custom domain so DNR rules can fire on it.
// User-gesture-initiated, so the browser will show its native permission prompt.
function hostOrigins(domain) {
  return [`*://${domain}/*`, `*://*.${domain}/*`];
}
function requestHostPermissionFor(domain) {
  return new Promise(resolve => {
    try {
      chrome.permissions.request({ origins: hostOrigins(domain) }, granted => {
        void chrome.runtime.lastError;
        resolve(!!granted);
      });
    } catch (_) {
      resolve(false);
    }
  });
}
function hasHostPermissionFor(domain) {
  return new Promise(resolve => {
    try {
      chrome.permissions.contains({ origins: hostOrigins(domain) }, has => {
        void chrome.runtime.lastError;
        resolve(!!has);
      });
    } catch (_) {
      resolve(false);
    }
  });
}
function releaseHostPermissionFor(domain) {
  // Never drop access the manifest grants up front for a default site.
  if (DEFAULT_BLOCKED.some(s => CF.hostMatches(domain, s.domain))) return;
  try { chrome.permissions.remove({ origins: hostOrigins(domain) }, () => { void chrome.runtime.lastError; }); } catch (_) {}
}

let saveTimer = null;
function flashSaved(text) {
  const el = document.getElementById('saveIndicator');
  el.lastChild.textContent = ' ' + (text || 'Saved');
  el.classList.add('show');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

function flashInvalid(input) {
  input.style.borderColor = 'var(--red)';
  input.focus();
  setTimeout(() => { input.style.borderColor = ''; }, 1500);
}

// Div-based toggles get keyboard support: focusable, and Enter/Space clicks.
function makeKeyboardClickable(el) {
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
}
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.getAttribute &&
      e.target.getAttribute('role') === 'button' && e.target.tagName !== 'BUTTON') {
    e.preventDefault();
    e.target.click();
  }
});

// ─── PIN modal ────────────────────────────────────────────────────────────────
// Wrong guesses lock the form for an increasing time, so the PIN can't simply
// be brute-forced. The counter lives in chrome.storage.local so reloading the
// page doesn't reset it.

const PIN_FREE_TRIES = 3;

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

  const getLock = () => new Promise(r => chrome.storage.local.get({ pinFails: 0, pinLockUntil: 0 }, r));
  let lockTimer = null;

  async function paintLock() {
    const { pinLockUntil } = await getLock();
    const left = Math.ceil((pinLockUntil - Date.now()) / 1000);
    const locked = left > 0;
    input.disabled = submit.disabled = locked;
    clearTimeout(lockTimer);
    if (locked) {
      errEl.className = 'pin-error locked';
      errEl.textContent = `Too many attempts — try again in ${left}s`;
      lockTimer = setTimeout(paintLock, 1000);
    } else if (errEl.classList.contains('locked')) {
      errEl.className = 'pin-error';
      errEl.textContent = '';
      input.focus();
    }
  }

  async function verify() {
    const { pinFails, pinLockUntil } = await getLock();
    if (pinLockUntil > Date.now()) return paintLock();
    const hash = await hashPin(input.value);
    if (hash === settings.pin) {
      chrome.storage.local.set({ pinFails: 0, pinLockUntil: 0 });
      modal.classList.add('hidden');
      showPage();
      return;
    }
    const fails = pinFails + 1;
    const lockSecs = fails >= PIN_FREE_TRIES ? Math.min(300, 15 * 2 ** (fails - PIN_FREE_TRIES)) : 0;
    await new Promise(r => chrome.storage.local.set({
      pinFails: fails, pinLockUntil: lockSecs ? Date.now() + lockSecs * 1000 : 0,
    }, r));
    input.value = '';
    errEl.className = 'pin-error';
    errEl.textContent = 'Incorrect PIN';
    if (lockSecs) paintLock(); else input.focus();
  }
  submit.addEventListener('click', verify);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') verify(); });
  input.focus();
  paintLock();
}

function showPage() {
  loadAll();
  // Stats update live while the page is open.
  let t = null;
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area !== 'local') return;
    clearTimeout(t);
    t = setTimeout(refreshStats, 300);
  });
  if (new URLSearchParams(location.search).get('welcome') === '1') showWelcome();
}

async function refreshStats() {
  const [settings, stats] = await Promise.all([getSettings(), getStats()]);
  renderCalendar(stats, settings);
  renderStats(stats, settings);
}

async function showWelcome() {
  const settings = await getSettings();
  document.getElementById('welcomeUnlock').textContent =
    (settings.hintTiers && settings.hintTiers.unlockAt) || DEFAULT_UNLOCK.unlockAt;
  const w = document.getElementById('welcome');
  w.classList.remove('hidden');
  document.getElementById('welcomeDone').onclick = () => {
    w.classList.add('hidden');
    history.replaceState(null, '', location.pathname + location.hash);
  };
}

// ─── Render ───────────────────────────────────────────────────────────────────

async function loadAll() {
  const [settings, stats] = await Promise.all([getSettings(), getStats()]);
  renderCalendar(stats, settings);
  renderStats(stats, settings);
  renderPlatforms(settings);
  renderDefaultSites(settings);
  renderCustomList(settings.customBlocklist);
  renderSnooze(settings);
  renderDailyGoal(settings);
  renderBreakReminder(settings);
  renderSchedule(settings);
  renderUnlockRule(settings);
  renderPin(settings);
}

function renderUnlockRule(settings) {
  const rule = { ...DEFAULT_UNLOCK, ...(settings.hintTiers || {}) };
  const un  = document.getElementById('unlockAtInput');
  const dur = document.getElementById('unlockMinutesInput');
  const msg = document.getElementById('unlockMsg');
  if (!un) return;

  un.value  = rule.unlockAt;
  dur.value = rule.unlockMinutes;

  function clamp(input, min, max) {
    if (input.value.trim() === '') return null;
    const v = Math.round(Number(input.value));
    if (!Number.isFinite(v)) return null;
    return Math.min(max, Math.max(min, v));
  }

  async function save() {
    const at = clamp(un, 1, 240);
    const md = clamp(dur, 1, 60);
    msg.className = 'unlock-msg';
    msg.textContent = '';
    if (at === null || md === null) {
      msg.textContent = 'Both values must be whole numbers.';
      msg.className = 'unlock-msg err';
      return;
    }
    un.value = at; dur.value = md;
    await saveSettings({ hintTiers: { unlockAt: at, unlockMinutes: md } });
    msg.textContent = `Saved: AI unlocks after ${at}m of focus, for ${md}m.`;
    msg.className = 'unlock-msg ok';
    flashSaved();
  }

  [un, dur].forEach(inp => {
    inp.onchange = save;
    inp.onkeydown = e => { if (e.key === 'Enter') save(); };
  });

  const resetBtn = document.getElementById('resetUnlockBtn');
  if (resetBtn) {
    resetBtn.onclick = async () => {
      un.value  = DEFAULT_UNLOCK.unlockAt;
      dur.value = DEFAULT_UNLOCK.unlockMinutes;
      await save();
    };
  }
}

function renderPlatforms(settings) {
  const grid = document.getElementById('platformGrid');
  grid.textContent = '';

  for (const [key, p] of Object.entries(PLATFORMS)) {
    const enabled = settings.enabledPlatforms.includes(key);
    const card = document.createElement('div');
    card.className = `platform-card${enabled ? ' active' : ''}`;
    card.dataset.platform = key;
    card.setAttribute('aria-pressed', String(enabled));
    makeKeyboardClickable(card);
    card.innerHTML = `
      <div class="platform-planet">${p.abbr}</div>
      <div class="platform-card-name">${p.name}</div>
      <div class="platform-card-domain">${p.domains[0]}</div>
      <div class="platform-dot"></div>`;
    grid.appendChild(card);
  }

  grid.onclick = async e => {
    const card = e.target.closest('[data-platform]');
    if (!card) return;
    const isActive = card.classList.toggle('active');
    card.setAttribute('aria-pressed', String(isActive));
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
  list.textContent = '';

  if (!customPlatforms.length) {
    const empty = document.createElement('div');
    empty.className = 'cp-empty';
    empty.textContent = 'No custom platforms added yet';
    list.appendChild(empty);
    return;
  }

  for (const cp of customPlatforms) {
    const item = document.createElement('div');
    item.className = 'cp-item';

    const badge = document.createElement('div');
    badge.className = 'cp-item-badge';
    badge.textContent = (cp.name || '').slice(0, 2).toUpperCase();

    const info = document.createElement('div');
    info.className = 'cp-item-info';
    const name = document.createElement('div');
    name.className = 'cp-item-name';
    name.textContent = cp.name;
    const dom = document.createElement('div');
    dom.className = 'cp-item-domain';
    dom.textContent = cp.domain;
    info.appendChild(name);
    info.appendChild(dom);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'cp-item-remove';
    removeBtn.title = 'Remove';
    removeBtn.setAttribute('aria-label', `Remove ${cp.name}`);
    removeBtn.dataset.remove = cp.domain;
    removeBtn.innerHTML =
      '<svg viewBox="0 0 10 10" fill="none" width="12" height="12">' +
      '<path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
      '</svg>';

    item.appendChild(badge);
    item.appendChild(info);
    item.appendChild(removeBtn);
    list.appendChild(item);
  }

  list.onclick = async e => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    const s = await getSettings();
    const updated = (s.customPlatforms || []).filter(cp => cp.domain !== btn.dataset.remove);
    await saveSettings({ customPlatforms: updated });
    renderCustomPlatforms(updated);
    flashSaved('Removed');
  };
}

async function addCustomPlatform() {
  const nameInput   = document.getElementById('cpName');
  const domainInput = document.getElementById('cpDomain');
  const name = nameInput.value.trim().slice(0, 40);
  const domain = CF.normalizeDomain(domainInput.value);

  if (!name) return flashInvalid(nameInput);
  if (!CF.DOMAIN_RE.test(domain)) return flashInvalid(domainInput);

  const s = await getSettings();
  const existing = s.customPlatforms || [];
  const builtIn = Object.values(PLATFORMS).some(p => p.domains.some(d => CF.hostMatches(domain, d)));
  if (builtIn || existing.some(cp => cp.domain === domain)) {
    nameInput.value = '';
    domainInput.value = '';
    flashSaved(builtIn ? 'Already a built-in platform' : 'Already added');
    return;
  }

  // Custom platforms only need URL detection (via the tabs permission), not
  // host_permissions — DNR rules fire on the blocked AI sites, not the platform.
  const updated = [...existing, { name, domain }];
  await saveSettings({ customPlatforms: updated });
  nameInput.value = '';
  domainInput.value = '';
  renderCustomPlatforms(updated);
  flashSaved('Platform added');
}

function updateSiteCount() {
  const chips = document.querySelectorAll('#defaultSites .ai-chip');
  const active = [...chips].filter(c => c.classList.contains('active')).length;
  document.getElementById('sitesEnabledCount').textContent = active;
  document.getElementById('sitesTotalCount').textContent = DEFAULT_BLOCKED.length;
}

function renderDefaultSites(settings) {
  const list = document.getElementById('defaultSites');
  list.className = 'ai-chips';
  list.textContent = '';

  for (const site of DEFAULT_BLOCKED) {
    const enabled = !settings.disabledDefaults.includes(site.id);
    const chip = document.createElement('div');
    chip.className = `ai-chip${enabled ? ' active' : ''}`;
    chip.dataset.site = site.id;
    chip.title = site.path ? site.domain + site.path : site.domain;
    chip.setAttribute('aria-pressed', String(enabled));
    makeKeyboardClickable(chip);
    const dot = document.createElement('span');
    dot.className = 'ai-chip-dot';
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(site.name));
    list.appendChild(chip);
  }
  updateSiteCount();

  list.onclick = async e => {
    const chip = e.target.closest('[data-site]');
    if (!chip) return;
    const isActive = chip.classList.toggle('active');
    chip.setAttribute('aria-pressed', String(isActive));
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
  document.getElementById('enableAllSites').onclick = async () => {
    document.querySelectorAll('#defaultSites .ai-chip').forEach(c => c.classList.add('active'));
    updateSiteCount();
    await saveSettings({ disabledDefaults: [] });
    flashSaved();
  };
  document.getElementById('disableAllSites').onclick = async () => {
    document.querySelectorAll('#defaultSites .ai-chip').forEach(c => c.classList.remove('active'));
    updateSiteCount();
    await saveSettings({ disabledDefaults: DEFAULT_BLOCKED.map(s => s.id) });
    flashSaved();
  };
}

function renderCustomList(customBlocklist) {
  const container = document.getElementById('customList');
  container.textContent = '';
  if (!customBlocklist.length) {
    const empty = document.createElement('div');
    empty.className = 'custom-empty';
    empty.textContent = 'No custom sites added';
    container.appendChild(empty);
    return;
  }
  for (const domain of customBlocklist) {
    const tag = document.createElement('span');
    tag.className = 'custom-tag';
    tag.appendChild(document.createTextNode(domain));
    const btn = document.createElement('button');
    btn.dataset.remove = domain;
    btn.title = 'Remove';
    btn.setAttribute('aria-label', `Remove ${domain}`);
    btn.textContent = '×';
    tag.appendChild(btn);
    container.appendChild(tag);
  }

  container.onclick = async e => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    const s = await getSettings();
    const updated = s.customBlocklist.filter(d => d !== btn.dataset.remove);
    await saveSettings({ customBlocklist: updated });
    releaseHostPermissionFor(btn.dataset.remove);
    renderCustomList(updated);
    flashSaved('Removed');
  };
}

// The three chip rows (snooze, goal, break) all work the same way.
function bindChipRow(rowId, attr, key, current) {
  const row = document.getElementById(rowId);
  const chips = row.querySelectorAll('.snooze-chip');
  chips.forEach(chip => {
    makeKeyboardClickable(chip);
    chip.classList.toggle('selected', Number(chip.dataset[attr]) === current);
  });
  row.onclick = async e => {
    const chip = e.target.closest(`[data-${attr}]`);
    if (!chip) return;
    chips.forEach(c => c.classList.remove('selected'));
    chip.classList.add('selected');
    await saveSettings({ [key]: Number(chip.dataset[attr]) });
    flashSaved();
  };
}

function renderSnooze(settings) {
  bindChipRow('snoozeChips', 'dur', 'snoozeDuration', settings.snoozeDuration || 15);
}

function renderDailyGoal(settings) {
  bindChipRow('goalChips', 'goal', 'dailyGoal', settings.dailyGoal || 120);
}

function renderBreakReminder(settings) {
  bindChipRow('breakChips', 'break', 'breakReminder',
    settings.breakReminder != null ? settings.breakReminder : 50);
}

function fmtHour(h) {
  if (h === 0)  return '12 AM';
  if (h < 12)   return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

function renderSchedule(settings) {
  const sch        = { ...DEFAULTS.schedule, ...(settings.schedule || {}) };
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
    await saveSettings({ schedule: { ...DEFAULTS.schedule, ...s.schedule, enabled: on } });
    flashSaved();
  };

  // Populate hour selects
  const startH = document.getElementById('startHour');
  const endH   = document.getElementById('endHour');

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

  // Timeline: one segment for a same-day window, two for an overnight one
  // (start → midnight and midnight → end).
  function updateTimeline() {
    const start = Number(startH.value);
    const end   = Number(endH.value);
    const a = document.getElementById('schedTimelineFill');
    const b = document.getElementById('schedTimelineFill2');
    const seg = (el, from, to) => {
      el.style.left  = `${(from / 24) * 100}%`;
      el.style.width = `${((to - from) / 24) * 100}%`;
    };
    if (end > start) {
      seg(a, start, end); seg(b, 0, 0);
    } else if (end < start) {
      seg(a, start, 24); seg(b, 0, end);
    } else {
      seg(a, 0, 0); seg(b, 0, 0);
    }
    const now = new Date();
    document.getElementById('schedNow').style.left =
      `${((now.getHours() + now.getMinutes() / 60) / 24) * 100}%`;
  }

  function updatePreview() {
    const preview = document.getElementById('schedPreview');
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
    if (end === start) {
      preview.innerHTML = '<span style="color:var(--red)">Start and end times can’t be the same.</span>';
      preview.className = 'sched-preview live';
      return;
    }
    const overnight = end < start;
    const durH = overnight ? (24 - start) + end : end - start;
    const overnightHint = overnight
      ? ' <span style="color:var(--muted)">(overnight — ends next day)</span>'
      : '';
    preview.innerHTML =
      `Blocking <strong>${activeDays.join(', ')}</strong> ` +
      `from <strong>${fmtHour(start)}</strong> to <strong>${fmtHour(end)}</strong> ` +
      `<span style="color:var(--muted)">(${durH}h window)</span>${overnightHint}`;
    preview.className = 'sched-preview live';
  }

  async function saveHours() {
    updateTimeline();
    updatePreview();
    const s = await getSettings();
    await saveSettings({ schedule: { ...DEFAULTS.schedule, ...s.schedule, startHour: Number(startH.value), endHour: Number(endH.value) } });
    flashSaved();
  }
  startH.onchange = saveHours;
  endH.onchange   = saveHours;

  // Day chips
  const dayGrid = document.getElementById('dayGrid');
  dayGrid.textContent = '';
  for (let i = 0; i < 7; i++) {
    const chip = document.createElement('div');
    chip.className = 'day-chip' + (sch.days.includes(i) ? ' selected' : '');
    chip.textContent = DAYS[i];
    chip.dataset.day = i;
    makeKeyboardClickable(chip);
    dayGrid.appendChild(chip);
  }
  dayGrid.onclick = async e => {
    const chip = e.target.closest('[data-day]');
    if (!chip) return;
    chip.classList.toggle('selected');
    updatePreview();
    const activeDays = [...dayGrid.querySelectorAll('.day-chip.selected')].map(c => Number(c.dataset.day));
    const s = await getSettings();
    await saveSettings({ schedule: { ...DEFAULTS.schedule, ...s.schedule, days: activeDays } });
    flashSaved();
  };

  updateTimeline();
  updatePreview();
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
    removeSect.style.display = '';
    setPinBtn.textContent = 'Change PIN';
  } else {
    statusCard.classList.remove('protected');
    statusTitle.textContent = 'No PIN set';
    statusSub.textContent   = 'Your settings are unlocked';
    statusBadge.textContent = 'Unprotected';
    removeSect.style.display = 'none';
    setPinBtn.textContent = 'Set PIN';
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
  document.getElementById('confirmPin').onkeydown = e => { if (e.key === 'Enter') setPinBtn.click(); };

  document.getElementById('removePinBtn').onclick = async () => {
    if (!confirm('Remove the PIN? Anyone using this browser will be able to change settings.')) return;
    await saveSettings({ pin: null });
    msgEl.textContent = 'PIN removed';
    msgEl.className   = 'pin-msg ok';
    renderPin({ ...settings, pin: null });
    flashSaved();
  };
}

// ─── Lock-in calendar ─────────────────────────────────────────────────────────
// A GitHub-style year grid: one cell per day, shaded by how long the blocker
// was actually working that day. background.js archives each finished day into
// `dayLog`; today isn't archived until midnight, so it comes from the live
// today* counters instead — that's why nothing here double-counts.

const CAL_WEEKS  = 53;
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function calLevel(minutes, goal) {
  if (!minutes) return 0;
  const g = goal || 120;
  if (minutes >= g)        return 4;
  if (minutes >= g * 0.5)  return 3;
  if (minutes >= g * 0.25) return 2;
  return 1;
}

function describeDay(date, entry) {
  const label = date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  if (!entry || !(entry.m || entry.b || entry.s)) return `${label} — no focus time`;
  const parts = [];
  if (entry.m) parts.push(`${CF.fmtDuration(entry.m)} focused`);
  if (entry.b) parts.push(`${entry.b} AI blocked`);
  if (entry.s) parts.push(`${entry.s} solved`);
  return `${label} — ${parts.join(' · ')}`;
}

function renderCalendar(stats, settings) {
  const grid = document.getElementById('calGrid');
  const monthsEl  = document.getElementById('calMonths');
  const subEl     = document.getElementById('calSub');
  const goal      = settings.dailyGoal || 120;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayKey = CF.dayKey(today);
  const days = daysWithToday(stats);

  // Window: whole weeks, ending with the week that contains today.
  const end = CF.addDays(today, 6 - today.getDay());
  const start = CF.addDays(end, -(CAL_WEEKS * 7 - 1));

  grid.textContent = '';
  monthsEl.textContent = '';

  const LABEL_SPAN = 3;
  // The window opens mid-month, so seed with that month: labelling the partial
  // first column would crowd out the real label for the month that follows it.
  let lastLabelMonth = start.getMonth();
  let lastLabelWeek  = -Infinity;
  let cursor = new Date(start);
  for (let week = 0; week < CAL_WEEKS; week++) {
    // Label a column when a new month begins in it. Labels are explicitly
    // placed, so two that overlap would push the whole row down — skip any
    // that can't clear the previous one's span.
    const colMonth = cursor.getMonth();
    if (colMonth !== lastLabelMonth && week < CAL_WEEKS - 1 &&
        week - lastLabelWeek >= LABEL_SPAN) {
      const label = document.createElement('span');
      label.textContent = MONTH_ABBR[colMonth];
      label.style.gridColumn = `${week + 1} / span ${LABEL_SPAN}`;
      monthsEl.appendChild(label);
      lastLabelWeek = week;
    }
    lastLabelMonth = colMonth;
    for (let d = 0; d < 7; d++) {
      const key   = CF.dayKey(cursor);
      const entry = days[key];
      const cell  = document.createElement('i');
      if (key > todayKey) {
        cell.className = 'cal-cell future';
      } else {
        const level = calLevel(entry ? entry.m || 0 : 0, goal);
        cell.className = `cal-cell l${level}${key === todayKey ? ' today' : ''}`;
        cell.title = describeDay(cursor, entry);
      }
      grid.appendChild(cell);
      cursor = CF.addDays(cursor, 1);
    }
  }

  // ── Summary line: this month, streak, year total ────────────────────────────
  const monthPrefix = todayKey.slice(0, 7);
  let monthDays = 0, yearDays = 0;
  const yearCutoff = CF.dayKey(start);
  for (const [key, entry] of Object.entries(days)) {
    if (!entry || !entry.m) continue;
    if (key >= yearCutoff) yearDays += 1;
    if (key.startsWith(monthPrefix)) monthDays += 1;
  }

  subEl.textContent = yearDays === 0
    // Nothing recorded yet — say so, rather than showing a wall of empty
    // squares that reads as a rendering failure.
    ? 'No focus time recorded yet — open a practice tab and your first square lights up'
    : `${monthDays} day${monthDays === 1 ? '' : 's'} locked in this month · ` +
      `${liveStreak(stats)} day streak · ${yearDays} days in the last year`;
}

// ─── All-time tiles + 30-day trend ────────────────────────────────────────────

function renderStats(stats, settings) {
  const set = (id, v) => { document.getElementById(id).textContent = v; };
  const goal = settings.dailyGoal || 120;
  const days = daysWithToday(stats);
  const todayLive = stats.todayDate === CF.dayKey();

  const totalMin = stats.totalMinutes || 0;
  set('tileHours', totalMin >= 60 ? `${(totalMin / 60).toFixed(1)}h` : `${totalMin}m`);
  set('tileHoursSub', `across ${stats.totalSessions || 0} blocking session${stats.totalSessions === 1 ? '' : 's'}`);
  const streak = liveStreak(stats);
  set('tileStreak', `${streak}d`);
  set('tileStreakSub', `best: ${stats.longestStreak || 0} day${stats.longestStreak === 1 ? '' : 's'}`);
  set('tileBlocks', stats.aiBlocksAvoided || 0);
  set('tileBlocksSub', `${todayLive ? stats.todayBlocks || 0 : 0} today`);
  set('tileSolved', stats.problemsSolved || 0);
  set('tileSolvedSub', `${todayLive ? stats.todaySolved || 0 : 0} today`);
  set('tileSessions', stats.focusSessionsCompleted || 0);
  const goalDays = Object.values(days).filter(e => e && e.m >= goal).length;
  set('tileGoalDays', goalDays);
  set('tileGoalSub', `hit your ${CF.fmtDuration(goal)} daily goal`);

  // 30-day bars
  const bars = document.getElementById('trendBars');
  const axis = document.getElementById('trendAxis');
  bars.textContent = ''; axis.textContent = '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const series = [];
  for (let i = 29; i >= 0; i--) {
    const d = CF.addDays(today, -i);
    const e = days[CF.dayKey(d)];
    series.push({ d, m: (e && e.m) || 0, entry: e, today: i === 0 });
  }
  const max = Math.max(goal * 1.15, ...series.map(s => s.m));
  let total = 0, active = 0;
  series.forEach((s, idx) => {
    total += s.m;
    if (s.m) active++;
    const bar = document.createElement('div');
    bar.className = 'trend-bar' + (s.m >= goal ? ' hit' : '') + (s.today ? ' today' : '');
    bar.title = describeDay(s.d, s.entry);
    const fill = document.createElement('i');
    fill.style.height = '0%';
    bar.appendChild(fill);
    bars.appendChild(bar);
    requestAnimationFrame(() => { fill.style.height = s.m ? `${Math.max(3, (s.m / max) * 100)}%` : '0%'; });

    const lbl = document.createElement('span');
    if (idx % 7 === 1 || s.today) {
      lbl.textContent = s.today ? 'Today' : s.d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
    axis.appendChild(lbl);
  });
  const goalLine = document.getElementById('trendGoal');
  goalLine.style.bottom = `${(goal / max) * 100}%`;
  set('trendGoalLbl', CF.fmtDuration(goal));
  set('trendTotal', CF.fmtDuration(total));
  set('trendSub', `focused in the last 30 days · ${active} active day${active === 1 ? '' : 's'} · ` +
    `avg ${CF.fmtDuration(active ? total / active : 0)} per active day`);
}

// ─── Data: export / import / reset ────────────────────────────────────────────

function dataMsg(text, ok) {
  const el = document.getElementById('dataMsg');
  el.textContent = text;
  el.className = 'unlock-msg ' + (ok ? 'ok' : 'err');
}

async function exportData() {
  const [settings, stats] = await Promise.all([getSettings(), getStats()]);
  const { pin, snoozeUntil, ...safeSettings } = settings;
  const payload = {
    app: 'cf-focus',
    version: chrome.runtime.getManifest().version,
    exportedAt: new Date().toISOString(),
    settings: safeSettings,
    stats,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cf-focus-backup-${CF.dayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  dataMsg('Backup downloaded.', true);
}

async function importData(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (_) {
    return dataMsg('That file isn’t valid JSON.', false);
  }
  if (!data || data.app !== 'cf-focus' || typeof data.settings !== 'object' || typeof data.stats !== 'object') {
    return dataMsg('That doesn’t look like a CF Focus backup.', false);
  }
  if (!confirm('Replace your current settings and stats with this backup?')) return;

  // Only accept keys we know, so a hand-edited file can't plant junk.
  const settings = {};
  for (const k of Object.keys(DEFAULTS)) {
    if (k !== 'pin' && k !== 'snoozeUntil' && k in data.settings) settings[k] = data.settings[k];
  }
  const stats = {};
  for (const k of Object.keys(STAT_DEFAULTS)) {
    if (k in data.stats) stats[k] = data.stats[k];
  }
  await new Promise(r => chrome.storage.local.set(stats, r));
  await saveSettings(settings);
  if (settings.theme) window.CFTheme.set(settings.theme);
  await loadAll();
  dataMsg(`Restored backup from ${data.exportedAt ? new Date(data.exportedAt).toLocaleDateString() : 'file'}.`, true);
  flashSaved('Backup restored');
}

async function resetStats() {
  if (!confirm('Reset all focus stats? This clears your lock-in calendar too and cannot be undone.')) return;
  const cleared = { ...STAT_DEFAULTS, dayLog: {}, todayDate: CF.dayKey(), sessionStart: null };
  await new Promise(r => chrome.storage.local.set(cleared, r));
  await refreshStats();
  flashSaved('Stats reset');
}

// ─── Wiring ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  checkPin();

  document.getElementById('sidebarVersion').textContent = `v${chrome.runtime.getManifest().version}`;

  // Show the shortcut the user actually has bound (it can be changed in Chrome).
  if (chrome.commands && chrome.commands.getAll) {
    chrome.commands.getAll(cmds => {
      const c = (cmds || []).find(x => x.name === 'toggle-snooze');
      const el = document.getElementById('shortcutText');
      el.textContent = '';
      if (c && c.shortcut) {
        el.appendChild(document.createTextNode('Toggle snooze with '));
        const k = document.createElement('span');
        k.className = 'kbd';
        k.textContent = c.shortcut;
        el.appendChild(k);
      } else {
        el.textContent = 'No keyboard shortcut set for snooze';
      }
    });
  }
  document.getElementById('shortcutEdit').addEventListener('click', e => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  // ─── Appearance switch ───────────────────────────────────────────────────
  const themeSeg = document.getElementById('themeSeg');
  function paintThemeSeg() {
    const pref = window.CFTheme.get();
    themeSeg.querySelectorAll('[data-theme-pref]').forEach(b => {
      b.classList.toggle('on', b.dataset.themePref === pref);
    });
  }
  themeSeg.addEventListener('click', e => {
    const btn = e.target.closest('[data-theme-pref]');
    if (!btn) return;
    window.CFTheme.set(btn.dataset.themePref);
    flashSaved();
  });
  window.CFTheme.onChange(paintThemeSeg);
  paintThemeSeg();

  // ─── Sidebar navigation (deep-linkable: options.html#schedule) ───────────
  const navItems = document.querySelectorAll('.nav-item[data-view]');
  const views    = document.querySelectorAll('.view[id^="view-"]');

  function goTo(view, push) {
    const target = document.getElementById('view-' + view);
    if (!target) return;
    navItems.forEach(n => n.classList.toggle('active', n.dataset.view === view));
    views.forEach(v => v.classList.toggle('active', v === target));
    if (push) history.replaceState(null, '', `${location.search}#${view}`);
    window.scrollTo(0, 0);
  }
  navItems.forEach(item => {
    makeKeyboardClickable(item);
    item.addEventListener('click', () => goTo(item.dataset.view, true));
  });
  document.querySelectorAll('[data-goto]').forEach(a =>
    a.addEventListener('click', e => { e.preventDefault(); goTo(a.dataset.goto, true); }));
  if (location.hash) goTo(location.hash.slice(1), false);

  document.getElementById('customAddBtn').addEventListener('click', addCustomSite);
  document.getElementById('customInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') addCustomSite();
  });

  document.getElementById('cpAddBtn').addEventListener('click', addCustomPlatform);
  document.getElementById('cpDomain').addEventListener('keydown', e => {
    if (e.key === 'Enter') addCustomPlatform();
  });

  document.getElementById('resetStatsBtn').addEventListener('click', resetStats);
  document.getElementById('exportBtn').addEventListener('click', exportData);
  const importFile = document.getElementById('importFile');
  document.getElementById('importBtn').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', () => {
    if (importFile.files[0]) importData(importFile.files[0]);
    importFile.value = '';
  });
});

async function addCustomSite() {
  const input = document.getElementById('customInput');
  const domain = CF.normalizeDomain(input.value);
  if (!domain) return;

  // Must look like a real hostname
  if (!CF.DOMAIN_RE.test(domain)) return flashInvalid(input);

  const s = await getSettings();
  if (s.customBlocklist.includes(domain)) {
    input.value = '';
    flashSaved('Already blocked');
    return;
  }
  // Blocking a practice site would block the page you're trying to work on.
  if (CF.isFocusUrl(`https://${domain}/`, s)) {
    flashInvalid(input);
    flashSaved('That’s one of your practice platforms');
    return;
  }

  // Custom blocklist sites are DNR redirect *sources* — they require host_permission.
  // For default AI sites this is granted in the manifest; for user-added sites we
  // ask via the optional permission flow so we don't have to request the entire web.
  const alreadyGranted = await hasHostPermissionFor(domain);
  if (!alreadyGranted) {
    const granted = await requestHostPermissionFor(domain);
    if (!granted) {
      flashInvalid(input);
      flashSaved('Permission needed to block that site');
      return;
    }
  }

  const updated = [...s.customBlocklist, domain];
  await saveSettings({ customBlocklist: updated });
  input.value = '';
  renderCustomList(updated);
  flashSaved('Site blocked');
}
