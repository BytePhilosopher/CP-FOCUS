// CF Focus — blocked.js
// Shown when a user tries to visit a blocked AI site.

const params   = new URLSearchParams(window.location.search);
const fromSite = params.get('from');
const domain   = params.get('domain');

// ─── Subtitle: name the site being blocked ────────────────────────────────────
if (fromSite) {
  const sub = document.getElementById('subText');
  sub.textContent = '';
  sub.appendChild(document.createTextNode('You’re about to use '));
  const strong = document.createElement('strong');
  strong.textContent = fromSite;
  sub.appendChild(strong);
  sub.appendChild(document.createTextNode('.\nTry harder first — that struggle is where growth lives.'));

  const badge = document.getElementById('siteBadge');
  badge.textContent = fromSite + ' is blocked';
  document.getElementById('siteBadgeWrap').style.display = 'block';
}

// ─── Random motivational quote ────────────────────────────────────────────────
const quotes = [
  '"Every problem you solve without AI is a skill you actually own."',
  '"Struggling with a problem is the feeling of your brain getting stronger."',
  '"The only way to get better at DSA is to do DSA."',
  '"Competitive programmers don’t Google their way through a contest."',
  '"Hard problems require hard thinking, not easy answers."',
  '"You opened this to practice. So practice."',
  '"The discomfort of not knowing is exactly where growth lives."',
  '"An hour of real struggle > ten minutes of AI output you don’t understand."',
  '"The rating you want is on the other side of this problem."',
];
document.getElementById('quote').textContent =
  quotes[Math.floor(Math.random() * quotes.length)];

// ─── Local state ──────────────────────────────────────────────────────────────
let sessionData = null;
let hintTiers   = { hint1At: 15, hint2At: 25, unlockAt: 35, unlockMinutes: 10 };
let problemStartTime = null;
let isHardcoreSession = false;
let timerInterval = null;
let hintInterval  = null;

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
        const urls = {
          codeforces: 'https://codeforces.com',
          leetcode:   'https://leetcode.com',
          atcoder:    'https://atcoder.jp',
          hackerrank: 'https://hackerrank.com',
          codechef:   'https://codechef.com',
          cses:       'https://cses.fi',
        };
        window.location.href = urls[firstPlatform] || 'https://codeforces.com';
      }
    });
  });
});

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

// ─── Hint timeline ────────────────────────────────────────────────────────────
function renderHintUI(tier, elapsed) {
  const trackFill = document.getElementById('hintTrackFill');
  const elapsedEl = document.getElementById('hintElapsedText');
  const steps     = document.querySelectorAll('#hintSteps .hint-step');

  // Tier-time labels reflect the user's configured thresholds
  const t0 = document.getElementById('tierTime0');
  const t1 = document.getElementById('tierTime1');
  const t2 = document.getElementById('tierTime2');
  const t3 = document.getElementById('tierTime3');
  if (t0) t0.textContent = `<${hintTiers.hint1At}m`;
  if (t1) t1.textContent = `${hintTiers.hint1At}m`;
  if (t2) t2.textContent = `${hintTiers.hint2At}m`;
  if (t3) t3.textContent = `${hintTiers.unlockAt}m`;

  if (elapsedEl) {
    elapsedEl.textContent = problemStartTime
      ? `${elapsed}m focused`
      : 'not yet tracking';
  }

  // Track fill: percentage toward final unlock
  const target = Math.max(1, hintTiers.unlockAt);
  const pct = Math.min(100, Math.round((elapsed / target) * 100));
  if (trackFill) {
    trackFill.style.width = `${pct}%`;
    trackFill.classList.remove('t0', 't1', 't2', 't3');
    trackFill.classList.add(`t${tier}`);
  }

  // Active / reached steps
  steps.forEach(step => {
    const stepTier = Number(step.dataset.tier);
    step.classList.remove('active', 't0', 't3');
    step.classList.toggle('reached', stepTier < tier);
    if (stepTier === tier) {
      step.classList.add('active');
      // tier-0 is red, tier-3 is green, tier-1/2 fall back to amber via base .active rule
      if (stepTier === 0) step.classList.add('t0');
      if (stepTier === 3) step.classList.add('t3');
    }
  });

  // Tier cards: show progressively
  document.getElementById('tierCard1').classList.toggle('visible', tier >= 1);
  document.getElementById('tierCard2').classList.toggle('visible', tier >= 2);
  document.getElementById('tierCard3').classList.toggle('visible', tier >= 3);

  // Unlock button: enable only at tier 3
  const unlockBtn = document.getElementById('unlockAiBtn');
  const unlockLbl = document.getElementById('unlockAiBtnLabel');
  if (unlockBtn) unlockBtn.disabled = tier < 3;
  if (unlockLbl) unlockLbl.textContent = `Unlock AI for ${hintTiers.unlockMinutes || 10} minutes`;
}

