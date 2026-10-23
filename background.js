// CF Focus v2.1 — background.js
// Stateless design: queries all tabs on every event (reliable across SW restarts)

const PLATFORMS = {
  codeforces: { name: 'Codeforces',  domains: ['codeforces.com'] },
  leetcode:   { name: 'LeetCode',    domains: ['leetcode.com'] },
  atcoder:    { name: 'AtCoder',     domains: ['atcoder.jp'] },
  hackerrank: { name: 'HackerRank',  domains: ['hackerrank.com'] },
  codechef:   { name: 'CodeChef',    domains: ['codechef.com'] },
  cses:       { name: 'CSES',        domains: ['cses.fi'] },
};

const PLATFORM_URLS = {
  codeforces: 'https://codeforces.com',
  leetcode:   'https://leetcode.com',
  atcoder:    'https://atcoder.jp',
  hackerrank: 'https://hackerrank.com',
  codechef:   'https://codechef.com',
  cses:       'https://cses.fi',
};

const DEFAULT_BLOCKED = [
  { id: 'chatgpt',    domain: 'chatgpt.com',            name: 'ChatGPT' },
  { id: 'openai',     domain: 'chat.openai.com',        name: 'OpenAI Chat' },
  { id: 'claude',     domain: 'claude.ai',              name: 'Claude' },
  { id: 'gemini',     domain: 'gemini.google.com',      name: 'Gemini' },
  { id: 'copilot',    domain: 'copilot.microsoft.com',  name: 'Copilot' },
  { id: 'bingchat',   domain: 'bing.com',     path: '/chat', name: 'Bing Chat' },
  { id: 'perplexity', domain: 'perplexity.ai',          name: 'Perplexity' },
  { id: 'phind',      domain: 'phind.com',              name: 'Phind' },
  { id: 'poe',        domain: 'poe.com',                name: 'Poe' },
  { id: 'deepseek',   domain: 'deepseek.com',           name: 'DeepSeek' },
  { id: 'grok',       domain: 'grok.com',               name: 'Grok' },
  { id: 'mistral',    domain: 'mistral.ai',             name: 'Mistral' },
  { id: 'you',        domain: 'you.com',                name: 'You.com' },
  { id: 'cohere',     domain: 'cohere.com',             name: 'Cohere' },
  { id: 'hfchat',     domain: 'huggingface.co', path: '/chat', name: 'HF Chat' },
  { id: 'aistudio',   domain: 'aistudio.google.com',    name: 'AI Studio' },
  { id: 'writesonic', domain: 'writesonic.com',         name: 'Writesonic' },
  { id: 'xai',        domain: 'x.ai',                   name: 'xAI' },
  { id: 'character',  domain: 'character.ai',           name: 'Character.AI' },
];

// ─── Storage helpers ──────────────────────────────────────────────────────────

function getSettings() {
  return new Promise(resolve => chrome.storage.sync.get({
    enabledPlatforms: ['codeforces', 'leetcode', 'atcoder', 'hackerrank', 'codechef', 'cses'],
    disabledDefaults: [],
    customBlocklist: [],
    customPlatforms: [],
    snoozeUntil: 0,
    snoozeDuration: 15,
    schedule: { enabled: false, days: [1, 2, 3, 4, 5], startHour: 9, endHour: 21 },
    pin: null,
    theme: 'system',       // 'light' | 'dark' | 'system'
    dailyGoal: 120,        // minutes
    breakReminder: 50,     // minutes, 0 = disabled
    // Earned AI unlock (minutes of work before AI can be unlocked).
    // Key name kept as `hintTiers` only because it is already persisted in
    // users' synced settings — renaming it would silently reset their config.
    hintTiers: {
      unlockAt: 35,      // AI unlock button becomes available after this long
      unlockMinutes: 10, // how long the AI unlock lasts
    },
  }, resolve));
}

