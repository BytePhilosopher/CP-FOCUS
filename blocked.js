// CF Focus — blocked.js
// Shown when a user tries to visit a blocked AI site.

const params   = new URLSearchParams(window.location.search);
const fromSite = params.get('from');
const domain   = params.get('domain');

const $ = id => document.getElementById(id);

function send(msg) {
  return new Promise(resolve => chrome.runtime.sendMessage(msg, resp => {
    void chrome.runtime.lastError;
    resolve(resp);
  }));
}

// Only ever navigate to something that looks like the blocked host (+ path).
const safeDomain = domain && /^([a-z0-9-]+\.)+[a-z]{2,}(\/[A-Za-z0-9_\-./]*)?$/.test(domain) ? domain : null;
const targetUrl  = safeDomain ? `https://${safeDomain}` : null;

// ─── Subtitle: name the site being blocked ────────────────────────────────────
if (fromSite) {
  const sub = $('subText');
  sub.textContent = '';
  const strong = document.createElement('strong');
  strong.textContent = fromSite;
  sub.appendChild(strong);
  sub.appendChild(document.createTextNode(
    ' does not exist while you’re practising.\nThe struggle is the part that makes you better.'
  ));

  $('siteBadge').textContent = fromSite + ' · blocked';
  $('siteBadgeWrap').style.display = 'block';
  document.title = `${fromSite} blocked — CF Focus`;
}

// ─── Tips: something concrete to try instead of asking ────────────────────────
const TIPS = [
  'Solve three tiny cases by hand and look for the pattern.',
  'Write the brute force first. Even an O(n³) solution tells you what the answer looks like.',
  'Re-read the constraints. n ≤ 20 means bitmasks, n ≤ 10⁵ means O(n log n).',
  'Is the answer monotonic? If yes, binary search on it.',
  'Try thinking backwards — from the final state to the start.',
  'Can you fix one element and count the rest? Contribution technique often turns O(n²) into O(n).',
  'Sort the input. A surprising number of problems become greedy once things are in order.',
  'Draw it. Graphs, intervals and grids are far easier to reason about on paper.',
  'What changes when you move from i to i+1? That transition might be your DP.',
  'Look for an invariant — something that never changes no matter which move you make.',
  'Stuck on WA? Write a random test generator and diff against your brute force.',
  'Check the edge cases: n = 1, all equal, already sorted, maximum values (overflow!).',
  'Can the problem be split into independent parts? Solve each, then combine.',
  'Prefix sums, two pointers, or a sliding window — does one of them fit?',
  'Explain the problem out loud in one sentence. If you can’t, re-read the statement.',
  'Take a 5-minute walk. Your brain keeps working on it in the background.',
  'Parity, mod and gcd tricks hide in a lot of “impossible” constructive problems.',
  'If the statement says “minimum maximum”, it is almost always binary search on the answer.',
];
let tipIndex = Math.floor(Math.random() * TIPS.length);
function showTip(next) {
  if (next) tipIndex = (tipIndex + 1 + Math.floor(Math.random() * (TIPS.length - 1))) % TIPS.length;
  const el = $('tipText');
  el.style.opacity = '0';
  setTimeout(() => { el.textContent = TIPS[tipIndex]; el.style.opacity = '1'; }, next ? 180 : 0);
}
showTip(false);
$('tipNext').addEventListener('click', () => showTip(true));

// ─── Local state ──────────────────────────────────────────────────────────────
// A single threshold: focus for `unlockAt` minutes and the AI unlock becomes
// available for `unlockMinutes`.
let unlockRule = { unlockAt: 35, unlockMinutes: 10 };
let sessionData = null;
let problemStartTime = null;
let problemPausedAt  = null;
let isHardcoreSession = false;
let busy = false;

// ─── "Go back to problem" — switch to an open practice tab ───────────────────
async function goBack() {
  if (busy) return;
  busy = true;
  const resp = await send({ type: 'OPEN_FOCUS_TAB', replaceSender: true });
  // If the service worker didn't answer, fall back to plain navigation.
  if (!resp || resp.ok === false) window.location.href = CF.PLATFORMS.codeforces.url;
  busy = false;
}
$('goBackBtn').addEventListener('click', goBack);

// ─── Block counter — dedupe within a single tab/visit ────────────────────────
// sessionStorage persists across reloads of the same tab, so refreshing this
// page does not inflate the counter. It is cleared when the tab closes.
function countBlockOnce() {
  try {
    const last = Number(sessionStorage.getItem('cf-counted-at') || 0);
    const lastDomain = sessionStorage.getItem('cf-counted-domain') || '';
    const now = Date.now();
    // Re-count only if a different domain is being blocked OR more than 5 min have passed
    const fresh = (now - last) > 5 * 60 * 1000 || lastDomain !== (domain || '');
    if (!fresh) return;
    sessionStorage.setItem('cf-counted-at', String(now));
    sessionStorage.setItem('cf-counted-domain', domain || '');
  } catch (_) {}
  // The service worker does the increment so it can roll the day over first.
  send({ type: 'RECORD_BLOCK' });
}
countBlockOnce();

// ─── The clock ────────────────────────────────────────────────────────────────
// One big dial counting down to the moment the AI unlock is earned — or, in a
// hardcore session, to the end of the session itself.
const CLOCK_CIRC = 923.63; // 2π × 147, matches the SVG in blocked.html

