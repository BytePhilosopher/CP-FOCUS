// CF Focus — blocked.js
// Shown when a user tries to visit a blocked AI site.

const params   = new URLSearchParams(window.location.search);
const fromSite = params.get('from');
const domain   = params.get('domain');

// ─── Subtitle: name the site being blocked ────────────────────────────────────
if (fromSite) {
  const sub = document.getElementById('subText');
  sub.textContent = '';
  const strong = document.createElement('strong');
  strong.textContent = fromSite;
  sub.appendChild(strong);
  sub.appendChild(document.createTextNode(
    ' does not exist while you’re practising.\nThe struggle is the part that makes you better.'
  ));

  const badge = document.getElementById('siteBadge');
  badge.textContent = fromSite + ' · blocked';
  document.getElementById('siteBadgeWrap').style.display = 'block';
}

// ─── Local state ──────────────────────────────────────────────────────────────
// A single threshold: focus for `unlockAt` minutes and the AI unlock becomes
// available for `unlockMinutes`.
let unlockRule = { unlockAt: 35, unlockMinutes: 10 };
let sessionData = null;
let problemStartTime = null;
let problemPausedAt  = null;
let isHardcoreSession = false;
let timerInterval = null;
let stateInterval = null;
let tickInterval  = null;

// ─── "Go back to problem" — find an open focus tab and switch to it ──────────
document.getElementById('goBackBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, response => {
    void chrome.runtime.lastError;
    if (!response) {
      window.location.href = 'https://codeforces.com';
      return;
    }
    chrome.tabs.query({}, tabs => {
      void chrome.runtime.lastError;
      if (!tabs) {
        window.location.href = 'https://codeforces.com';
        return;
      }

      const { settings } = response;
      const platforms = {
        codeforces: ['codeforces.com'],
        leetcode:   ['leetcode.com'],
        atcoder:    ['atcoder.jp'],
        hackerrank: ['hackerrank.com'],
        codechef:   ['codechef.com'],
        cses:       ['cses.fi'],
      };

      const focusTab = tabs.find(t => {
        if (!t.url || t.url.includes('blocked.html')) return false;
        try {
          const hostname = new URL(t.url).hostname.replace(/^www\./, '');
          for (const [key, domains] of Object.entries(platforms)) {
            if (settings.enabledPlatforms.includes(key) &&
                domains.some(d => hostname === d || hostname.endsWith('.' + d))) {
              return true;
            }
          }
          if (settings.customPlatforms) {
            return settings.customPlatforms.some(cp =>
              hostname === cp.domain || hostname.endsWith('.' + cp.domain)
            );
          }
        } catch (_) {}
        return false;
      });

      if (focusTab) {
        chrome.tabs.update(focusTab.id, { active: true }, () => {
          void chrome.runtime.lastError;
          chrome.tabs.getCurrent(currentTab => {
            void chrome.runtime.lastError;
            if (currentTab) chrome.tabs.remove(currentTab.id);
          });
        });
      } else {
        const firstPlatform = settings.enabledPlatforms[0] || 'codeforces';
        window.location.href = platformUrl(firstPlatform);
      }
    });
  });
});

function platformUrl(key) {
  const urls = {
    codeforces: 'https://codeforces.com',
    leetcode:   'https://leetcode.com',
    atcoder:    'https://atcoder.jp',
    hackerrank: 'https://hackerrank.com',
    codechef:   'https://codechef.com',
    cses:       'https://cses.fi',
  };
  return urls[key] || 'https://codeforces.com';
}

// ─── Block counter — dedupe within a single tab/visit ────────────────────────
// sessionStorage persists across reloads of the same tab, so refreshing this
// page does not inflate the counter. It is cleared when the tab closes.
function countBlockOnce() {
  const KEY = 'cf-counted-at';
  const last = Number(sessionStorage.getItem(KEY) || 0);
  const now = Date.now();
  // Re-count only if a different domain is being blocked OR more than 5 min have passed
  const lastDomain = sessionStorage.getItem('cf-counted-domain') || '';
  const fresh = (now - last) > 5 * 60 * 1000 || lastDomain !== (domain || '');
  if (!fresh) return;
  sessionStorage.setItem(KEY, String(now));
  sessionStorage.setItem('cf-counted-domain', domain || '');

  chrome.storage.local.get({ aiBlocksAvoided: 0, todayBlocks: 0, todayDate: null }, result => {
    void chrome.runtime.lastError;
    const today = new Date().toISOString().slice(0, 10);
    const todayBlocks = result.todayDate === today ? (result.todayBlocks || 0) + 1 : 1;
    chrome.storage.local.set({
      aiBlocksAvoided: (result.aiBlocksAvoided || 0) + 1,
      todayBlocks,
      todayDate: today,
    }, () => { void chrome.runtime.lastError; });
  });
}
countBlockOnce();