function getLocalState() {
  return new Promise(resolve => chrome.storage.local.get({
    blocking: false,
    tabCount: 0,
    sessionStart: null,
    totalSessions: 0,
    totalMinutes: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastSessionDate: null,
    focusSession: null,
    aiBlocksAvoided: 0,
    problemsSolved: 0,
    // Unlock timer — paused when snoozed/scheduled-off, reset when focus tabs close.
    problemStartTime: null,   // effective start (already shifted forward for paused intervals)
    problemPausedAt: null,    // timestamp when timer was paused, null if running
    // The popup's count-up clock. Tied purely to "is a practice tab open" —
    // it keeps running through a snooze and resets only when the last
    // competitive-programming tab is closed.
    focusClockStart: null,
    // Daily tracking
    todayDate: null,
    todayMinutes: 0,
    todayBlocks: 0,
    todaySolved: 0,
    todaySessions: 0,
    // Per-day history for the lock-in calendar: { 'YYYY-MM-DD': {m, b, s, n} }
    dayLog: {},
  }, resolve));
}

// ─── Lock-in calendar ─────────────────────────────────────────────────────────
// One compact entry per day: m=minutes, b=AI blocks resisted, s=problems solved,
// n=stat sessions. Kept for ~400 days so the year grid always has a full window.
const DAY_LOG_KEEP_DAYS = 400;

function pruneDayLog(dayLog) {
  const cutoff = new Date(Date.now() - DAY_LOG_KEEP_DAYS * 86400000)
    .toISOString().slice(0, 10);
  const out = {};
  for (const [date, entry] of Object.entries(dayLog || {})) {
    if (date >= cutoff) out[date] = entry;
  }
  return out;
}

// Archive a finished day. The live "today" counters stay the source of truth
// until midnight, so clients overlay them on top of the log for today's cell —
// that keeps this a single write per day and makes double-counting impossible.
function archiveDay(dayLog, date, entry) {
  const log = pruneDayLog(dayLog);
  if (!date) return log;
  const m = entry.m || 0, b = entry.b || 0, s = entry.s || 0, n = entry.n || 0;
  if (m || b || s || n) log[date] = { m, b, s, n };
  return log;
}

// ─── Unlock-timer state machine ───────────────────────────────────────────────
// The unlock timer runs while:
//   • the user has a focus tab open
//   • blocking is currently active (not snoozed off, not scheduled off)
//   • the focus session is not hardcore (hardcore disables the unlock entirely)
// It pauses on snooze (preserving elapsed) and resets only when all focus tabs close.
function effectiveElapsedMs(local) {
  if (!local.problemStartTime) return 0;
  const end = local.problemPausedAt || Date.now();
  return Math.max(0, end - local.problemStartTime);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getActivePlatform(url) {
  if (!url) return null;
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    for (const [key, p] of Object.entries(PLATFORMS)) {
      if (p.domains.some(d => hostname === d || hostname.endsWith('.' + d))) return key;
    }
  } catch (_) {}
  return null;
}

function isCustomPlatform(url, customPlatforms) {
  if (!url || !customPlatforms || !customPlatforms.length) return false;
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return customPlatforms.some(cp =>
      hostname === cp.domain || hostname.endsWith('.' + cp.domain)
    );
  } catch (_) {}
  return false;
}

function isFocusTab(tab, settings) {
  const p = getActivePlatform(tab.url);
  if (p && settings.enabledPlatforms.includes(p)) return true;
  return isCustomPlatform(tab.url, settings.customPlatforms);
}

function checkSchedule(schedule) {
  if (!schedule || !schedule.enabled) return false;
  if (!schedule.days || !schedule.days.length) return false;
  const d = new Date();
  const hour = d.getHours();
  const day = d.getDay();
  const start = schedule.startHour;
  const end = schedule.endHour;
  if (start === end) return false;
  if (start < end) {
    // Same-day window (e.g. 09:00 → 21:00)
    return schedule.days.includes(day) && hour >= start && hour < end;
  }
  // Overnight window (e.g. 22:00 → 02:00) — active if today after start OR yesterday's day is selected and hour < end
  if (hour >= start) return schedule.days.includes(day);
  if (hour < end) {
    const prev = (day + 6) % 7;
    return schedule.days.includes(prev);
  }
  return false;
}

