document.addEventListener('DOMContentLoaded', () => {
  const statusCard  = document.getElementById('statusCard');
  const statusDot   = document.getElementById('statusDot');
  const statusMain  = document.getElementById('statusMain');
  const statusSub   = document.getElementById('statusSub');
  const snoozeRow   = document.getElementById('snoozeRow');
  const snoozeBtn   = document.getElementById('snoozeBtn');
  const footerNote  = document.getElementById('footerNote');
  const streakVal   = document.getElementById('streakVal');
  const sessionsVal = document.getElementById('sessionsVal');
  const minutesVal  = document.getElementById('minutesVal');

  let state = null;

  function render() {
    if (!state) return;
    const { settings, local, focusTabCount } = state;
    const now = Date.now();
    const isSnoozed = settings.snoozeUntil && now < settings.snoozeUntil;
    const isBlocking = local.blocking;

    if (isSnoozed) {
      const remaining = Math.ceil((settings.snoozeUntil - now) / 60000);
      statusCard.className = 'status-card snoozed';
      statusDot.className  = 'status-dot snoozed';
      statusMain.className = 'status-main snoozed';
      statusMain.textContent = '⏸ Snoozed';
      statusSub.textContent  = `${remaining} min remaining`;
      footerNote.textContent = 'AI blocking paused';
      snoozeRow.style.display = 'flex';
      snoozeBtn.textContent = 'End Snooze';
      snoozeBtn.className = 'snooze-btn end-snooze';
      snoozeBtn.dataset.action = 'unsnooze';
    } else if (isBlocking) {
      statusCard.className = 'status-card active';
      statusDot.className  = 'status-dot active';
      statusMain.className = 'status-main active';
      statusMain.textContent = '🔒 AI Blocked';
      const count = focusTabCount || 0;
      statusSub.textContent  = `${count} focus tab${count !== 1 ? 's' : ''} open`;
      footerNote.textContent = 'close focus tab to deactivate';
      snoozeRow.style.display = 'flex';
      const dur = settings.snoozeDuration || 15;
      snoozeBtn.textContent = `Snooze ${dur}m`;
      snoozeBtn.className = 'snooze-btn';
      snoozeBtn.dataset.action = 'snooze';
    } else {
      statusCard.className = 'status-card inactive';
      statusDot.className  = 'status-dot inactive';
      statusMain.className = 'status-main inactive';
      statusMain.textContent = '✓ All clear';
      statusSub.textContent  = 'no focus tabs detected';
      footerNote.textContent = 'open a focus platform to activate';
      snoozeRow.style.display = 'none';
    }

    // Stats
    const streak = local.currentStreak || 0;
    streakVal.textContent = streak > 0 ? `🔥${streak}d` : '0d';
    streakVal.className = streak > 0 ? 'stat-val highlight' : 'stat-val';
    sessionsVal.textContent = local.totalSessions || 0;
    minutesVal.textContent  = local.totalMinutes  || 0;
  }

  function loadState() {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, response => {
      state = response;
      render();
    });
  }

  loadState();

  // Refresh snooze countdown every 30s
  setInterval(() => { if (state) render(); }, 30000);

  snoozeBtn.addEventListener('click', () => {
    const action = snoozeBtn.dataset.action;
    const type = action === 'unsnooze' ? 'UNSNOOZE' : 'SNOOZE';
    const payload = type === 'SNOOZE'
      ? { type, minutes: state?.settings?.snoozeDuration || 15 }
      : { type };

    chrome.runtime.sendMessage(payload, () => loadState());
  });

  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
});
