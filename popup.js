document.addEventListener('DOMContentLoaded', () => {
  const statusDot      = document.getElementById('statusDot');
  const statusLabel    = document.getElementById('statusLabel');
  const statusBadge    = document.getElementById('statusBadge');
  const snoozeRow      = document.getElementById('snoozeRow');
  const snoozeBtn      = document.getElementById('snoozeBtn');
  const sessionActive  = document.getElementById('sessionActive');
  const endSessionBtn  = document.getElementById('endSessionBtn');
  const startFocusBtn  = document.getElementById('startFocusBtn');
  const startFocusLabel = document.getElementById('startFocusLabel');
  const streakNum      = document.getElementById('streakNum');
  const todayTime      = document.getElementById('todayTime');
  const todayBlocks    = document.getElementById('todayBlocks');
  const todaySolved    = document.getElementById('todaySolved');

  const ringProgress = document.getElementById('ringProgress');
  const ringTime     = document.getElementById('ringTime');
  const ringEyebrow  = document.getElementById('ringEyebrow');
  const ringSub      = document.getElementById('ringSub');
  const flame        = document.getElementById('flame');
  const flameHalo    = document.getElementById('flameHalo');
  const flameBody    = document.getElementById('flameBody').firstElementChild;
  const flameCore    = document.getElementById('flameCore').firstElementChild;
  const arcStop1     = document.getElementById('arcStop1');
  const arcStop2     = document.getElementById('arcStop2');
  const ringWrap     = document.querySelector('.ring-wrap');

  const RING_C = 452.39; // 2π × 72
  const RING_R = 72;

  let state = null;
  let tickInterval = null;
  let pollInterval = null;
  let endCountdown = null;

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
  const themeBtn  = document.getElementById('themeBtn');
  const themeIcon = document.getElementById('themeIcon');

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

  function shortDuration(mins) {
    if (mins >= 60) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m > 0 ? `${h}h${m}m` : `${h}h`;
    }
    return `${mins}m`;
  }

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
    const goalMs = Math.max(1, (settings.dailyGoal || 120) * 60000);

    // The clock is tied to practice tabs being open: it starts when the first
    // one appears and resets when the last one closes.
    const elapsed = local.focusClockStart ? Math.max(0, Date.now() - local.focusClockStart) : 0;
    const progress = elapsed / goalMs;

    ringTime.textContent = hms(elapsed);
    ringProgress.style.strokeDashoffset = String(RING_C * (1 - Math.min(1, progress)));
    renderFlame(progress);

    if (!local.focusClockStart) {
      ringEyebrow.textContent = 'Focus Time';
      ringSub.textContent = `Goal ${shortDuration(settings.dailyGoal || 120)}`;
    } else if (progress >= 1) {
      ringEyebrow.textContent = 'Goal Smashed';
      ringSub.textContent = `Goal ${shortDuration(settings.dailyGoal || 120)} · done`;
    } else {
      ringEyebrow.textContent = 'Focus Time';
      const leftMins = Math.ceil((goalMs - elapsed) / 60000);
      ringSub.textContent = `${shortDuration(leftMins)} to goal`;
    }
  }

  // ── Main render ─────────────────────────────────────────────────────────────
  function render() {
    if (!state) return;
    const { settings, local, focusTabCount, liveTodayMinutes } = state;
    const now = Date.now();
    const isSnoozed   = settings.snoozeUntil && now < settings.snoozeUntil;
    const isBlocking  = local.blocking;
    const fs          = local.focusSession;
    const inSession   = fs && (fs.pausedRemainingMs > 0 || now < fs.endTime);
    const isHardcore  = inSession && fs.hardcore;
    const hasTabs     = (focusTabCount || 0) > 0;

    streakNum.textContent = local.currentStreak || 0;

    const todayMins = liveTodayMinutes || 0;
    todayTime.textContent   = shortDuration(todayMins);
    todayBlocks.textContent = local.todayBlocks || 0;
    todaySolved.textContent = local.todaySolved || 0;

    // ── Status: one short line, no sub-caption ───────────────────────────────
    if (isSnoozed) {
      const mins = Math.ceil((settings.snoozeUntil - now) / 60000);
      statusDot.className     = 'status-dot snoozed';
      statusLabel.textContent = `Snoozed · ${mins}m left`;
      statusBadge.className   = 'status-badge snoozed';
      statusBadge.textContent = 'Paused';
    } else if (isBlocking) {
      statusDot.className     = 'status-dot active';
      statusLabel.textContent = hasTabs
        ? `Blocking · ${focusTabCount} tab${focusTabCount !== 1 ? 's' : ''}`
        : 'Blocking';
      statusBadge.className   = 'status-badge active';
      statusBadge.textContent = 'On';
    } else {
      statusDot.className     = 'status-dot inactive';
      statusLabel.textContent = 'No practice tab open';
      statusBadge.className   = 'status-badge inactive';
      statusBadge.textContent = 'Idle';
    }

    // ── Controls ─────────────────────────────────────────────────────────────
    startFocusLabel.textContent = hasTabs ? 'Go to practice tab' : 'Start Focus Tab';

    // Snooze is offered whenever blocking is in effect (never during hardcore).
    snoozeRow.style.display = (!isHardcore && (isBlocking || isSnoozed)) ? 'block' : 'none';
    if (isSnoozed) {
      snoozeBtn.className = 'snooze-btn end-snooze';
      setSnoozeBtn('End Snooze');
      snoozeBtn.dataset.action = 'unsnooze';
    } else {
      snoozeBtn.className = 'snooze-btn';
      setSnoozeBtn(`Snooze ${settings.snoozeDuration || 15}m`);
      snoozeBtn.dataset.action = 'snooze';
    }

    // Only surfaced for a session left over from an older version — sessions
    // can no longer be started from this popup.
    sessionActive.style.display = (inSession && !isHardcore) ? 'block' : 'none';
    if (!inSession && endCountdown !== null) {
      clearInterval(endCountdown);
      endCountdown = null;
      endSessionBtn.textContent = 'End Session';
      endSessionBtn.classList.remove('confirming');
    }

    renderClock();
  }

  function setSnoozeBtn(text) {
    if (!snoozeBtn) return;
    const svg = snoozeBtn.querySelector('svg');
    const clone = svg ? svg.cloneNode(true) : null;
    snoozeBtn.innerHTML = '';
    if (clone) snoozeBtn.appendChild(clone);
    snoozeBtn.appendChild(document.createTextNode(' ' + text));
  }

  function loadState() {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, response => {
      void chrome.runtime.lastError;
      if (response) { state = response; render(); }
    });
  }

  loadState();
  pollInterval = setInterval(loadState, 5000);
  // The clock ticks locally between polls so the seconds never stutter.
  tickInterval = setInterval(renderClock, 1000);

  // ── Start / go to a practice tab ────────────────────────────────────────────
  startFocusBtn.addEventListener('click', () => {
    startFocusBtn.disabled = true;
    chrome.runtime.sendMessage({ type: 'OPEN_FOCUS_TAB' }, () => {
      void chrome.runtime.lastError;
      startFocusBtn.disabled = false;
      window.close();
    });
  });

  // ── Snooze ──────────────────────────────────────────────────────────────────
  snoozeBtn.addEventListener('click', () => {
    const type = snoozeBtn.dataset.action === 'unsnooze' ? 'UNSNOOZE' : 'SNOOZE';
    const payload = type === 'SNOOZE'
      ? { type, minutes: (state && state.settings.snoozeDuration) || 15 }
      : { type };
    chrome.runtime.sendMessage(payload, () => { void chrome.runtime.lastError; loadState(); });
  });

  // ── End a leftover session — 8s countdown ───────────────────────────────────
  endSessionBtn.addEventListener('click', () => {
    if (endCountdown !== null) {
      clearInterval(endCountdown);
      endCountdown = null;
      endSessionBtn.textContent = 'End Session';
      endSessionBtn.classList.remove('confirming');
      return;
    }
    let count = 8;
    endSessionBtn.classList.add('confirming');
    endSessionBtn.textContent = `Sure? Cancel in ${count}s`;
    endCountdown = setInterval(() => {
      count--;
      if (count <= 0) {
        clearInterval(endCountdown);
        endCountdown = null;
        endSessionBtn.disabled = true;
        chrome.runtime.sendMessage({ type: 'END_SESSION' }, () => {
          void chrome.runtime.lastError;
          endSessionBtn.disabled = false;
          endSessionBtn.classList.remove('confirming');
          endSessionBtn.textContent = 'End Session';
          loadState();
        });
      } else {
        endSessionBtn.textContent = `Sure? Cancel in ${count}s`;
      }
    }, 1000);
  });

  document.getElementById('settingsBtn')
    .addEventListener('click', () => chrome.runtime.openOptionsPage());

  window.addEventListener('unload', () => {
    if (tickInterval) clearInterval(tickInterval);
    if (pollInterval) clearInterval(pollInterval);
    if (endCountdown !== null) clearInterval(endCountdown);
  });
});