function makeDNRRule(id, domain, name, path) {
  // For host-only blocks, use the URL filter shorthand "||domain^" which matches the entire host.
  // For host+path blocks, use a regex so we only block the specific path under that host.
  const displayDomain = path ? `${domain}${path}` : domain;
  const condition = path
    ? {
        // Match scheme://[anything.]domain<path>... — anchor on the host boundary.
        regexFilter: `^https?://([a-z0-9-]+\\.)*${domain.replace(/\./g, '\\.')}${path.replace(/\//g, '\\/')}`,
        resourceTypes: ['main_frame'],
      }
    : {
        urlFilter: `||${domain}^`,
        resourceTypes: ['main_frame'],
      };
  return {
    id,
    priority: 1,
    action: {
      type: 'redirect',
      redirect: {
        extensionPath: `/blocked.html?from=${encodeURIComponent(name)}&domain=${encodeURIComponent(displayDomain)}`,
      },
    },
    condition,
  };
}

// Reset daily counters if date has changed
async function ensureToday(local) {
  const today = todayStr();
  if (local.todayDate !== today) {
    // Roll the outgoing day into the lock-in calendar before clearing counters.
    const dayLog = archiveDay(local.dayLog, local.todayDate, {
      m: local.todayMinutes, b: local.todayBlocks,
      s: local.todaySolved,  n: local.todaySessions,
    });
    const reset = {
      todayDate: today, todayMinutes: 0, todayBlocks: 0, todaySolved: 0, todaySessions: 0,
      dayLog,
    };
    await chrome.storage.local.set(reset);
    return { ...local, ...reset };
  }
  return local;
}

// ─── Debounced sync ───────────────────────────────────────────────────────────

let syncTimer = null;
let syncRunning = false;

function debouncedSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    if (syncRunning) return;
    syncRunning = true;
    try {
      await syncBlockingState();
    } finally {
      syncRunning = false;
    }
  }, 150);
}

// ─── Core: sync blocking state ────────────────────────────────────────────────