// ─── The clock ────────────────────────────────────────────────────────────────
// One big dial counting down to the moment the AI unlock is earned — or, in a
// hardcore session, to the end of the session itself.
const CLOCK_CIRC = 923.63; // 2π × 147, matches the SVG in blocked.html

function paintClock({ eyebrow, time, cap, pct, unlocked }) {
  const t = document.getElementById('clockTime');
  const e = document.getElementById('clockEyebrow');
  const c = document.getElementById('clockCap');
  const f = document.getElementById('clockFace');
  const a = document.getElementById('clockArc');
  if (t) t.textContent = time;
  if (e) e.textContent = eyebrow;
  if (c) c.textContent = cap;
  if (f) f.classList.toggle('unlocked', !!unlocked);
  if (a) {
    const p = Math.max(0, Math.min(1, pct));
    a.style.strokeDashoffset = String(CLOCK_CIRC * (1 - p));
  }
}

function mmss(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function updateUnlockLabel() {
  const lbl = document.getElementById('unlockAiBtnLabel');
  if (lbl) lbl.textContent = `Unlock AI · ${unlockRule.unlockMinutes || 10}m`;
}

function renderTick() {
  const unlockBtn = document.getElementById('unlockAiBtn');

  // Hardcore: the only clock that matters is the session's own countdown.
  if (isHardcoreSession && sessionData) {
    const total = Math.max(1, (sessionData.duration || 45) * 60000);
    const remaining = sessionData.pausedRemainingMs
      ? sessionData.pausedRemainingMs
      : Math.max(0, sessionData.endTime - Date.now());
    paintClock({
      eyebrow: 'Hardcore lock',
      time: mmss(remaining),
      cap: 'no snooze — the session has to run out',
      pct: 1 - remaining / total,
      unlocked: false,
    });
    if (unlockBtn) unlockBtn.disabled = true;
    return;
  }

  if (!problemStartTime) {
    paintClock({
      eyebrow: 'Locked',
      time: '--:--',
      cap: 'open a practice tab to start the clock',
      pct: 0,
      unlocked: false,
    });
    if (unlockBtn) unlockBtn.disabled = true;
    return;
  }

  // Pause-aware elapsed: if the timer is paused, freeze at the paused-at moment.
  const endRef = problemPausedAt || Date.now();
  const elapsedMs = Math.max(0, endRef - problemStartTime);
  const targetMs  = Math.max(1, unlockRule.unlockAt) * 60000;
  const earned    = elapsedMs >= targetMs;

  if (earned) {
    paintClock({
      eyebrow: 'Unlocked',
      time: '00:00',
      cap: 'you earned it — the ribbon above is live',
      pct: 1,
      unlocked: true,
    });
  } else {
    paintClock({
      eyebrow: problemPausedAt ? 'Paused' : 'Locked for',
      time: mmss(targetMs - elapsedMs),
      cap: problemPausedAt ? 'timer paused — blocking is snoozed' : 'until the AI unlock',
      pct: elapsedMs / targetMs,
      unlocked: false,
    });
  }

  if (unlockBtn) unlockBtn.disabled = !earned;
}

function refreshState() {
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, response => {
    void chrome.runtime.lastError;
    if (!response) return;
    const { local, hintTiers: rule } = response;  // legacy key name
    if (rule) {
      unlockRule = { ...unlockRule, ...rule };
      updateUnlockLabel();
    }
    problemStartTime = local.problemStartTime;
    problemPausedAt  = local.problemPausedAt || null;

    const fs = local.focusSession;
    isHardcoreSession = !!(fs && fs.hardcore &&
      (fs.pausedRemainingMs > 0 || Date.now() < fs.endTime));
    if (fs) sessionData = fs;

    renderTick();
  });
}

document.getElementById('unlockAiBtn').addEventListener('click', () => {
  const btn = document.getElementById('unlockAiBtn');
  btn.disabled = true;
  const safeDomain = domain && /^([a-z0-9-]+\.)+[a-z]{2,}(\/[A-Za-z0-9_\-./]*)?$/.test(domain)
    ? domain : null;
  const targetUrl = safeDomain ? `https://${safeDomain}` : null;
  chrome.runtime.sendMessage({ type: 'EARN_UNLOCK', targetUrl }, resp => {
    void chrome.runtime.lastError;
    if (!resp || resp.ok === false) {
      btn.disabled = false;
      const lbl = document.getElementById('unlockAiBtnLabel');
      if (lbl && resp && resp.reason === 'not_earned') {
        lbl.textContent = `Need ${resp.required - resp.elapsed}m more first`;
        setTimeout(updateUnlockLabel, 2500);
      }
      return;
    }
    // Background handles the tab.update; if it didn't (no sender.tab or no
    // targetUrl), fall back here.
    if (!targetUrl) navigateToFocusPlatform();
  });
});

