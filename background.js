// CF Focus — background.js
// Stateless design: queries all tabs on every event (reliable across SW restarts)

importScripts('common.js');

const { DEFAULT_BLOCKED, DEFAULT_SETTINGS } = self.CF;

// ─── Storage helpers ──────────────────────────────────────────────────────────

function getSettings() {
  return new Promise(resolve => chrome.storage.sync.get(DEFAULT_SETTINGS, resolve));
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
    focusSessionsCompleted: 0,
    aiBlocksAvoided: 0,
    problemsSolved: 0,
    // Unlock timer — paused when snoozed/scheduled-off, reset when focus tabs close.
    problemStartTime: null,   // effective start (already shifted forward for paused intervals)
    problemPausedAt: null,    // timestamp when timer was paused, null if running
    // The popup's count-up clock. Tied purely to "is a practice tab open" —
    // it keeps running through a snooze and resets only when the last
    // competitive-programming tab is closed.
    focusClockStart: null,
    lastBreakAt: null,        // last break-reminder notification, within this clock run
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

// ─── Serialized work queue ────────────────────────────────────────────────────
// Every read-modify-write of local state and every DNR update goes through
// this chain. Without it, two syncs racing (e.g. a tab event and an alarm)
// would both remove-then-add the same rule IDs and one would throw, and two
// counter bumps could read the same old value and lose an increment.
let queue = Promise.resolve();
function enqueue(fn) {
  const run = queue.then(fn);
  queue = run.catch(err => console.error('CF Focus:', err));
  return run;
}

// ─── Lock-in calendar ─────────────────────────────────────────────────────────
// One compact entry per day: m=minutes, b=AI blocks resisted, s=problems solved,
// n=stat sessions. Kept for ~400 days so the year grid always has a full window.
const DAY_LOG_KEEP_DAYS = 400;

function dayLogCutoff() {
  return CF.dayKey(CF.addDays(new Date(), -DAY_LOG_KEEP_DAYS));
}

function pruneDayLog(dayLog) {
  const cutoff = dayLogCutoff();
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
  if (!date || date < dayLogCutoff()) return log;
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

// A focus session counts as live while it's running or frozen by a snooze.
function activeSession(local, now = Date.now()) {
  const fs = local.focusSession;
  return fs && (fs.pausedRemainingMs > 0 || now < fs.endTime) ? fs : null;
}

function sessionRemainingMs(fs, now = Date.now()) {
  return fs.pausedRemainingMs > 0 ? fs.pausedRemainingMs : Math.max(0, fs.endTime - now);
}

// The stored streak only changes when a session ends, so it goes stale the
// day after you stop. Report it as broken once a whole day has been missed.
function liveStreak(local) {
  const today = CF.dayKey();
  const yesterday = CF.dayKey(CF.addDays(new Date(), -1));
  return (local.lastSessionDate === today || local.lastSessionDate === yesterday)
    ? (local.currentStreak || 0) : 0;
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
  const today = CF.dayKey();
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

function debouncedSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncTimer = null; syncBlockingState(); }, 150);
}

function syncBlockingState() {
  return enqueue(doSyncBlockingState);
}

// ─── Core: sync blocking state ────────────────────────────────────────────────