async function syncBlockingState() {
  const [settings, rawLocal] = await Promise.all([getSettings(), getLocalState()]);
  const local = await ensureToday(rawLocal);

  const tabs = await chrome.tabs.query({});
  const focusTabs = tabs.filter(t => isFocusTab(t, settings));
  const hasFocusTabs = focusTabs.length > 0;

  const now = Date.now();
  const isSnoozed = settings.snoozeUntil && now < settings.snoozeUntil;
  const isScheduleActive = checkSchedule(settings.schedule);
  // A paused session is still "active" (frozen) — it should keep blocking from re-engaging
  // when the user closes focus tabs during a snooze.
  const isFocusSession = local.focusSession &&
    (local.focusSession.pausedRemainingMs > 0 || now < local.focusSession.endTime);
  const isHardcoreSession = isFocusSession && local.focusSession.hardcore;
  const block = !isSnoozed && (hasFocusTabs || isScheduleActive || isFocusSession);

  // \u2500\u2500\u2500 Unlock-timer state machine \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // Run when the user has focus tabs open AND blocking is currently in effect
  // AND we aren't in a hardcore session (which disables the unlock).
  const shouldRunUnlockTimer = hasFocusTabs && block && !isHardcoreSession;
  const timerPatch = {};
  if (!hasFocusTabs) {
    // No focus tab \u2014 reset the cycle entirely.
    if (local.problemStartTime !== null || local.problemPausedAt !== null) {
      timerPatch.problemStartTime = null;
      timerPatch.problemPausedAt  = null;
    }
  } else if (shouldRunUnlockTimer) {
    if (local.problemPausedAt) {
      // Resume \u2014 shift start forward by the paused duration.
      timerPatch.problemStartTime = local.problemStartTime + (now - local.problemPausedAt);
      timerPatch.problemPausedAt  = null;
    } else if (!local.problemStartTime) {
      // Fresh start.
      timerPatch.problemStartTime = now;
      timerPatch.problemPausedAt  = null;
    }
  } else if (hasFocusTabs && !shouldRunUnlockTimer) {
    // Pause (snoozed, scheduled off, or hardcore on).
    if (local.problemStartTime && !local.problemPausedAt) {
      timerPatch.problemPausedAt = now;
    }
  }

  // \u2500\u2500\u2500 Count-up focus clock \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // Starts the moment a practice tab appears and resets the moment the last one
  // closes. Deliberately independent of `block` so snoozing doesn't wipe it.
  const clockPatch = {};
  if (hasFocusTabs && !local.focusClockStart) {
    clockPatch.focusClockStart = now;
  } else if (!hasFocusTabs && local.focusClockStart) {
    clockPatch.focusClockStart = null;
  }

  // \u2500\u2500\u2500 Focus session pause-during-snooze \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // If the user is in a non-hardcore focus session and snooze starts, pause it.
  // When snooze ends we resume by re-extending endTime.
  const sessionPatch = {};
  if (local.focusSession) {
    const fs = local.focusSession;
    if (!fs.hardcore && isSnoozed && !fs.pausedRemainingMs) {
      // Pause: store remaining ms and clear the alarm
      const remaining = Math.max(0, fs.endTime - now);
      sessionPatch.focusSession = { ...fs, pausedRemainingMs: remaining };
      try { await chrome.alarms.clear('session-end'); } catch (_) {}
    } else if (!isSnoozed && fs.pausedRemainingMs) {
      // Resume: re-extend endTime and recreate the alarm
      const newEnd = now + fs.pausedRemainingMs;
      sessionPatch.focusSession = { ...fs, endTime: newEnd, pausedRemainingMs: null };
      try { await chrome.alarms.create('session-end', { delayInMinutes: fs.pausedRemainingMs / 60000 }); } catch (_) {}
    }
  }

  const rules = [];
  let ruleId = 1;
  if (block) {
    for (const site of DEFAULT_BLOCKED) {
      if (!settings.disabledDefaults.includes(site.id)) {
        rules.push(makeDNRRule(ruleId++, site.domain, site.name, site.path));
      }
    }
    for (const domain of settings.customBlocklist) {
      rules.push(makeDNRRule(ruleId++, domain, domain));
    }
  }

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map(r => r.id),
    addRules: rules,
  });

  // Badge
  const badgeText = isFocusSession ? '\u25B6' : (block ? 'ON' : '');
  await chrome.action.setBadgeText({ text: badgeText });
  if (block) {
    await chrome.action.setBadgeBackgroundColor({ color: '#c8191c' });
  }

  if (block && !local.blocking) {
    await startSession();
  } else if (!block && local.blocking) {
    await endSession(local);
  }

  await chrome.storage.local.set({
    blocking: block,
    tabCount: focusTabs.length,
    ...timerPatch,
    ...clockPatch,
    ...sessionPatch,
  });
}

// ─── Session stats ────────────────────────────────────────────────────────────

async function startSession() {
  // Only tracks stat-session start; the unlock timer is managed separately.
  await chrome.storage.local.set({ sessionStart: Date.now() });
}

async function endSession(local) {
  if (!local.sessionStart) return;
  const durationMinutes = Math.round((Date.now() - local.sessionStart) / 60000);
  if (durationMinutes < 1) {
    await chrome.storage.local.set({ sessionStart: null });
    return;
  }

  const today = todayStr();
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  let streak = local.currentStreak || 0;

  if (local.lastSessionDate !== today) {
    streak = local.lastSessionDate === yesterday ? streak + 1 : 1;
  }

  await chrome.storage.local.set({
    totalSessions: (local.totalSessions || 0) + 1,
    totalMinutes: (local.totalMinutes || 0) + durationMinutes,
    currentStreak: streak,
    longestStreak: Math.max(local.longestStreak || 0, streak),
    lastSessionDate: today,
    sessionStart: null,
    // problemStartTime / problemPausedAt are managed in syncBlockingState.
    todayMinutes: (local.todayMinutes || 0) + durationMinutes,
    todaySessions: (local.todaySessions || 0) + 1,
  });
}

