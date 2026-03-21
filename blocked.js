// CF Focus — blocked.js
// Extracted from blocked.html to comply with MV3 CSP (no inline scripts allowed)

const params   = new URLSearchParams(window.location.search);
const fromSite = params.get('from');    // e.g. "ChatGPT"
const domain   = params.get('domain'); // e.g. "chatgpt.com"

// Personalise subtitle — use textContent to avoid XSS
if (fromSite) {
  const sub = document.getElementById('subText');
  sub.textContent = '';
  const line1 = document.createElement('span');
  line1.textContent = 'You\'re about to use ';
  const strong = document.createElement('strong');
  strong.textContent = fromSite;
  const line2 = document.createTextNode('.\nTry harder first — that struggle is where growth lives.');
  sub.appendChild(line1);
  sub.appendChild(strong);
  sub.appendChild(line2);

  // Show badge
  const badge = document.getElementById('siteBadge');
  badge.textContent = fromSite + ' is blocked';
  document.getElementById('siteBadgeWrap').style.display = 'block';
}

// Random motivational quote
const quotes = [
  '"Every problem you solve without AI is a skill you actually own."',
  '"Struggling with a problem is the feeling of your brain getting stronger."',
  '"The only way to get better at DSA is to do DSA."',
  '"Competitive programmers don\'t Google their way through a contest."',
  '"Hard problems require hard thinking, not easy answers."',
  '"You opened this to practice. So practice."',
  '"The discomfort of not knowing is exactly where growth lives."',
  '"An hour of real struggle > ten minutes of AI output you don\'t understand."',
  '"The rating you want is on the other side of this problem."',
];
document.getElementById('quote').textContent =
  quotes[Math.floor(Math.random() * quotes.length)];

// ── "Go back to problem" — robust history handling ──────────────────────────
document.getElementById('goBackBtn').addEventListener('click', () => {
  if (history.length > 1) {
    history.back();
  } else {
    window.location.href = 'https://codeforces.com';
  }
});

// ── Count this block directly in storage (reliable in MV3) ──────────────────
// Bypasses service worker to avoid silent failures when SW is sleeping
chrome.storage.local.get({ aiBlocksAvoided: 0 }, result => {
  void chrome.runtime.lastError;
  chrome.storage.local.set({ aiBlocksAvoided: (result.aiBlocksAvoided || 0) + 1 }, () => {
    void chrome.runtime.lastError;
  });
});

// ── Load session state → show timer if active ──────────────────────────────
let sessionData = null;

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
      // In hardcore mode, hide the "I solved it" unlock button entirely
      document.getElementById('solvedBtn').style.display = 'none';
    }
    renderBigTimer();
    setInterval(renderBigTimer, 1000);
  }

  if (isSession) {
    document.getElementById('footerNote').textContent =
      sessionData.hardcore
        ? 'Hardcore mode — stays locked until session ends'
        : 'Focus session active — solve it, then unlock AI';
  }
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

// ── "I solved it" button ───────────────────────────────────────────────────
document.getElementById('solvedBtn').addEventListener('click', () => {
  const btn = document.getElementById('solvedBtn');
  btn.disabled = true;

  const isHardcore = sessionData && sessionData.hardcore;

  // Increment solved count directly in storage (reliable in MV3)
  chrome.storage.local.get({ problemsSolved: 0 }, result => {
    void chrome.runtime.lastError;
    chrome.storage.local.set({ problemsSolved: (result.problemsSolved || 0) + 1 }, () => {
      void chrome.runtime.lastError;
    });
  });

  document.getElementById('actions').style.display   = 'none';
  document.getElementById('successMsg').style.display = 'block';

  if (isHardcore) {
    // Hardcore: log the solve but keep AI locked
    document.getElementById('successTitle').textContent = 'Problem marked as solved!';
    document.getElementById('successSub').textContent   = 'Hardcore mode stays active — keep going!';
    setTimeout(() => {
      if (history.length > 1) history.back();
      else window.location.href = 'https://codeforces.com';
    }, 2500);
  } else {
    // Non-hardcore: snooze 10 min → navigate to the AI site
    document.getElementById('successTitle').textContent = 'Problem solved! Unlocking AI for 10 min…';
    document.getElementById('successSub').textContent   = domain
      ? `Opening ${domain}…`
      : 'Unblocking…';

    chrome.runtime.sendMessage({ type: 'SNOOZE', minutes: 10 }, resp => {
      void chrome.runtime.lastError;
      if (resp && resp.ok === false) {
        document.getElementById('successSub').textContent = 'Could not unlock — try again.';
        return;
      }
      setTimeout(() => {
        // Validate domain looks like a real hostname before navigating
        const safeDomain = domain && /^([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i.test(domain)
          ? domain : null;
        if (safeDomain) {
          window.location.href = `https://${safeDomain}`;
        } else {
          if (history.length > 1) history.back();
          else window.location.href = 'https://codeforces.com';
        }
      }, 150);
    });
  }
});
