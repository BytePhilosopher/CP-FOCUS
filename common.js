// CF Focus — common.js
// Shared constants and helpers. Loaded by the service worker (importScripts)
// and by every extension page (<script>), so the platform and AI-site lists
// live in exactly one place.

(function (root) {
  const PLATFORMS = {
    codeforces: { name: 'Codeforces', domains: ['codeforces.com'], url: 'https://codeforces.com', abbr: 'CF' },
    leetcode:   { name: 'LeetCode',   domains: ['leetcode.com'],   url: 'https://leetcode.com',   abbr: 'LC' },
    atcoder:    { name: 'AtCoder',    domains: ['atcoder.jp'],     url: 'https://atcoder.jp',     abbr: 'AC' },
    hackerrank: { name: 'HackerRank', domains: ['hackerrank.com'], url: 'https://hackerrank.com', abbr: 'HR' },
    codechef:   { name: 'CodeChef',   domains: ['codechef.com'],   url: 'https://codechef.com',   abbr: 'CC' },
    cses:       { name: 'CSES',       domains: ['cses.fi'],        url: 'https://cses.fi',        abbr: 'CS' },
  };

  const DEFAULT_BLOCKED = [
    { id: 'chatgpt',    domain: 'chatgpt.com',           name: 'ChatGPT' },
    { id: 'openai',     domain: 'chat.openai.com',       name: 'OpenAI Chat' },
    { id: 'claude',     domain: 'claude.ai',             name: 'Claude' },
    { id: 'gemini',     domain: 'gemini.google.com',     name: 'Gemini' },
    { id: 'copilot',    domain: 'copilot.microsoft.com', name: 'Copilot' },
    { id: 'bingchat',   domain: 'bing.com', path: '/chat', name: 'Bing Chat' },
    { id: 'perplexity', domain: 'perplexity.ai',         name: 'Perplexity' },
    { id: 'phind',      domain: 'phind.com',             name: 'Phind' },
    { id: 'poe',        domain: 'poe.com',               name: 'Poe' },
    { id: 'deepseek',   domain: 'deepseek.com',          name: 'DeepSeek' },
    { id: 'grok',       domain: 'grok.com',              name: 'Grok' },
    { id: 'mistral',    domain: 'mistral.ai',            name: 'Mistral' },
    { id: 'you',        domain: 'you.com',               name: 'You.com' },
    { id: 'cohere',     domain: 'cohere.com',            name: 'Cohere' },
    { id: 'hfchat',     domain: 'huggingface.co', path: '/chat', name: 'HF Chat' },
    { id: 'aistudio',   domain: 'aistudio.google.com',   name: 'AI Studio' },
    { id: 'writesonic', domain: 'writesonic.com',        name: 'Writesonic' },
    { id: 'xai',        domain: 'x.ai',                  name: 'xAI' },
    { id: 'character',  domain: 'character.ai',          name: 'Character.AI' },
  ];

  const DEFAULT_SETTINGS = {
    enabledPlatforms: Object.keys(PLATFORMS),
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
    sessionLength: 50,     // last focus-session length picked in the popup
    // Earned AI unlock (minutes of work before AI can be unlocked).
    // Key name kept as `hintTiers` only because it is already persisted in
    // users' synced settings — renaming it would silently reset their config.
    hintTiers: { unlockAt: 35, unlockMinutes: 10 },
  };

  // Hostname check shared by every "is this a practice tab?" question.
  function hostMatches(hostname, domain) {
    return hostname === domain || hostname.endsWith('.' + domain);
  }

  function hostnameOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return null; }
  }

  function isFocusUrl(url, settings) {
    const host = url && hostnameOf(url);
    if (!host) return false;
    for (const key of settings.enabledPlatforms || []) {
      const p = PLATFORMS[key];
      if (p && p.domains.some(d => hostMatches(host, d))) return true;
    }
    return (settings.customPlatforms || []).some(cp => hostMatches(host, cp.domain));
  }

  function firstPracticeUrl(settings) {
    const key = (settings.enabledPlatforms || [])[0];
    if (key && PLATFORMS[key]) return PLATFORMS[key].url;
    const cp = (settings.customPlatforms || [])[0];
    return cp ? `https://${cp.domain}` : PLATFORMS.codeforces.url;
  }

  // Days are keyed by the user's *local* calendar date. (Earlier versions used
  // UTC, which rolled "today" over at the wrong hour for most of the world.)
  function dayKey(d) {
    d = d || new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function addDays(d, n) {
    const out = new Date(d);
    out.setDate(out.getDate() + n);
    return out;
  }

  // A plain hostname: no scheme, path or port.
  const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

  function normalizeDomain(input) {
    return String(input || '').trim().toLowerCase()
      .replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^www\./, '');
  }

  function fmtDuration(mins) {
    mins = Math.max(0, Math.round(mins || 0));
    if (mins >= 60) {
      const h = Math.floor(mins / 60), m = mins % 60;
      return m ? `${h}h ${m}m` : `${h}h`;
    }
    return `${mins}m`;
  }

  root.CF = {
    PLATFORMS, DEFAULT_BLOCKED, DEFAULT_SETTINGS, DOMAIN_RE,
    hostMatches, hostnameOf, isFocusUrl, firstPracticeUrl,
    dayKey, addDays, normalizeDomain, fmtDuration,
  };
})(typeof self !== 'undefined' ? self : this);