// ─── Break reminder ───────────────────────────────────────────────────────────

async function checkBreakReminder(settings, local) {
  if (!settings.breakReminder || settings.breakReminder <= 0) return;
  if (!local.sessionStart) return;

  const elapsedMin = (Date.now() - local.sessionStart) / 60000;
  if (elapsedMin >= settings.breakReminder) {
    // Only notify once per threshold crossing — use alarm to avoid repeats
    const existing = await chrome.alarms.get('break-reminder');
    if (!existing) {
      try {
        await chrome.notifications.create('break-reminder', {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'Time for a break!',
          message: `You've been focused for ${Math.round(elapsedMin)} minutes. Stand up, stretch, hydrate.`,
        });
      } catch (_) {
        // Notifications permission may not be granted — fail silently
      }
      // Set alarm to re-check in another breakReminder minutes
      await chrome.alarms.create('break-reminder', { delayInMinutes: settings.breakReminder });
    }
  }
}

// ─── Tab listeners (debounced) ────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === 'complete') debouncedSync();
});
chrome.tabs.onRemoved.addListener(() => debouncedSync());
chrome.tabs.onReplaced.addListener(() => debouncedSync());

// ─── Alarms ───────────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === 'snooze-end') {
    await chrome.storage.sync.set({ snoozeUntil: 0 });
    await syncBlockingState();
  } else if (alarm.name === 'schedule-check') {
    // Also check break reminder on each tick
    const [settings, local] = await Promise.all([getSettings(), getLocalState()]);
    await checkBreakReminder(settings, local);
    await syncBlockingState();
  } else if (alarm.name === 'session-end') {
    await chrome.storage.local.set({ focusSession: null });
    await syncBlockingState();
    try {
      await chrome.notifications.create('session-complete', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Focus session complete!',
        message: 'Great work! Your focus session has ended.',
      });
    } catch (_) {}
  } else if (alarm.name === 'break-reminder') {
    // Clear so it can fire again next interval
    await chrome.alarms.clear('break-reminder');
  } else if (alarm.name === 'midnight-reset') {
    // Force today's counters to roll over and re-sync the badge/UI.
    const local = await getLocalState();
    await ensureToday(local);
    await syncBlockingState();
  }
});

