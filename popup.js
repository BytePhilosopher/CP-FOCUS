document.addEventListener('DOMContentLoaded', () => {
  const statusDot       = document.getElementById('statusDot');
  const statusLabel     = document.getElementById('statusLabel');
  const statusSub       = document.getElementById('statusSub');
  const statusBadge     = document.getElementById('statusBadge');
  const snoozeRow       = document.getElementById('snoozeRow');
  const snoozeBtn       = document.getElementById('snoozeBtn');
  const footerNote      = document.getElementById('footerNote');
  const sessionIdle     = document.getElementById('sessionIdle');
  const sessionActive   = document.getElementById('sessionActive');
  const hardcoreBadge   = document.getElementById('hardcoreBadge');
  const endSessionBtn   = document.getElementById('endSessionBtn');
  const startSessionBtn = document.getElementById('startSessionBtn');
  const hardcoreToggle  = document.getElementById('hardcoreToggle');
  const ringProgress    = document.getElementById('ringProgress');
  const ringIdleArc     = document.getElementById('ringIdleArc');
  const ringTimerText   = document.getElementById('ringTimerText');
  const ringLabel       = document.getElementById('ringLabel');
  const previewDur      = document.getElementById('previewDur');
  const previewMode     = document.getElementById('previewMode');
  const hcCard          = document.getElementById('hcCard');
  const durRow          = document.getElementById('durRow');
  const streakNum       = document.getElementById('streakNum');
  const dailyFill       = document.getElementById('dailyFill');
  const dailyVal        = document.getElementById('dailyVal');
  const todayTime       = document.getElementById('todayTime');
  const todayBlocks     = document.getElementById('todayBlocks');
  const todaySolved     = document.getElementById('todaySolved');

  const RING_C = 515.22;

  let state = null;
  let selectedDuration = 45;
  let timerInterval = null;
  let endCountdown = null;
  let clockInterval = null;
  let pollInterval = null;

  // ── Preview ─────────────────────────────────────────────────────────────────
  function updatePreview() {
    if (!hardcoreToggle) return;
    const isHC = hardcoreToggle.checked;
    if (previewDur)  previewDur.textContent  = `${selectedDuration} min`;
    if (previewMode) {
      previewMode.textContent = isHC ? 'Hardcore' : 'Standard';
      previewMode.className   = isHC ? 'preview-mode hc' : 'preview-mode';
    }
    if (hcCard) hcCard.classList.toggle('active', isHC);
  }

  if (durRow) {
    durRow.addEventListener('click', e => {
      const btn = e.target.closest('[data-dur]');
      if (!btn) return;
      selectedDuration = Number(btn.dataset.dur);
      durRow.querySelectorAll('.dur-btn').forEach(b => b.classList.toggle('selected', b === btn));
      updatePreview();
    });
  }
  if (hcCard) {
    hcCard.addEventListener('click', () => {
      if (hardcoreToggle) { hardcoreToggle.checked = !hardcoreToggle.checked; updatePreview(); }
    });
  }
  if (hardcoreToggle) hardcoreToggle.addEventListener('change', updatePreview);
  updatePreview();

  // ── Snooze button helper ────────────────────────────────────────────────────
  function setSnoozeBtn(text) {
    if (!snoozeBtn) return;
    const svg = snoozeBtn.querySelector('svg');
    const svgClone = svg ? svg.cloneNode(true) : null;
    snoozeBtn.innerHTML = '';
    if (svgClone) snoozeBtn.appendChild(svgClone);
    snoozeBtn.appendChild(document.createTextNode(' ' + text));
  }

  // ── Clock ───────────────────────────────────────────────────────────────────
  function updateClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    if (ringTimerText) {
      ringTimerText.textContent = `${h}:${m}`;
      ringTimerText.setAttribute('fill', '#3a3a3a');
    }
  }

  // ── Ring ─────────────────────────────────────────────────────────────────────
  function renderRing(endTime, duration, now) {
    if (ringIdleArc) ringIdleArc.style.opacity = '0';
    if (ringProgress) ringProgress.style.opacity = '1';
    if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }

    const totalMs = (duration || 45) * 60000;
    const remainMs = Math.max(0, endTime - now);
    const pct = totalMs > 0 ? remainMs / totalMs : 0;
    if (ringProgress) ringProgress.style.strokeDashoffset = String(RING_C * (1 - pct));
    if (ringTimerText) ringTimerText.setAttribute('fill', '#f0f0f0');
    if (ringLabel) ringLabel.setAttribute('fill', '#777');
    const totalSecs = Math.floor(remainMs / 1000);
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    if (ringTimerText) ringTimerText.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function resetRing(label) {
    if (ringIdleArc) ringIdleArc.style.opacity = '1';
    if (ringProgress) {
      ringProgress.style.opacity = '0';
      ringProgress.style.strokeDashoffset = String(RING_C);
    }
    if (ringLabel) {
      ringLabel.textContent = label || 'no session';
      ringLabel.setAttribute('fill', '#3a3a3a');
    }
    if (!clockInterval) { updateClock(); clockInterval = setInterval(updateClock, 1000); }
  }

  // ── Main render ─────────────────────────────────────────────────────────────
  function render() {
    if (!state) return;
    const { settings, local, focusTabCount, liveTodayMinutes } = state;
    const now = Date.now();
    const isSnoozed      = settings.snoozeUntil && now < settings.snoozeUntil;
    const isBlocking     = local.blocking;
    const focusSession   = local.focusSession;
    const isFocusSession = focusSession && now < focusSession.endTime;
    const isHardcore     = isFocusSession && focusSession.hardcore;

    // ── Streak ────────────────────────────────────────────────────────────────
    streakNum.textContent = local.currentStreak || 0;

    // ── Daily progress ────────────────────────────────────────────────────────
    const goal = settings.dailyGoal || 120;
    const todayMins = liveTodayMinutes || 0;
    const pct = Math.min(100, Math.round((todayMins / goal) * 100));
    const goalReached = todayMins >= goal;
    dailyFill.style.width = `${pct}%`;
    dailyFill.classList.toggle('complete', goalReached);
    dailyVal.textContent = goalReached ? `${todayMins}m done!` : `${todayMins} / ${goal}m`;
    dailyVal.classList.toggle('complete', goalReached);

    // ── Today stats ───────────────────────────────────────────────────────────
    if (todayMins >= 60) {
      const hrs = Math.floor(todayMins / 60);
      const mins = todayMins % 60;
      todayTime.textContent = mins > 0 ? `${hrs}h${mins}m` : `${hrs}h`;
    } else {
      todayTime.textContent = `${todayMins}m`;
    }
    todayBlocks.textContent = local.todayBlocks || 0;
    todaySolved.textContent = local.todaySolved || 0;

    // ── Status bar ────────────────────────────────────────────────────────────
    if (isSnoozed) {
      const remaining = Math.ceil((settings.snoozeUntil - now) / 60000);
      statusDot.className   = 'status-dot snoozed';
      statusLabel.textContent = 'Snoozed';
      statusSub.textContent = `${remaining}m remaining`;
      statusBadge.className = 'status-badge snoozed';
      statusBadge.textContent = 'Paused';
      footerNote.textContent = 'AI blocking paused';
      snoozeRow.style.display = 'block';
      snoozeBtn.className = 'snooze-btn end-snooze';
      setSnoozeBtn('End Snooze');
      snoozeBtn.dataset.action = 'unsnooze';

    } else if (isFocusSession) {
      statusDot.className   = 'status-dot session';
      statusLabel.textContent = isHardcore ? 'Hardcore Mode' : 'Focus Session';
      const minsLeft = Math.ceil((focusSession.endTime - now) / 60000);
      statusSub.textContent = `${minsLeft}m left`;
      statusBadge.className = 'status-badge session';
      statusBadge.textContent = isHardcore ? 'Locked' : 'Active';
      footerNote.textContent = isHardcore ? 'no snooze, no exit' : 'end session to stop blocking';
      snoozeRow.style.display = isHardcore ? 'none' : 'block';
      if (!isHardcore) {
        snoozeBtn.className = 'snooze-btn';
        setSnoozeBtn(`Snooze ${settings.snoozeDuration || 15}m`);
        snoozeBtn.dataset.action = 'snooze';
      }

    } else if (isBlocking) {
      const count = focusTabCount || 0;
      statusDot.className   = 'status-dot active';
      statusLabel.textContent = 'Focus Mode';
      statusSub.textContent = `${count} focus tab${count !== 1 ? 's' : ''} open`;
      statusBadge.className = 'status-badge active';
      statusBadge.textContent = 'Blocking';
      footerNote.textContent = 'close focus tabs to deactivate';
      snoozeRow.style.display = 'block';
      snoozeBtn.className = 'snooze-btn';
      setSnoozeBtn(`Snooze ${settings.snoozeDuration || 15}m`);
      snoozeBtn.dataset.action = 'snooze';

    } else {
      statusDot.className   = 'status-dot inactive';
      statusLabel.textContent = 'All clear';
      statusSub.textContent = 'no focus tabs detected';
      statusBadge.className = 'status-badge inactive';
      statusBadge.textContent = 'Idle';
      footerNote.textContent = 'open a focus platform to activate';
      snoozeRow.style.display = 'none';
    }

    // ── Session section ───────────────────────────────────────────────────────
    sessionIdle.style.display   = isFocusSession ? 'none' : 'block';
    sessionActive.style.display = isFocusSession ? 'block' : 'none';

    if (isFocusSession) {
      renderRing(focusSession.endTime, focusSession.duration, now);
      if (ringLabel) {
        ringLabel.textContent = isHardcore ? 'hardcore' : 'session';
        ringLabel.setAttribute('fill', '#555');
      }
      hardcoreBadge.style.display = isHardcore ? 'flex' : 'none';
      endSessionBtn.style.display = isHardcore ? 'none' : 'block';
      if (!endCountdown && !isHardcore) {
        endSessionBtn.textContent = 'End Session';
        endSessionBtn.classList.remove('confirming');
      }
      if (!timerInterval) {
        timerInterval = setInterval(() => {
          if (!state || !state.local.focusSession) return;
          const n = Date.now();
          const s = state.local.focusSession;
          if (n >= s.endTime) {
            clearInterval(timerInterval);
            timerInterval = null;
            loadState();
          } else {
            renderRing(s.endTime, s.duration, n);
          }
        }, 1000);
      }
    } else {
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
      if (endCountdown !== null) { clearInterval(endCountdown); endCountdown = null; }
      const idleLabel = isSnoozed ? 'snoozed' : isBlocking ? 'blocking' : 'focus watch';
      resetRing(idleLabel);
    }
  }

  function loadState() {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, response => {
      void chrome.runtime.lastError;
      if (response) { state = response; render(); }
    });
  }

  loadState();
  pollInterval = setInterval(loadState, 5000);

  // ── Snooze ──────────────────────────────────────────────────────────────────
  if (snoozeBtn) {
    snoozeBtn.addEventListener('click', () => {
      const action = snoozeBtn.dataset.action;
      const type = action === 'unsnooze' ? 'UNSNOOZE' : 'SNOOZE';
      const payload = type === 'SNOOZE'
        ? { type, minutes: state?.settings?.snoozeDuration || 15 }
        : { type };
      chrome.runtime.sendMessage(payload, () => { void chrome.runtime.lastError; loadState(); });
    });
  }

  // ── Start session ───────────────────────────────────────────────────────────
  if (startSessionBtn) {
    startSessionBtn.addEventListener('click', () => {
      const hardcore = hardcoreToggle ? hardcoreToggle.checked : false;
      startSessionBtn.disabled = true;
      startSessionBtn.textContent = 'Starting\u2026';
      chrome.runtime.sendMessage(
        { type: 'START_SESSION', duration: selectedDuration, hardcore },
        () => {
          void chrome.runtime.lastError;
          startSessionBtn.disabled = false;
          startSessionBtn.textContent = 'Start Focus Session';
          loadState();
        }
      );
    });
  }

  // ── End session — 8s countdown ──────────────────────────────────────────────
  if (endSessionBtn) {
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
  }

  // ── Settings ────────────────────────────────────────────────────────────────
  const settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  window.addEventListener('unload', () => {
    if (timerInterval) clearInterval(timerInterval);
    if (clockInterval) clearInterval(clockInterval);
    if (pollInterval) clearInterval(pollInterval);
    if (endCountdown !== null) clearInterval(endCountdown);
  });
});
