// CF Focus v2.0 — background.js
// Stateless design: queries all tabs on every event (reliable across SW restarts)

const PLATFORMS = {
  codeforces: { name: 'Codeforces',  domains: ['codeforces.com'] },
  leetcode:   { name: 'LeetCode',    domains: ['leetcode.com'] },
  atcoder:    { name: 'AtCoder',     domains: ['atcoder.jp'] },
  hackerrank: { name: 'HackerRank',  domains: ['hackerrank.com'] },
  codechef:   { name: 'CodeChef',    domains: ['codechef.com'] },
  cses:       { name: 'CSES',        domains: ['cses.fi'] },
};

const DEFAULT_BLOCKED = [
  { id: 'chatgpt',    domain: 'chatgpt.com',           name: 'ChatGPT' },
  { id: 'openai',     domain: 'chat.openai.com',        name: 'OpenAI Chat' },
  { id: 'claude',     domain: 'claude.ai',              name: 'Claude' },
  { id: 'gemini',     domain: 'gemini.google.com',      name: 'Gemini' },
  { id: 'copilot',    domain: 'copilot.microsoft.com',  name: 'Copilot' },
  { id: 'bingchat',   domain: 'bing.com/chat',          name: 'Bing Chat' },
  { id: 'perplexity', domain: 'perplexity.ai',          name: 'Perplexity' },
  { id: 'phind',      domain: 'phind.com',              name: 'Phind' },
  { id: 'poe',        domain: 'poe.com',                name: 'Poe' },
  { id: 'deepseek',   domain: 'deepseek.com',           name: 'DeepSeek' },
  { id: 'grok',       domain: 'grok.com',               name: 'Grok' },
  { id: 'mistral',    domain: 'mistral.ai',             name: 'Mistral' },
  { id: 'you',        domain: 'you.com',                name: 'You.com' },
  { id: 'cohere',     domain: 'cohere.com',             name: 'Cohere' },
  { id: 'hfchat',     domain: 'huggingface.co/chat',    name: 'HF Chat' },
  { id: 'aistudio',   domain: 'aistudio.google.com',    name: 'AI Studio' },
  { id: 'writesonic', domain: 'writesonic.com',         name: 'Writesonic' },
  { id: 'xai',        domain: 'x.ai',                   name: 'xAI' },
  { id: 'character',  domain: 'character.ai',           name: 'Character.AI' },
];

// ─── Storage helpers ──────────────────────────────────────────────────────────

function getSettings() {
  return new Promise(resolve => chrome.storage.sync.get({
    enabledPlatforms: ['codeforces', 'leetcode', 'atcoder', 'hackerrank', 'codechef'],
    disabledDefaults: [],
    customBlocklist: [],
    customPlatforms: [],
    snoozeUntil: 0,
    snoozeDuration: 15,
    schedule: { enabled: false, days: [1, 2, 3, 4, 5], startHour: 9, endHour: 21 },
    pin: null,
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
    focusSession: null,   // { endTime, hardcore, duration }
    aiBlocksAvoided: 0,
    problemsSolved: 0,
  }, resolve));
}

// ─── Utilities ────────────────────────────────────────────────────────────────

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

function checkSchedule(schedule) {
  if (!schedule || !schedule.enabled) return false;
  const d = new Date();
  const day = d.getDay();
  const hour = d.getHours();
  return schedule.days.includes(day) && hour >= schedule.startHour && hour < schedule.endHour;
}

function makeDNRRule(id, domain, name) {
  return {
    id,
    priority: 1,
    action: {
      type: 'redirect',
      redirect: {
        extensionPath: `/blocked.html?from=${encodeURIComponent(name)}&domain=${encodeURIComponent(domain)}`,
      },
    },
    condition: {
      urlFilter: `*${domain}*`,
      resourceTypes: ['main_frame'],
    },
  };
}

// ─── Core: sync blocking state ────────────────────────────────────────────────