// ─── Session state -> show timer if active ───────────────────────────────────
chrome.runtime.sendMessage({ type: 'GET_STATE' }, response => {
  void chrome.runtime.lastError;
  if (!response) return;
  const { local } = response;
  const now = Date.now();
  sessionData = local.focusSession;
  const isSession = sessionData && (sessionData.pausedRemainingMs > 0 || now < sessionData.endTime);

  if (isSession) {
    document.getElementById('sessionCard').style.display = 'flex';
    if (sessionData.hardcore) {
      document.getElementById('hcBadge').style.display = 'inline-flex';
      document.getElementById('solvedBtn').style.display = 'none';
    }
    renderBigTimer();
    // Tick only when the session isn't paused (snoozed)
    if (!sessionData.pausedRemainingMs) {
      timerInterval = setInterval(() => {
        if (sessionData && Date.now() >= sessionData.endTime) {
          clearInterval(timerInterval);
          window.location.reload();
          return;
        }
        renderBigTimer();
      }, 1000);
    }
  }

  // refreshState() syncs settings + problemStartTime from the background (slow);
  // renderTick() updates the dial locally every second (fast, no IPC).
  refreshState();
  stateInterval = setInterval(refreshState, 30000);
  tickInterval  = setInterval(renderTick, 1000);
});

function renderBigTimer() {
  if (!sessionData) return;
  const remaining = sessionData.pausedRemainingMs
    ? sessionData.pausedRemainingMs
    : Math.max(0, sessionData.endTime - Date.now());
  // Same rounding as the big clock, so the two never disagree by a second.
  document.getElementById('sessionTimerBig').textContent = mmss(remaining);
}

// ─── "I solved it" button ────────────────────────────────────────────────────
document.getElementById('solvedBtn').addEventListener('click', () => {
  const btn = document.getElementById('solvedBtn');
  btn.disabled = true;

  const isHardcore = sessionData && sessionData.hardcore;

  chrome.storage.local.get({ problemsSolved: 0, todaySolved: 0, todayDate: null }, result => {
    void chrome.runtime.lastError;
    const today = new Date().toISOString().slice(0, 10);
    const todaySolved = result.todayDate === today ? (result.todaySolved || 0) + 1 : 1;
    chrome.storage.local.set({
      problemsSolved: (result.problemsSolved || 0) + 1,
      todaySolved,
      todayDate: today,
    }, () => { void chrome.runtime.lastError; });
  });

  document.getElementById('actions').style.display    = 'none';
  document.getElementById('successMsg').style.display = 'block';

  if (isHardcore) {
    document.getElementById('successTitle').textContent = 'Problem marked as solved!';
    document.getElementById('successSub').textContent   = 'Hardcore mode stays active — keep going!';
    setTimeout(navigateToFocusPlatform, 2000);
  } else {
    const unlockMin = unlockRule.unlockMinutes || 10;
    document.getElementById('successTitle').textContent = `Problem solved! Unlocking AI for ${unlockMin} min…`;
    document.getElementById('successSub').textContent   = domain
      ? `Opening ${domain}…`
      : 'Unblocking…';

    chrome.runtime.sendMessage({ type: 'SNOOZE', minutes: unlockMin }, resp => {
      void chrome.runtime.lastError;
      if (resp && resp.ok === false) {
        document.getElementById('successSub').textContent = 'Could not unlock — try again.';
        btn.disabled = false;
        document.getElementById('actions').style.display    = 'flex';
        document.getElementById('successMsg').style.display = 'none';
        return;
      }
      setTimeout(() => {
        const safeDomain = domain && /^([a-z0-9-]+\.)+[a-z]{2,}(\/[A-Za-z0-9_\-./]*)?$/.test(domain)
          ? domain : null;
        if (safeDomain) window.location.href = `https://${safeDomain}`;
        else navigateToFocusPlatform();
      }, 300);
    });
  }
});

function navigateToFocusPlatform() {
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, response => {
    void chrome.runtime.lastError;
    const platform = response && response.settings && response.settings.enabledPlatforms
      ? response.settings.enabledPlatforms[0]
      : 'codeforces';
    window.location.href = platformUrl(platform);
  });
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────
window.addEventListener('unload', () => {
  if (timerInterval) clearInterval(timerInterval);
  if (stateInterval) clearInterval(stateInterval);
  if (tickInterval)  clearInterval(tickInterval);
});
