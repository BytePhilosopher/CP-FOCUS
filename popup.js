document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id);

  const statusDot    = $('statusDot');
  const statusLabel  = $('statusLabel');
  const streakBadge  = $('streakBadge');
  const streakNum    = $('streakNum');
  const todayTime    = $('todayTime');
  const todayBlocks  = $('todayBlocks');
  const todaySolved  = $('todaySolved');
  const primaryBtn   = $('primaryBtn');
  const primaryLabel = $('primaryLabel');
  const practiceLabel = $('practiceLabel');
  const snoozeBtn    = $('snoozeBtn');
  const snoozeLabel  = $('snoozeLabel');
  const hardcoreCb   = $('hardcoreCb');
  const durations    = $('durations');

  const ringProgress = $('ringProgress');
  const ringTime     = $('ringTime');
  const ringEyebrow  = $('ringEyebrow');
  const ringSub      = $('ringSub');
  const flame        = $('flame');
  const flameHalo    = $('flameHalo');
  const flameBody    = $('flameBody').firstElementChild;
  const flameCore    = $('flameCore').firstElementChild;
  const arcStop1     = $('arcStop1');
  const arcStop2     = $('arcStop2');
  const ringWrap     = document.querySelector('.ring-wrap');

  const RING_C = 452.39; // 2π × 72
  const RING_R = 72;

  let state = null;
  let chosenMinutes = null;   // null until the user picks; falls back to the saved length
  let endConfirm = null;      // timeout id while "tap again to end" is armed

  // ── Theme toggle ────────────────────────────────────────────────────────────
  const ICONS = {
    light: '<circle cx="10" cy="10" r="4" stroke="currentColor" stroke-width="1.6"/>' +
           '<path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.4 1.4M14.6 14.6 16 16M16 4l-1.4 1.4M5.4 14.6 4 16" ' +
           'stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    dark:  '<path d="M16 11.5A6.5 6.5 0 0 1 8.5 4a6.5 6.5 0 1 0 7.5 7.5Z" stroke="currentColor" ' +
           'stroke-width="1.6" stroke-linejoin="round"/>',
    system:'<rect x="2" y="3.5" width="16" height="11" rx="2" stroke="currentColor" stroke-width="1.6"/>' +
           '<path d="M7 17.5h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  };
  const themeBtn  = $('themeBtn');
  const themeIcon = $('themeIcon');

  function paintThemeButton() {
    const pref = window.CFTheme.get();
    themeIcon.innerHTML = ICONS[pref] || ICONS.system;
    themeBtn.title = `Theme: ${pref} (click to change)`;
  }
  window.CFTheme.attachToggle(themeBtn);
  window.CFTheme.onChange(paintThemeButton);
  paintThemeButton();

  // ── Formatting ──────────────────────────────────────────────────────────────
  function hms(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function mmss(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const tail = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return h ? `${h}:${tail}` : tail;
  }

  const shortDuration = mins => CF.fmtDuration(mins).replace(' ', '');

  // Amber → orange → deep red as the clock climbs.
  function mix(a, b, t) {
    const p = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const [r1, g1, b1] = p(a), [r2, g2, b2] = p(b);
    const c = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
    return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
  }

  // ── The flame ───────────────────────────────────────────────────────────────
  // Sits at the leading tip of the arc. The longer the streak of focus, the
  // bigger, brighter and hotter it burns.
  function renderFlame(progress) {
    // Heat keeps climbing a little past a full lap so a long session still reads
    // as "hotter", but it saturates so it never becomes cartoonish.
    const heat = Math.max(0, Math.min(1, progress / 0.85));

    // One variable drives every burning surface — arc glow, charred track,
    // scorch bloom and the glowing numerals all read off this.
    ringWrap.style.setProperty('--heat', heat.toFixed(3));

    if (progress <= 0.001) {
      flame.setAttribute('opacity', '0');
      return;
    }

    const angle = (-90 + 360 * Math.min(progress, 1)) * Math.PI / 180;
    const x = 100 + RING_R * Math.cos(angle);
    const y = 100 + RING_R * Math.sin(angle);
    // Always big enough to read as a flame, then grows from there.
    const scale = 0.8 + 0.7 * heat;

    flame.setAttribute('opacity', String(0.72 + 0.28 * heat));
    flame.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(3)})`);

    // A red fire: deep ember at the base, brightening to a hot red as it burns.
    flameBody.setAttribute('fill', mix('#a8161a', '#ff2a14', heat));
    flameCore.setAttribute('fill', mix('#ff7a52', '#ffc39c', heat));
    flameHalo.setAttribute('r', String(16 + 10 * heat));
    flameHalo.setAttribute('opacity', String(0.35 + 0.65 * heat));

    // The arc warms up alongside it — dark ember to bright burning red.
    arcStop1.setAttribute('stop-color', mix('#6d0d10', '#c81419', heat));
    arcStop2.setAttribute('stop-color', mix('#c8191c', '#ff3a20', heat));
  }

  function renderClock() {
    if (!state) return;
    const { settings, local } = state;
    const goal = settings.dailyGoal || 120;
    const goalMs = Math.max(1, goal * 60000);

    // The clock is tied to practice tabs being open: it starts when the first
    // one appears and resets when the last one closes.
    const elapsed = local.focusClockStart ? Math.max(0, Date.now() - local.focusClockStart) : 0;
    const progress = elapsed / goalMs;

    ringTime.textContent = hms(elapsed);
    ringProgress.style.strokeDashoffset = String(RING_C * (1 - Math.min(1, progress)));
    renderFlame(progress);

    if (!local.focusClockStart) {
      ringEyebrow.textContent = 'Focus Time';
      ringSub.textContent = `Goal ${shortDuration(goal)}`;
    } else if (progress >= 1) {
      ringEyebrow.textContent = 'Goal Smashed';
      ringSub.textContent = `Goal ${shortDuration(goal)} · done`;
    } else {
      ringEyebrow.textContent = 'Focus Time';
      const leftMins = Math.ceil((goalMs - elapsed) / 60000);
      ringSub.textContent = `${shortDuration(leftMins)} to goal`;
    }
  }

  // ── Session countdown ───────────────────────────────────────────────────────
  function renderSession() {
    if (!state) return;
    const s = state.session;
    $('sessionSetup').style.display = s ? 'none' : '';
    $('sessionLive').style.display  = s ? 'block' : 'none';
    if (!s) return;

    const total = Math.max(1, (s.duration || 50) * 60000);
    const remaining = s.pausedRemainingMs > 0 ? s.pausedRemainingMs : Math.max(0, s.endTime - Date.now());
    $('liveTime').textContent = mmss(remaining);
    $('liveBar').style.width = `${(100 * (1 - remaining / total)).toFixed(1)}%`;
    $('liveTag').textContent = s.hardcore ? 'Hardcore' : (s.pausedRemainingMs ? 'Paused' : 'Session');
    $('liveCap').textContent = s.pausedRemainingMs
      ? 'Paused while snoozed — resumes when the snooze ends.'
      : s.hardcore
        ? 'Locked in. No snooze and no unlock until this hits zero.'
        : `Ends at ${new Date(s.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. AI stays blocked until then.`;

    // The session may have run out between polls.
    if (remaining <= 0) setTimeout(loadState, 800);
  }

  // ── Week strip ──────────────────────────────────────────────────────────────
  function renderWeek() {
    const { settings, local, liveTodayMinutes } = state;
    const goal = settings.dailyGoal || 120;
    const log = local.dayLog || {};
    const today = new Date();
    const bars = $('weekBars'), days = $('weekDays');
    bars.textContent = ''; days.textContent = '';
    let total = 0;
    const vals = [];
    for (let i = 6; i >= 0; i--) {
      const d = CF.addDays(today, -i);
      const key = CF.dayKey(d);
      const m = i === 0 ? (liveTodayMinutes || 0) : ((log[key] && log[key].m) || 0);
      vals.push({ d, m, today: i === 0 });
      total += m;
    }
    const max = Math.max(goal, ...vals.map(v => v.m));
    for (const v of vals) {
      const bar = document.createElement('div');
      bar.className = 'week-bar' + (v.m >= goal ? ' goal' : '');
      bar.title = `${v.d.toLocaleDateString([], { weekday: 'long' })}: ${CF.fmtDuration(v.m)}`;
      const fill = document.createElement('i');
      fill.style.height = v.m ? `${Math.max(8, (v.m / max) * 100)}%` : '0%';
      bar.appendChild(fill);
      bars.appendChild(bar);
      const lbl = document.createElement('span');
      lbl.textContent = v.d.toLocaleDateString([], { weekday: 'narrow' });
      if (v.today) lbl.className = 'today';
      days.appendChild(lbl);
    }
    $('weekTotal').textContent = CF.fmtDuration(total);
  }

  // ── Main render ─────────────────────────────────────────────────────────────
  function render() {
    if (!state) return;
    const { settings, local, focusTabCount, liveTodayMinutes, session } = state;
    const now = Date.now();
    const isSnoozed  = settings.snoozeUntil && now < settings.snoozeUntil;
    const isBlocking = local.blocking;
    const isHardcore = !!(session && session.hardcore);
    const hasTabs    = (focusTabCount || 0) > 0;

    streakNum.textContent = state.streak || 0;
    streakBadge.classList.toggle('hot', (state.streak || 0) > 0);
    streakBadge.title = `${state.streak || 0}-day streak · best ${local.longestStreak || 0}`;

    todayTime.textContent   = shortDuration(liveTodayMinutes || 0);
    todayBlocks.textContent = local.todayBlocks || 0;
    todaySolved.textContent = local.todaySolved || 0;

    // ── Status line ──────────────────────────────────────────────────────────
    if (isSnoozed) {
      const mins = Math.ceil((settings.snoozeUntil - now) / 60000);
      statusDot.className = 'status-dot snoozed';
      statusLabel.textContent = `AI unlocked · ${mins}m left`;
    } else if (isBlocking) {
      statusDot.className = 'status-dot on';
      statusLabel.textContent = session
        ? (isHardcore ? 'Hardcore session · AI blocked' : 'Focus session · AI blocked')
        : hasTabs
          ? `AI blocked · ${focusTabCount} practice tab${focusTabCount !== 1 ? 's' : ''}`
          : 'AI blocked · scheduled';
    } else {
      statusDot.className = 'status-dot';
      statusLabel.textContent = 'Idle · open a practice tab to start';
    }

    // ── Session controls ─────────────────────────────────────────────────────
    const mins = chosenMinutes || settings.sessionLength || 50;
    durations.querySelectorAll('.dur').forEach(b =>
      b.classList.toggle('on', Number(b.dataset.min) === mins));
    $('hcNote').classList.toggle('show', hardcoreCb.checked);

    if (!session) {
      primaryBtn.className = 'btn btn-primary';
      primaryBtn.disabled = false;
      primaryLabel.textContent = `Start ${shortDuration(mins)}${hardcoreCb.checked ? ' hardcore' : ''} session`;
      primaryBtn.dataset.action = 'start';
    } else if (isHardcore) {
      primaryBtn.className = 'btn btn-ghost';
      primaryBtn.disabled = true;
      primaryLabel.textContent = 'Hardcore — locked until the end';
      primaryBtn.dataset.action = '';
    } else if (endConfirm) {
      primaryBtn.className = 'btn btn-ghost warn';
      primaryBtn.disabled = false;
      primaryLabel.textContent = 'Tap again to end the session';
      primaryBtn.dataset.action = 'end';
    } else {
      primaryBtn.className = 'btn btn-ghost';
      primaryBtn.disabled = false;
      primaryLabel.textContent = 'End session early';
      primaryBtn.dataset.action = 'end';
    }

    $('primaryIcon').style.display = primaryBtn.dataset.action === 'start' ? '' : 'none';
    practiceLabel.textContent = hasTabs ? 'Go to practice' : 'Open practice';

    // Snooze is offered whenever blocking is in effect (never during hardcore).
    snoozeBtn.disabled = isHardcore || (!isBlocking && !isSnoozed);
    if (isSnoozed) {
      snoozeBtn.classList.add('warn');
      snoozeLabel.textContent = 'Re-block now';
      snoozeBtn.dataset.action = 'unsnooze';
    } else {
      snoozeBtn.classList.remove('warn');
      snoozeLabel.textContent = `Snooze ${shortDuration(settings.snoozeDuration || 15)}`;
      snoozeBtn.dataset.action = 'snooze';
    }
    snoozeBtn.title = isHardcore ? 'Snooze is disabled during a hardcore session'
      : snoozeBtn.disabled ? 'Nothing is blocked right now' : '';

    renderWeek();
    renderSession();
    renderClock();
  }

  function send(msg) {
    return new Promise(resolve => chrome.runtime.sendMessage(msg, resp => {
      void chrome.runtime.lastError;
      resolve(resp);
    }));
  }

  async function loadState() {
    const response = await send({ type: 'GET_STATE' });
    if (response && response.settings) { state = response; render(); }
  }

  loadState();
  // Re-render as soon as anything changes instead of waiting for a poll.
  let reloadTimer = null;
  chrome.storage.onChanged.addListener(() => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(loadState, 80);
  });
  const pollInterval = setInterval(loadState, 15000);
  // The clocks tick locally between loads so the seconds never stutter.
  const tickInterval = setInterval(() => { renderClock(); renderSession(); }, 1000);

  // ── Toast with undo ─────────────────────────────────────────────────────────
  let toastTimer = null, toastUndo = null;
  function toast(text, undo) {
    $('toastText').textContent = text;
    $('toastUndo').style.display = undo ? '' : 'none';
    toastUndo = undo || null;
    $('toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3500);
  }
  $('toastUndo').addEventListener('click', () => {
    if (toastUndo) toastUndo();
    toastUndo = null;
    $('toast').classList.remove('show');
  });

  // ── Session ─────────────────────────────────────────────────────────────────
  durations.addEventListener('click', e => {
    const b = e.target.closest('[data-min]');
    if (!b) return;
    chosenMinutes = Number(b.dataset.min);
    render();
  });
  hardcoreCb.addEventListener('change', render);

  primaryBtn.addEventListener('click', async () => {
    if (!state) return;
    const action = primaryBtn.dataset.action;
    if (action === 'start') {
      const duration = chosenMinutes || state.settings.sessionLength || 50;
      const hardcore = hardcoreCb.checked;
      primaryBtn.disabled = true;
      const resp = await send({ type: 'START_SESSION', duration, hardcore });
      if (resp && resp.ok) toast(`${shortDuration(duration)} ${hardcore ? 'hardcore ' : ''}session started`);
      else toast('Could not start the session');
      hardcoreCb.checked = false;
      loadState();
    } else if (action === 'end') {
      if (!endConfirm) {
        endConfirm = setTimeout(() => { endConfirm = null; render(); }, 4000);
        render();
        return;
      }
      clearTimeout(endConfirm);
      endConfirm = null;
      await send({ type: 'END_SESSION' });
      toast('Session ended');
      loadState();
    }
  });

  // ── Solved +1 ───────────────────────────────────────────────────────────────
  $('solvedBtn').addEventListener('click', async () => {
    const resp = await send({ type: 'RECORD_SOLVED' });
    if (!resp || !resp.ok) return;
    const stat = $('solvedStat');
    stat.classList.remove('bump'); void stat.offsetWidth; stat.classList.add('bump');
    toast(`Nice! ${resp.todaySolved} solved today`, () => send({ type: 'UNDO_SOLVED' }));
  });

  // ── Practice tab ────────────────────────────────────────────────────────────
  $('practiceBtn').addEventListener('click', async () => {
    await send({ type: 'OPEN_FOCUS_TAB' });
    window.close();
  });

  // ── Snooze ──────────────────────────────────────────────────────────────────
  snoozeBtn.addEventListener('click', async () => {
    const unsnooze = snoozeBtn.dataset.action === 'unsnooze';
    const resp = await send(unsnooze
      ? { type: 'UNSNOOZE' }
      : { type: 'SNOOZE', minutes: (state && state.settings.snoozeDuration) || 15 });
    if (resp && resp.ok === false && resp.reason === 'hardcore') toast('Not during a hardcore session');
    loadState();
  });

  $('settingsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());

  window.addEventListener('pagehide', () => {
    clearInterval(tickInterval);
    clearInterval(pollInterval);
    clearTimeout(endConfirm);
  });
});