async function syncBlockingState() {
  const [settings, local] = await Promise.all([getSettings(), getLocalState()]);

  const tabs = await chrome.tabs.query({});
  const focusTabs = tabs.filter(t => {
    const p = getActivePlatform(t.url);
    if (p && settings.enabledPlatforms.includes(p)) return true;
    // Check user-added custom platforms
    if (t.url && settings.customPlatforms && settings.customPlatforms.length) {
      try {
        const hostname = new URL(t.url).hostname.replace(/^www\./, '');
        return settings.customPlatforms.some(cp =>
          hostname === cp.domain || hostname.endsWith('.' + cp.domain)
        );
      } catch (_) {}
    }
    return false;
  });

  const now = Date.now();
  const isSnoozed = settings.snoozeUntil && now < settings.snoozeUntil;
  const isScheduleActive = checkSchedule(settings.schedule);
  const isFocusSession = local.focusSession && now < local.focusSession.endTime;
  const block = !isSnoozed && (focusTabs.length > 0 || isScheduleActive || isFocusSession);

  const rules = [];
  let ruleId = 1;
  if (block) {
    for (const site of DEFAULT_BLOCKED) {
      if (!settings.disabledDefaults.includes(site.id)) {
        rules.push(makeDNRRule(ruleId++, site.domain, site.name));
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

  // Badge: ▶ during focus session, ON during passive blocking
  const badgeText = isFocusSession ? '\u25B6' : (block ? 'ON' : '');
  chrome.action.setBadgeText({ text: badgeText });
  if (block) {
    chrome.action.setBadgeBackgroundColor({ color: '#c8191c' });
  }

  if (block && !local.blocking) {
    await startSession();
  } else if (!block && local.blocking) {
    await endSession(local);
  }

  await chrome.storage.local.set({ blocking: block, tabCount: focusTabs.length });
}

// ─── Session stats ────────────────────────────────────────────────────────────

async function startSession() {
  chrome.storage.local.set({ sessionStart: Date.now() });
}

async function endSession(local) {
  if (!local.sessionStart) return;
  const durationMinutes = Math.round((Date.now() - local.sessionStart) / 60000);
  if (durationMinutes < 1) {
    chrome.storage.local.set({ sessionStart: null });
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  let streak = local.currentStreak || 0;

  if (local.lastSessionDate !== today) {
    streak = local.lastSessionDate === yesterday ? streak + 1 : 1;
  }

  chrome.storage.local.set({
    totalSessions: (local.totalSessions || 0) + 1,
    totalMinutes: (local.totalMinutes || 0) + durationMinutes,
    currentStreak: streak,
    longestStreak: Math.max(local.longestStreak || 0, streak),
    lastSessionDate: today,
    sessionStart: null,
  });
}

// ─── Tab listeners ────────────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === 'complete') syncBlockingState();
});
chrome.tabs.onRemoved.addListener(() => syncBlockingState());
chrome.tabs.onReplaced.addListener(() => syncBlockingState());

// ─── Alarms ───────────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === 'snooze-end') {
    await chrome.storage.sync.set({ snoozeUntil: 0 });
    await syncBlockingState();
  } else if (alarm.name === 'schedule-check') {
    await syncBlockingState();
  } else if (alarm.name === 'session-end') {
    await chrome.storage.local.set({ focusSession: null });
    await syncBlockingState();
  }
});

// ─── Messages from popup / options / blocked page ─────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {

      case 'START_SESSION': {
        const { duration, hardcore } = msg;
        const endTime = Date.now() + duration * 60000;
        await chrome.storage.local.set({ focusSession: { endTime, hardcore, duration } });
        chrome.alarms.create('session-end', { delayInMinutes: duration });
        await syncBlockingState();
        break;
      }

      case 'END_SESSION': {
        // Hardcore sessions cannot be manually ended — they run to completion
        const lEnd = await getLocalState();
        if (lEnd.focusSession && lEnd.focusSession.hardcore) {
          sendResponse({ ok: false, reason: 'hardcore' });
          return;
        }
        await chrome.storage.local.set({ focusSession: null });
        chrome.alarms.clear('session-end');
        await syncBlockingState();
        break;
      }

      case 'SNOOZE': {
        const l = await getLocalState();
        // Hardcore mode: snooze is completely blocked
        if (l.focusSession && l.focusSession.hardcore) {
          sendResponse({ ok: false, reason: 'hardcore' });
          return;
        }
        const until = Date.now() + msg.minutes * 60000;
        await chrome.storage.sync.set({ snoozeUntil: until });
        chrome.alarms.create('snooze-end', { delayInMinutes: msg.minutes });
        await syncBlockingState();
        break;
      }

      case 'UNSNOOZE': {
        await chrome.storage.sync.set({ snoozeUntil: 0 });
        chrome.alarms.clear('snooze-end');
        await syncBlockingState();
        break;
      }

      case 'SETTINGS_CHANGED': {
        await syncBlockingState();
        break;
      }

      case 'AI_BLOCKED': {
        // Sent by blocked.html on every load — counts resisted temptations
        const l = await getLocalState();
        await chrome.storage.local.set({ aiBlocksAvoided: (l.aiBlocksAvoided || 0) + 1 });
        sendResponse({ ok: true });
        return;
      }

      case 'MARK_SOLVED': {
        // Sent by blocked.html "I solved it" button
        const l = await getLocalState();
        await chrome.storage.local.set({ problemsSolved: (l.problemsSolved || 0) + 1 });
        sendResponse({ ok: true });
        return;
      }

      case 'GET_STATE': {
        const settings = await getSettings();
        const local = await getLocalState();
        const tabs = await chrome.tabs.query({});
        const focusTabCount = tabs.filter(t => {
          const p = getActivePlatform(t.url);
          return p && settings.enabledPlatforms.includes(p);
        }).length;
        sendResponse({ settings, local, focusTabCount });
        return;
      }
    }
    sendResponse({ ok: true });
  })();
  return true;
});

// ─── Keyboard shortcut ────────────────────────────────────────────────────────

chrome.commands.onCommand.addListener(async command => {
  if (command === 'toggle-snooze') {
    const [settings, local] = await Promise.all([getSettings(), getLocalState()]);
    // Keyboard shortcut disabled in hardcore mode
    if (local.focusSession && local.focusSession.hardcore) return;
    if (settings.snoozeUntil && Date.now() < settings.snoozeUntil) {
      await chrome.storage.sync.set({ snoozeUntil: 0 });
      chrome.alarms.clear('snooze-end');
    } else {
      const dur = settings.snoozeDuration || 15;
      await chrome.storage.sync.set({ snoozeUntil: Date.now() + dur * 60000 });
      chrome.alarms.create('snooze-end', { delayInMinutes: dur });
    }
    await syncBlockingState();
  }
});

// ─── Storage change listener ──────────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  // Only re-sync on settings changes, not snoozeUntil (handled by alarm + direct call)
  if (area === 'sync' && !('snoozeUntil' in changes)) syncBlockingState();
});

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  chrome.alarms.create('schedule-check', { periodInMinutes: 1 });
  await syncBlockingState();
}

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