// ─── Messages from popup / options / blocked page ─────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const _sender = sender;
  (async () => {
    try {
      switch (msg.type) {

        case 'START_SESSION': {
          const { duration, hardcore } = msg;
          const endTime = Date.now() + duration * 60000;
          await chrome.storage.local.set({ focusSession: { endTime, hardcore, duration } });
          await chrome.alarms.create('session-end', { delayInMinutes: duration });
          await syncBlockingState();
          sendResponse({ ok: true });
          return;
        }

        case 'END_SESSION': {
          const lEnd = await getLocalState();
          if (lEnd.focusSession && lEnd.focusSession.hardcore) {
            sendResponse({ ok: false, reason: 'hardcore' });
            return;
          }
          await chrome.storage.local.set({ focusSession: null });
          await chrome.alarms.clear('session-end');
          await syncBlockingState();
          sendResponse({ ok: true });
          return;
        }

        case 'SNOOZE': {
          const l = await getLocalState();
          if (l.focusSession && l.focusSession.hardcore) {
            sendResponse({ ok: false, reason: 'hardcore' });
            return;
          }
          const minutes = msg.minutes || 15;
          const until = Date.now() + minutes * 60000;
          await chrome.storage.sync.set({ snoozeUntil: until });
          await chrome.alarms.create('snooze-end', { delayInMinutes: minutes });
          await syncBlockingState();
          sendResponse({ ok: true });
          return;
        }

        case 'UNSNOOZE': {
          await chrome.storage.sync.set({ snoozeUntil: 0 });
          await chrome.alarms.clear('snooze-end');
          await syncBlockingState();
          sendResponse({ ok: true });
          return;
        }

        case 'EARN_UNLOCK': {
          // Earned unlock — only honored once the user has actually put in the time.
          const [hSettings, hl] = await Promise.all([getSettings(), getLocalState()]);
          if (hl.focusSession && hl.focusSession.hardcore) {
            sendResponse({ ok: false, reason: 'hardcore' });
            return;
          }
          const tiers = hSettings.hintTiers || { unlockAt: 35, unlockMinutes: 10 };
          const elapsedMin = Math.floor(effectiveElapsedMs(hl) / 60000);
          if (elapsedMin < (tiers.unlockAt || 35)) {
            sendResponse({ ok: false, reason: 'not_earned', elapsed: elapsedMin, required: tiers.unlockAt });
            return;
          }
          const unlockMin = msg.minutes || tiers.unlockMinutes || 10;
          const unlockUntil = Date.now() + unlockMin * 60000;
          await chrome.storage.sync.set({ snoozeUntil: unlockUntil });
          await chrome.alarms.create('snooze-end', { delayInMinutes: unlockMin });
          // NOTE: we deliberately do NOT reset problemStartTime — the user has
          // earned the unlock; after the snooze ends it stays earned until they
          // close the focus tab.
          await syncBlockingState();
          // After rules are cleared, redirect the requesting tab to the AI site.
          // Doing it server-side avoids any race between client navigation and DNR rule update.
          if (_sender && _sender.tab && msg.targetUrl) {
            try {
              await chrome.tabs.update(_sender.tab.id, { url: msg.targetUrl });
            } catch (_) {}
          }
          sendResponse({ ok: true, unlockMin });
          return;
        }

        case 'OPEN_FOCUS_TAB': {
          // Focus an already-open practice tab if there is one, otherwise open
          // the first enabled platform. Opening the tab is what starts the
          // count-up clock — syncBlockingState picks it up from the tab event.
          const oSettings = await getSettings();
          const allTabs = await chrome.tabs.query({});
          const existing = allTabs.find(t => isFocusTab(t, oSettings));
          if (existing) {
            try {
              await chrome.tabs.update(existing.id, { active: true });
              await chrome.windows.update(existing.windowId, { focused: true });
            } catch (_) {}
            sendResponse({ ok: true, focused: true });
            return;
          }
          const first = oSettings.enabledPlatforms[0] || 'codeforces';
          const url = PLATFORM_URLS[first] ||
            (oSettings.customPlatforms && oSettings.customPlatforms[0]
              ? `https://${oSettings.customPlatforms[0].domain}`
              : PLATFORM_URLS.codeforces);
          await chrome.tabs.create({ url });
          sendResponse({ ok: true, opened: url });
          return;
        }

        case 'RESET_UNLOCK_TIMER': {
          // User manually restarts the cycle (e.g. switched to a new problem)
          await chrome.storage.local.set({ problemStartTime: Date.now() });
          sendResponse({ ok: true });
          return;
        }

        case 'SETTINGS_CHANGED': {
          await syncBlockingState();
          sendResponse({ ok: true });
          return;
        }

        case 'GET_STATE': {
          const settings = await getSettings();
          let local = await getLocalState();
          local = await ensureToday(local);
          const tabs = await chrome.tabs.query({});
          const focusTabCount = tabs.filter(t => isFocusTab(t, settings)).length;

          // Calculate live today minutes (include current active session)
          let liveTodayMinutes = local.todayMinutes || 0;
          if (local.sessionStart) {
            liveTodayMinutes += Math.round((Date.now() - local.sessionStart) / 60000);
          }

          // Has the AI unlock been earned? Never, during a hardcore session.
          const tiers = settings.hintTiers || { unlockAt: 35, unlockMinutes: 10 };
          const nowTs = Date.now();
          const hardcoreActive = !!(local.focusSession && local.focusSession.hardcore &&
            (local.focusSession.pausedRemainingMs > 0 || nowTs < local.focusSession.endTime));
          const elapsedMs = hardcoreActive ? 0 : effectiveElapsedMs(local);
          const unlockElapsed = Math.floor(elapsedMs / 60000);
          const unlockEarned = !hardcoreActive && unlockElapsed >= tiers.unlockAt;

          sendResponse({
            settings, local, focusTabCount, liveTodayMinutes,
            unlockEarned, unlockElapsed, hintTiers: tiers, hardcoreActive,
            // Convenience for clients: send the resolved start + pause so they can
            // tick locally between polls without re-deriving from raw fields.
            problemStartTime: local.problemStartTime,
            problemPausedAt: local.problemPausedAt,
          });
          return;
        }
      }
      sendResponse({ ok: true });
    } catch (err) {
      console.error('CF Focus: message handler error', err);
      sendResponse({ ok: false, error: err.message });
    }
  })();
  return true;
});