async function doSyncBlockingState() {
  const [settings, rawLocal] = await Promise.all([getSettings(), getLocalState()]);
  const local = await ensureToday(rawLocal);

  const tabs = await chrome.tabs.query({});
  const focusTabs = tabs.filter(t => CF.isFocusUrl(t.url, settings));
  const hasFocusTabs = focusTabs.length > 0;

  const now = Date.now();
  const isSnoozed = !!(settings.snoozeUntil && now < settings.snoozeUntil);
  const isScheduleActive = checkSchedule(settings.schedule);
  // A paused session is still "active" (frozen) — it should keep blocking from re-engaging
  // when the user closes focus tabs during a snooze.
  const session = activeSession(local, now);
  const isHardcoreSession = !!(session && session.hardcore);
  const block = !isSnoozed && (hasFocusTabs || isScheduleActive || !!session);

  // ─── Unlock-timer state machine ───────────────────────────────────────────
  // Run when the user has focus tabs open AND blocking is currently in effect
  // AND we aren't in a hardcore session (which disables the unlock).
  const shouldRunUnlockTimer = hasFocusTabs && block && !isHardcoreSession;
  const timerPatch = {};
  if (!hasFocusTabs) {
    // No focus tab — reset the cycle entirely.
    if (local.problemStartTime !== null || local.problemPausedAt !== null) {
      timerPatch.problemStartTime = null;
      timerPatch.problemPausedAt  = null;
    }
  } else if (shouldRunUnlockTimer) {
    if (local.problemPausedAt) {
      // Resume — shift start forward by the paused duration.
      timerPatch.problemStartTime = local.problemStartTime + (now - local.problemPausedAt);
      timerPatch.problemPausedAt  = null;
    } else if (!local.problemStartTime) {
      // Fresh start.
      timerPatch.problemStartTime = now;
      timerPatch.problemPausedAt  = null;
    }
  } else if (local.problemStartTime && !local.problemPausedAt) {
    // Pause (snoozed, scheduled off, or hardcore on).
    timerPatch.problemPausedAt = now;
  }

  // ─── Count-up focus clock ─────────────────────────────────────────────────
  // Starts the moment a practice tab appears and resets the moment the last one
  // closes. Deliberately independent of `block` so snoozing doesn't wipe it.
  const clockPatch = {};
  if (hasFocusTabs && !local.focusClockStart) {
    clockPatch.focusClockStart = now;
    clockPatch.lastBreakAt = null;
  } else if (!hasFocusTabs && local.focusClockStart) {
    clockPatch.focusClockStart = null;
    clockPatch.lastBreakAt = null;
  }

  // ─── Focus session pause-during-snooze ────────────────────────────────────
  // If the user is in a non-hardcore focus session and snooze starts, pause it.
  // When snooze ends we resume by re-extending endTime.
  const sessionPatch = {};
  if (session) {
    if (!session.hardcore && isSnoozed && !session.pausedRemainingMs) {
      // Pause: store remaining ms and clear the alarm
      const remaining = Math.max(0, session.endTime - now);
      sessionPatch.focusSession = { ...session, pausedRemainingMs: remaining };
      try { await chrome.alarms.clear('session-end'); } catch (_) {}
    } else if (!isSnoozed && session.pausedRemainingMs) {
      // Resume: re-extend endTime and recreate the alarm
      const newEnd = now + session.pausedRemainingMs;
      sessionPatch.focusSession = { ...session, endTime: newEnd, pausedRemainingMs: null };
      try { await chrome.alarms.create('session-end', { delayInMinutes: session.pausedRemainingMs / 60000 }); } catch (_) {}
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

  // Badge: minutes left in a session, "zz" while snoozed, ON while blocking.
  const liveSession = sessionPatch.focusSession || session;
  let badgeText = '', badgeColor = '#c8191c';
  if (isSnoozed) {
    badgeText = 'zz'; badgeColor = '#6b6b76';
  } else if (liveSession) {
    badgeText = `${Math.max(1, Math.ceil(sessionRemainingMs(liveSession, now) / 60000))}m`;
    badgeColor = liveSession.hardcore ? '#8d1013' : '#c8191c';
  } else if (block) {
    badgeText = 'ON';
  }
  await chrome.action.setBadgeText({ text: badgeText });
  await chrome.action.setBadgeBackgroundColor({ color: badgeColor });
  try { await chrome.action.setBadgeTextColor({ color: '#ffffff' }); } catch (_) {}

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

  const today = CF.dayKey();
  const yesterday = CF.dayKey(CF.addDays(new Date(), -1));
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

// ─── Counters bumped from the UI ──────────────────────────────────────────────
// These go through the queue and ensureToday() so a bump that lands just after
// midnight archives yesterday first instead of overwriting it.

function bumpCounters(fields) {
  return enqueue(async () => {
    const local = await ensureToday(await getLocalState());
    const patch = {};
    for (const [key, todayKey] of fields) {
      patch[key] = (local[key] || 0) + 1;
      patch[todayKey] = (local[todayKey] || 0) + 1;
    }
    await chrome.storage.local.set(patch);
    return { ...local, ...patch };
  });
}

// ─── Break reminder ───────────────────────────────────────────────────────────
// Measured from when the practice tab opened (or the last reminder), so it
// fires every N minutes of continuous practice and restarts with a fresh tab.

async function checkBreakReminder(settings, local) {
  if (!settings.breakReminder || settings.breakReminder <= 0) return;
  if (!local.focusClockStart) return;

  const since = Math.max(local.focusClockStart, local.lastBreakAt || 0);
  if (Date.now() - since < settings.breakReminder * 60000) return;

  const totalMin = Math.round((Date.now() - local.focusClockStart) / 60000);
  await chrome.storage.local.set({ lastBreakAt: Date.now() });
  try {
    await chrome.notifications.create('break-reminder', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Time for a break',
      message: `You've been at it for ${CF.fmtDuration(totalMin)}. Stand up, stretch, drink some water.`,
    });
  } catch (_) {
    // Notifications permission may not be granted — fail silently
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
    await syncBlockingState();
    await enqueue(async () => {
      const [settings, local] = await Promise.all([getSettings(), getLocalState()]);
      await checkBreakReminder(settings, local);
    });
  } else if (alarm.name === 'session-end') {
    const local = await enqueue(async () => {
      const l = await ensureToday(await getLocalState());
      const done = (l.focusSessionsCompleted || 0) + 1;
      await chrome.storage.local.set({ focusSession: null, focusSessionsCompleted: done });
      return l;
    });
    await syncBlockingState();
    const mins = (local.focusSession && local.focusSession.duration) || 0;
    try {
      await chrome.notifications.create('session-complete', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Focus session complete',
        message: `${CF.fmtDuration(mins)} done. Today: ${local.todaySolved || 0} solved, ` +
                 `${local.todayBlocks || 0} AI visits resisted.`,
      });
    } catch (_) {}
  } else if (alarm.name === 'midnight-reset') {
    // Force today's counters to roll over and re-sync the badge/UI.
    await syncBlockingState();
  }
});