function refreshHintState() {
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, response => {
    void chrome.runtime.lastError;
    if (!response) return;
    const { local, hintTier, hintElapsed, hintTiers: tiers } = response;
    if (tiers) hintTiers = { ...hintTiers, ...tiers };
    problemStartTime = local.problemStartTime;

    // Hide the entire hint timeline during hardcore sessions (no unlock allowed)
    const hardcoreActive = local.focusSession && local.focusSession.hardcore && Date.now() < local.focusSession.endTime;
    isHardcoreSession = !!hardcoreActive;
    const timeline = document.getElementById('hintTimeline');
    if (timeline) timeline.style.display = hardcoreActive ? 'none' : '';
    if (hardcoreActive) {
      document.getElementById('tierCard1').classList.remove('visible');
      document.getElementById('tierCard2').classList.remove('visible');
      document.getElementById('tierCard3').classList.remove('visible');
      return;
    }

    renderHintUI(hintTier || 0, hintElapsed || 0);
  });
}

document.getElementById('unlockAiBtn').addEventListener('click', () => {
  const btn = document.getElementById('unlockAiBtn');
  btn.disabled = true;
  chrome.runtime.sendMessage({ type: 'HINT_UNLOCK' }, resp => {
    void chrome.runtime.lastError;
    if (!resp || resp.ok === false) {
      btn.disabled = false;
      return;
    }
    // Navigate to the originally blocked AI page
    const safeDomain = domain && /^([a-z0-9-]+\.)+[a-z]{2,}(\/[A-Za-z0-9_\-./]*)?$/.test(domain)
      ? domain : null;
    setTimeout(() => {
      if (safeDomain) window.location.href = `https://${safeDomain}`;
      else navigateToFocusPlatform();
    }, 250);
  });
});

// ─── Session state -> show timer if active ───────────────────────────────────
chrome.runtime.sendMessage({ type: 'GET_STATE' }, response => {
  void chrome.runtime.lastError;
  if (!response) return;
  const { local } = response;
  const now = Date.now();
  sessionData = local.focusSession;
  const isSession = sessionData && now < sessionData.endTime;

  if (isSession) {
    document.getElementById('sessionCard').style.display = 'flex';
    if (sessionData.hardcore) {
      document.getElementById('hcBadge').style.display = 'inline-flex';
      document.getElementById('solvedBtn').style.display = 'none';
    }
    renderBigTimer();
    timerInterval = setInterval(() => {
      if (sessionData && Date.now() >= sessionData.endTime) {
        clearInterval(timerInterval);
        window.location.reload();
        return;
      }
      renderBigTimer();
    }, 1000);

    document.getElementById('footerNote').textContent =
      sessionData.hardcore
        ? 'Hardcore mode — stays locked until session ends'
        : 'Focus session active — solve it, then unlock AI';
  }

  // Kick off hint timeline + live updates
  refreshHintState();
  hintInterval = setInterval(refreshHintState, 20000);
});

function renderBigTimer() {
  if (!sessionData) return;
  const remaining = Math.max(0, sessionData.endTime - Date.now());
  const totalSecs = Math.floor(remaining / 1000);
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  document.getElementById('sessionTimerBig').textContent =
    `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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
    const unlockMin = hintTiers.unlockMinutes || 10;
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
    const urls = {
      codeforces: 'https://codeforces.com',
      leetcode:   'https://leetcode.com',
      atcoder:    'https://atcoder.jp',
      hackerrank: 'https://hackerrank.com',
      codechef:   'https://codechef.com',
      cses:       'https://cses.fi',
    };
    window.location.href = urls[platform] || 'https://codeforces.com';
  });
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────
window.addEventListener('unload', () => {
  if (timerInterval) clearInterval(timerInterval);
  if (hintInterval)  clearInterval(hintInterval);
});