// ─── Keyboard shortcut ────────────────────────────────────────────────────────

chrome.commands.onCommand.addListener(async command => {
  if (command === 'toggle-snooze') {
    const [settings, local] = await Promise.all([getSettings(), getLocalState()]);
    if (local.focusSession && local.focusSession.hardcore) return;
    if (settings.snoozeUntil && Date.now() < settings.snoozeUntil) {
      await chrome.storage.sync.set({ snoozeUntil: 0 });
      await chrome.alarms.clear('snooze-end');
    } else {
      const dur = settings.snoozeDuration || 15;
      await chrome.storage.sync.set({ snoozeUntil: Date.now() + dur * 60000 });
      await chrome.alarms.create('snooze-end', { delayInMinutes: dur });
    }
    await syncBlockingState();
  }
});

// ─── Storage change listener ──────────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && !('snoozeUntil' in changes)) debouncedSync();
});

// ─── Init — ensure alarms exist on every SW wake ──────────────────────────────

async function ensureAlarms() {
  const existing = await chrome.alarms.get('schedule-check');
  if (!existing) {
    await chrome.alarms.create('schedule-check', { periodInMinutes: 1 });
  }
  // Midnight rollover — guarantees today's counters reset even if no events fire across midnight.
  const midnightAlarm = await chrome.alarms.get('midnight-reset');
  if (!midnightAlarm) {
    const next = new Date();
    next.setHours(24, 0, 10, 0); // 00:00:10 next day
    await chrome.alarms.create('midnight-reset', {
      when: next.getTime(),
      periodInMinutes: 24 * 60,
    });
  }
  const local = await getLocalState();
  if (local.focusSession && local.focusSession.endTime > Date.now()) {
    const sessionAlarm = await chrome.alarms.get('session-end');
    if (!sessionAlarm) {
      const remaining = (local.focusSession.endTime - Date.now()) / 60000;
      await chrome.alarms.create('session-end', { delayInMinutes: Math.max(0.1, remaining) });
    }
  }
  const settings = await getSettings();
  if (settings.snoozeUntil && settings.snoozeUntil > Date.now()) {
    const snoozeAlarm = await chrome.alarms.get('snooze-end');
    if (!snoozeAlarm) {
      const remaining = (settings.snoozeUntil - Date.now()) / 60000;
      await chrome.alarms.create('snooze-end', { delayInMinutes: Math.max(0.1, remaining) });
    }
  }
}

async function init() {
  await ensureAlarms();
  await syncBlockingState();
}

chrome.runtime.onInstalled.addListener(async details => {
  await init();
  if (details.reason === 'install') {
    // First-run: open the options page so the user can configure platforms and PIN.
    try {
      await chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    } catch (_) {}
  }
});
chrome.runtime.onStartup.addListener(init);
ensureAlarms().then(() => syncBlockingState());