// ─── Messages from popup / options / blocked page ─────────────────────────────

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

async function openPracticeTab(sender, replaceSender) {
  const settings = await getSettings();
  const allTabs = await chrome.tabs.query({});
  const existing = allTabs.find(t => CF.isFocusUrl(t.url, settings));
  const senderTab = sender && sender.tab;

  if (existing) {
    try {
      await chrome.tabs.update(existing.id, { active: true });
      await chrome.windows.update(existing.windowId, { focused: true });
    } catch (_) {}
    // The block page has done its job once the user is back on the problem.
    if (replaceSender && senderTab && senderTab.id !== existing.id) {
      try { await chrome.tabs.remove(senderTab.id); } catch (_) {}
    }
    return { ok: true, focused: true };
  }

  const url = CF.firstPracticeUrl(settings);
  if (replaceSender && senderTab) {
    await chrome.tabs.update(senderTab.id, { url });
  } else {
    await chrome.tabs.create({ url });
  }
  return { ok: true, opened: url };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {

        case 'START_SESSION': {
          const duration = clampInt(msg.duration, 5, 240, 50);
          const hardcore = !!msg.hardcore;
          const endTime = Date.now() + duration * 60000;
          const current = activeSession(await getLocalState());
          if (current && current.hardcore) {
            sendResponse({ ok: false, reason: 'hardcore' });
            return;
          }
          await chrome.storage.local.set({ focusSession: { endTime, hardcore, duration, startedAt: Date.now() } });
          // Starting a session means you want blocking now — cancel any snooze.
          await chrome.storage.sync.set({ snoozeUntil: 0, sessionLength: duration });
          await chrome.alarms.clear('snooze-end');
          await chrome.alarms.create('session-end', { delayInMinutes: duration });
          await syncBlockingState();
          sendResponse({ ok: true });
          return;
        }

        case 'END_SESSION': {
          const lEnd = await getLocalState();
          const s = activeSession(lEnd);
          if (s && s.hardcore) {
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
          const s = activeSession(l);
          if (s && s.hardcore) {
            sendResponse({ ok: false, reason: 'hardcore' });
            return;
          }
          const minutes = clampInt(msg.minutes, 1, 240, 15);
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
          const s = activeSession(hl);
          if (s && s.hardcore) {
            sendResponse({ ok: false, reason: 'hardcore' });
            return;
          }
          const tiers = { ...DEFAULT_SETTINGS.hintTiers, ...(hSettings.hintTiers || {}) };
          const elapsedMin = Math.floor(effectiveElapsedMs(hl) / 60000);
          if (elapsedMin < tiers.unlockAt) {
            sendResponse({ ok: false, reason: 'not_earned', elapsed: elapsedMin, required: tiers.unlockAt });
            return;
          }
          const unlockMin = tiers.unlockMinutes;
          const unlockUntil = Date.now() + unlockMin * 60000;
          await chrome.storage.sync.set({ snoozeUntil: unlockUntil });
          await chrome.alarms.create('snooze-end', { delayInMinutes: unlockMin });
          // NOTE: we deliberately do NOT reset problemStartTime — the user has
          // earned the unlock; after the snooze ends it stays earned until they
          // close the focus tab or mark the problem solved.
          await syncBlockingState();
          // After rules are cleared, redirect the requesting tab to the AI site.
          // Doing it server-side avoids any race between client navigation and DNR rule update.
          if (sender && sender.tab && msg.targetUrl) {
            try {
              await chrome.tabs.update(sender.tab.id, { url: msg.targetUrl });
            } catch (_) {}
          }
          sendResponse({ ok: true, unlockMin });
          return;
        }

        case 'OPEN_FOCUS_TAB': {
          // Focus an already-open practice tab if there is one, otherwise open
          // the first enabled platform. Opening the tab is what starts the
          // count-up clock — syncBlockingState picks it up from the tab event.
          // With replaceSender (the block page), the calling tab is closed or
          // reused instead of leaving a dead block page behind.
          sendResponse(await openPracticeTab(sender, !!msg.replaceSender));
          return;
        }

        case 'RESET_UNLOCK_TIMER': {
          // User manually restarts the cycle (e.g. switched to a new problem)
          await enqueue(async () => {
            const l = await getLocalState();
            const now = Date.now();
            await chrome.storage.local.set({
              problemStartTime: l.problemStartTime ? now : null,
              problemPausedAt: l.problemPausedAt ? now : null,
            });
          });
          sendResponse({ ok: true });
          return;
        }

        case 'RECORD_SOLVED': {
          const l = await bumpCounters([['problemsSolved', 'todaySolved']]);
          // A solved problem starts the next one's unlock clock from zero.
          if (!msg.keepTimer) {
            await enqueue(async () => {
              const cur = await getLocalState();
              if (!cur.problemStartTime) return;
              const now = Date.now();
              await chrome.storage.local.set({
                problemStartTime: now,
                problemPausedAt: cur.problemPausedAt ? now : null,
              });
            });
          }
          sendResponse({ ok: true, todaySolved: l.todaySolved, problemsSolved: l.problemsSolved });
          return;
        }

        case 'UNDO_SOLVED': {
          const l = await enqueue(async () => {
            const cur = await ensureToday(await getLocalState());
            const patch = {
              problemsSolved: Math.max(0, (cur.problemsSolved || 0) - 1),
              todaySolved: Math.max(0, (cur.todaySolved || 0) - 1),
            };
            await chrome.storage.local.set(patch);
            return { ...cur, ...patch };
          });
          sendResponse({ ok: true, todaySolved: l.todaySolved });
          return;
        }

        case 'RECORD_BLOCK': {
          const l = await bumpCounters([['aiBlocksAvoided', 'todayBlocks']]);
          sendResponse({ ok: true, todayBlocks: l.todayBlocks });
          return;
        }

        case 'SETTINGS_CHANGED': {
          await syncBlockingState();
          sendResponse({ ok: true });
          return;
        }

        case 'GET_STATE': {
          const settings = await getSettings();
          const local = await enqueue(async () => ensureToday(await getLocalState()));
          const tabs = await chrome.tabs.query({});
          const focusTabCount = tabs.filter(t => CF.isFocusUrl(t.url, settings)).length;

          // Calculate live today minutes (include current active session)
          let liveTodayMinutes = local.todayMinutes || 0;
          if (local.sessionStart) {
            const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
            liveTodayMinutes += Math.round((Date.now() - Math.max(local.sessionStart, midnight.getTime())) / 60000);
          }

          // Has the AI unlock been earned? Never, during a hardcore session.
          const tiers = { ...DEFAULT_SETTINGS.hintTiers, ...(settings.hintTiers || {}) };
          const session = activeSession(local);
          const hardcoreActive = !!(session && session.hardcore);
          const elapsedMs = hardcoreActive ? 0 : effectiveElapsedMs(local);
          const unlockElapsed = Math.floor(elapsedMs / 60000);
          const unlockEarned = !hardcoreActive && unlockElapsed >= tiers.unlockAt;

          sendResponse({
            settings, local, focusTabCount, liveTodayMinutes,
            unlockEarned, unlockElapsed, hintTiers: tiers, hardcoreActive,
            streak: liveStreak(local),
            session,
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
    const s = activeSession(local);
    if (s && s.hardcore) return;
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
// Snooze changes are always followed by an explicit sync; theme and the
// remembered session length don't affect blocking at all.

const NO_SYNC_KEYS = new Set(['snoozeUntil', 'theme', 'sessionLength']);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && Object.keys(changes).some(k => !NO_SYNC_KEYS.has(k))) debouncedSync();
});

// ─── Init — ensure alarms exist on every SW wake ──────────────────────────────

function nextLocalMidnight() {
  const next = new Date();
  next.setHours(24, 0, 10, 0); // 00:00:10 next day
  return next.getTime();
}

async function ensureAlarms() {
  const existing = await chrome.alarms.get('schedule-check');
  if (!existing) {
    await chrome.alarms.create('schedule-check', { periodInMinutes: 1 });
  }
  // Midnight rollover — guarantees today's counters reset even if no events
  // fire across midnight. One-shot and re-armed on each wake, so it tracks
  // local midnight through DST changes instead of drifting by an hour.
  const midnightAlarm = await chrome.alarms.get('midnight-reset');
  if (!midnightAlarm || midnightAlarm.periodInMinutes || midnightAlarm.scheduledTime < Date.now()) {
    await chrome.alarms.create('midnight-reset', { when: nextLocalMidnight() });
  }
  const local = await getLocalState();
  if (local.focusSession && !local.focusSession.pausedRemainingMs) {
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

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'midnight-reset') {
    chrome.alarms.create('midnight-reset', { when: nextLocalMidnight() });
  }
});

async function init() {
  await ensureAlarms();
  await syncBlockingState();
}

chrome.runtime.onInstalled.addListener(async details => {
  await init();
  if (details.reason === 'install') {
    // First-run: open the options page so the user can configure platforms and PIN.
    try {
      await chrome.tabs.create({ url: chrome.runtime.getURL('options.html?welcome=1') });
    } catch (_) {}
  }
});
chrome.runtime.onStartup.addListener(init);
init();