function paintClock({ eyebrow, time, cap, pct, unlocked }) {
  $('clockTime').textContent = time;
  $('clockEyebrow').textContent = eyebrow;
  $('clockCap').textContent = cap;
  $('clockFace').classList.toggle('unlocked', !!unlocked);
  const p = Math.max(0, Math.min(1, pct));
  $('clockArc').style.strokeDashoffset = String(CLOCK_CIRC * (1 - p));
}

function mmss(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const tail = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return h ? `${h}:${tail}` : tail;
}

function updateUnlockLabel() {
  $('unlockAiBtnLabel').textContent = isHardcoreSession
    ? 'Locked · hardcore'
    : `Unlock AI · ${unlockRule.unlockMinutes || 10}m`;
}

function sessionRemaining() {
  if (!sessionData) return 0;
  return sessionData.pausedRemainingMs
    ? sessionData.pausedRemainingMs
    : Math.max(0, sessionData.endTime - Date.now());
}

function renderTick() {
  const unlockBtn = $('unlockAiBtn');

  // Session pill in the top row.
  if (sessionData) {
    $('sessionTimerBig').textContent = mmss(sessionRemaining());
    if (!sessionData.pausedRemainingMs && sessionRemaining() <= 0) refreshState();
  }

  // Hardcore: the only clock that matters is the session's own countdown.
  if (isHardcoreSession && sessionData) {
    const total = Math.max(1, (sessionData.duration || 45) * 60000);
    const remaining = sessionRemaining();
    paintClock({
      eyebrow: 'Hardcore lock',
      time: mmss(remaining),
      cap: 'no snooze — the session has to run out',
      pct: 1 - remaining / total,
      unlocked: false,
    });
    unlockBtn.disabled = true;
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
    unlockBtn.disabled = true;
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
      cap: 'you earned it — the unlock button is live',
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

  unlockBtn.disabled = !earned;
}

async function refreshState() {
  const response = await send({ type: 'GET_STATE' });
  if (!response || !response.local) return;
  const { local, hintTiers: rule, session } = response;  // hintTiers: legacy key name
  if (rule) unlockRule = { ...unlockRule, ...rule };
  problemStartTime = local.problemStartTime;
  problemPausedAt  = local.problemPausedAt || null;
  sessionData = session || null;
  isHardcoreSession = !!(session && session.hardcore);

  $('sessionCard').style.display = session ? 'flex' : 'none';
  $('hcBadge').style.display = isHardcoreSession ? 'inline-flex' : 'none';

  $('chipResisted').textContent = local.todayBlocks || 0;
  $('chipSolved').textContent   = local.todaySolved || 0;
  $('chipStreak').textContent   = response.streak || 0;

  // If blocking was lifted elsewhere (snooze, unlock, tab closed), there is
  // nothing to stand in front of any more — take the user where they were going.
  if (!local.blocking && targetUrl && !busy) {
    window.location.replace(targetUrl);
    return;
  }

  updateUnlockLabel();
  renderTick();
}

$('unlockAiBtn').addEventListener('click', async () => {
  const btn = $('unlockAiBtn');
  btn.disabled = true;
  busy = true;
  const resp = await send({ type: 'EARN_UNLOCK', targetUrl });
  if (!resp || resp.ok === false) {
    busy = false;
    btn.disabled = false;
    if (resp && resp.reason === 'not_earned') {
      $('unlockAiBtnLabel').textContent = `Need ${resp.required - resp.elapsed}m more first`;
      setTimeout(updateUnlockLabel, 2500);
    }
    return;
  }
  // Background handles the tab.update; if it couldn't (no target), go back to practice.
  if (!targetUrl) goBack();
});

// ─── "I solved it" — log it and get back to the next problem ─────────────────
// Solving doesn't unlock AI (that would make the earned unlock pointless);
// it records the win and restarts the unlock clock for the next problem.
async function markSolved() {
  if (busy) return;
  busy = true;
  $('solvedBtn').disabled = true;
  const resp = await send({ type: 'RECORD_SOLVED' });

  $('actions').style.display    = 'none';
  $('successMsg').style.display = 'block';
  $('successTitle').textContent = resp && resp.ok
    ? `Problem solved — that’s ${resp.todaySolved} today.`
    : 'Problem marked as solved!';
  $('successSub').textContent = isHardcoreSession
    ? 'Hardcore mode stays active — on to the next one.'
    : 'Taking you back to practice…';

  setTimeout(() => { busy = false; goBack(); }, 1600);
}
$('solvedBtn').addEventListener('click', markSolved);

// ─── Keyboard shortcuts ──────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'b') goBack();
  else if (k === 's') markSolved();
  else if (k === 't') showTip(true);
});

// ─── Live updates ────────────────────────────────────────────────────────────
// refreshState() syncs from the background whenever storage changes;
// renderTick() updates the dial locally every second (fast, no IPC).
let refreshTimer = null;
chrome.storage.onChanged.addListener(() => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshState, 120);
});
refreshState();
const stateInterval = setInterval(refreshState, 30000);
const tickInterval  = setInterval(renderTick, 1000);

window.addEventListener('pagehide', () => {
  clearInterval(stateInterval);
  clearInterval(tickInterval);
});
