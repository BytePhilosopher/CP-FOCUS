document.addEventListener('DOMContentLoaded', () => {
  const statusCard      = document.getElementById('statusCard');
  const statusMain      = document.getElementById('statusMain');
  const statusSub       = document.getElementById('statusSub');
  const snoozeRow       = document.getElementById('snoozeRow');
  const snoozeBtn       = document.getElementById('snoozeBtn');
  const footerNote      = document.getElementById('footerNote');
  const statusState     = document.getElementById('statusState');
  const statusStateText = document.getElementById('statusStateText');
  const sessionIdle     = document.getElementById('sessionIdle');
  const sessionActive   = document.getElementById('sessionActive');
  const hardcoreBadge   = document.getElementById('hardcoreBadge');
  const endSessionBtn   = document.getElementById('endSessionBtn');
  const startSessionBtn = document.getElementById('startSessionBtn');
  const hardcoreToggle  = document.getElementById('hardcoreToggle');
  // Ring refs:
  const ringProgress    = document.getElementById('ringProgress');
  const ringIdleArc     = document.getElementById('ringIdleArc');
  const ringTimerText   = document.getElementById('ringTimerText');
  const ringLabel       = document.getElementById('ringLabel');
  // Session setup refs:
  const previewDur   = document.getElementById('previewDur');
  const previewMode  = document.getElementById('previewMode');
  const hcCard       = document.getElementById('hcCard');

  const RING_C = 515.22; // circumference of r=82

  let state = null;
  let selectedDuration = 45;
  let timerInterval = null;
  let endCountdown = null;
  let clockInterval = null;

  // ── Session preview updater ───────────────────────────────────────────────────
  function updatePreview() {
    const isHC = hardcoreToggle.checked;
    if (previewDur)  previewDur.textContent  = `${selectedDuration} min`;
    if (previewMode) {
      previewMode.textContent = isHC ? 'Hardcore' : 'Standard';
      previewMode.className   = isHC ? 'preview-mode hc' : 'preview-mode';
    }
    if (hcCard) hcCard.classList.toggle('active', isHC);
  }

  // ── Duration picker ──────────────────────────────────────────────────────────
  document.getElementById('durRow').addEventListener('click', e => {
    const btn = e.target.closest('[data-dur]');
    if (!btn) return;
    selectedDuration = Number(btn.dataset.dur);
    document.querySelectorAll('.dur-btn').forEach(b => {
      b.classList.toggle('selected', b === btn);
    });
    updatePreview();
  });

  // ── Hardcore card click ────────────────────────────────────────────────────
  if (hcCard) {
    hcCard.addEventListener('click', () => {
      hardcoreToggle.checked = !hardcoreToggle.checked;
      updatePreview();
    });
  }
  hardcoreToggle.addEventListener('change', updatePreview);
  updatePreview(); // init

  // ── Snooze button text helper ─────────────────────────────────────────────────
  function setSnoozeBtn(text) {
    const svg = snoozeBtn.querySelector('svg');
    const svgClone = svg ? svg.cloneNode(true) : null;
    snoozeBtn.innerHTML = '';
    if (svgClone) snoozeBtn.appendChild(svgClone);
    snoozeBtn.appendChild(document.createTextNode(' ' + text));
  }

  // ── Clock (shown in ring center when no session) ──────────────────────────────
  function updateClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    if (ringTimerText) {
      ringTimerText.textContent = `${h}:${m}`;
      ringTimerText.setAttribute('fill', '#4a4a4a');
    }
  }

  // ── Ring renderer (session active) ───────────────────────────────────────────
  function renderRing(endTime, duration, now) {
    // Switch to red progress ring
    if (ringIdleArc) ringIdleArc.style.opacity = '0';
    if (ringProgress) ringProgress.style.opacity = '1';
    // Stop clock
    if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }

    const totalMs = (duration || 45) * 60000;
    const remainMs = Math.max(0, endTime - now);
    const pct = totalMs > 0 ? remainMs / totalMs : 0; // 1=full, 0=empty
    if (ringProgress) ringProgress.style.strokeDashoffset = RING_C * (1 - pct);
    if (ringTimerText) ringTimerText.setAttribute('fill', '#f0f0f0');
    if (ringLabel) ringLabel.setAttribute('fill', '#777777');
    const totalSecs = Math.floor(remainMs / 1000);
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    if (ringTimerText) ringTimerText.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // ── Ring idle reset (no session — spinning white arc + clock) ─────────────────
  function resetRing(label) {
    // Switch to spinning idle arc
    if (ringIdleArc) ringIdleArc.style.opacity = '1';
    if (ringProgress) {
      ringProgress.style.opacity = '0';
      ringProgress.style.strokeDashoffset = String(RING_C);
    }
    if (ringLabel) {
      ringLabel.textContent = label || 'no session';
      ringLabel.setAttribute('fill', '#444444');
    }
    // Start clock ticking in the center
    if (!clockInterval) {
      updateClock();
      clockInterval = setInterval(updateClock, 1000);
    }
  }

  // ── Main render ──────────────────────────────────────────────────────────────
  function render() {
    if (!state) return;
    const { settings, local, focusTabCount } = state;
    const now = Date.now();
    const isSnoozed      = settings.snoozeUntil && now < settings.snoozeUntil;
    const isBlocking     = local.blocking;
    const focusSession   = local.focusSession;
    const isFocusSession = focusSession && now < focusSession.endTime;
    const isHardcore     = isFocusSession && focusSession.hardcore;

    // ── Status card ────────────────────────────────────────────────────────────
    if (isSnoozed) {
      const remaining = Math.ceil((settings.snoozeUntil - now) / 60000);
      statusCard.className         = 'status-card snoozed';
      statusMain.className         = 'status-main snoozed';
      statusState.className        = 'status-pill snoozed';
      statusStateText.textContent  = 'Snoozed';
      statusMain.textContent       = 'Snoozed';
      statusSub.textContent        = `${remaining} min remaining`;
      footerNote.textContent       = 'AI blocking paused';
      snoozeRow.style.display      = 'block';
      snoozeBtn.className          = 'snooze-btn end-snooze';
      setSnoozeBtn('End Snooze');
      snoozeBtn.dataset.action     = 'unsnooze';

    } else if (isFocusSession) {
      statusCard.className         = 'status-card session';
      statusMain.className         = 'status-main session';
      statusState.className        = 'status-pill session';
      statusStateText.textContent  = isHardcore ? 'Hardcore' : 'Session';
      statusMain.textContent       = isHardcore ? 'Hardcore Mode' : 'Focus Session';
      const minsLeft = Math.ceil((focusSession.endTime - now) / 60000);
      statusSub.textContent        = `${minsLeft}m remaining`;
      footerNote.textContent       = isHardcore
        ? 'hardcore — no snooze, no exit'
        : 'end session to stop blocking';
      snoozeRow.style.display      = isHardcore ? 'none' : 'block';
      if (!isHardcore) {
        const dur = settings.snoozeDuration || 15;
        snoozeBtn.className        = 'snooze-btn';
        setSnoozeBtn(`Snooze ${dur}m`);
        snoozeBtn.dataset.action   = 'snooze';
      }

    } else if (isBlocking) {
      statusCard.className         = 'status-card active';
      statusMain.className         = 'status-main active';
      statusState.className        = 'status-pill active';
      statusStateText.textContent  = 'Blocking';
      statusMain.textContent       = 'Focus Mode On';
      const count = focusTabCount || 0;
      statusSub.textContent        = `${count} focus tab${count !== 1 ? 's' : ''} open`;
      footerNote.textContent       = 'close focus tab to deactivate';
      snoozeRow.style.display      = 'block';
      const dur = settings.snoozeDuration || 15;
      snoozeBtn.className          = 'snooze-btn';
      setSnoozeBtn(`Snooze ${dur}m`);
      snoozeBtn.dataset.action     = 'snooze';

    } else {
      statusCard.className         = 'status-card inactive';
      statusMain.className         = 'status-main inactive';
      statusState.className        = 'status-pill inactive';
      statusStateText.textContent  = 'All clear';
      statusMain.textContent       = 'All clear';
      statusSub.textContent        = 'no focus tabs detected';
      footerNote.textContent       = 'open a focus platform to activate';
      snoozeRow.style.display      = 'none';
    }

    // ── Session section ────────────────────────────────────────────────────────
    sessionIdle.style.display   = isFocusSession ? 'none' : 'block';
    sessionActive.style.display = isFocusSession ? 'block' : 'none';

    if (isFocusSession) {
      renderRing(focusSession.endTime, focusSession.duration, now);
      if (ringLabel) {
        ringLabel.textContent = isHardcore ? 'hardcore' : 'session';
        ringLabel.setAttribute('fill', '#555555');
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
      // Reset ring to idle (spinning clock)
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
  setInterval(loadState, 30000);

  // ── Snooze ───────────────────────────────────────────────────────────────────
  snoozeBtn.addEventListener('click', () => {
    const action  = snoozeBtn.dataset.action;
    const type    = action === 'unsnooze' ? 'UNSNOOZE' : 'SNOOZE';
    const payload = type === 'SNOOZE'
      ? { type, minutes: state?.settings?.snoozeDuration || 15 }
      : { type };
    chrome.runtime.sendMessage(payload, () => { void chrome.runtime.lastError; loadState(); });
  });

  // ── Start session ─────────────────────────────────────────────────────────────
  startSessionBtn.addEventListener('click', () => {
    const hardcore = hardcoreToggle.checked;
    startSessionBtn.disabled = true;
    chrome.runtime.sendMessage(
      { type: 'START_SESSION', duration: selectedDuration, hardcore },
      () => { void chrome.runtime.lastError; startSessionBtn.disabled = false; loadState(); }
    );
  });

  // ── End session — anti-cheat: 8-second countdown ──────────────────────────────
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
    endSessionBtn.textContent = `Are you sure? Click to cancel (${count}s)`;
    endCountdown = setInterval(() => {
      count--;
      if (count <= 0) {
        clearInterval(endCountdown);
        endCountdown = null;
        chrome.runtime.sendMessage({ type: 'END_SESSION' }, () => {
          void chrome.runtime.lastError;
          endSessionBtn.classList.remove('confirming');
          endSessionBtn.textContent = 'End Session';
          loadState();
        });
      } else {
        endSessionBtn.textContent = `Are you sure? Click to cancel (${count}s)`;
      }
    }, 1000);
  });

  // ── Settings ─────────────────────────────────────────────────────────────────
  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
});
