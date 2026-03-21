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

  const statusState     = document.getElementById('statusState');
  const statusStateText = document.getElementById('statusStateText');
  let state = null;

  function setSnoozeBtn(html) {
    // Preserve the clock SVG icon inside the button
    const svg = snoozeBtn.querySelector('svg');
    snoozeBtn.innerHTML = '';
    if (svg) snoozeBtn.appendChild(svg);
    snoozeBtn.appendChild(document.createTextNode(' ' + html));
  }

  function render() {
    if (!state) return;
    const { settings, local, focusTabCount } = state;
    const now = Date.now();
    const isSnoozed = settings.snoozeUntil && now < settings.snoozeUntil;
    const isBlocking = local.blocking;

    if (isSnoozed) {
      const remaining = Math.ceil((settings.snoozeUntil - now) / 60000);
      statusCard.className    = 'status-card snoozed';
      statusMain.className    = 'status-main snoozed';
      statusState.className   = 'status-pill snoozed';
      statusStateText.textContent = 'Snoozed';
      statusMain.textContent  = 'Snoozed';
      statusSub.textContent   = `${remaining} min remaining`;
      footerNote.textContent  = 'AI blocking paused';
      snoozeRow.style.display = 'block';
      snoozeBtn.className     = 'snooze-btn end-snooze';
      setSnoozeBtn('End Snooze');
      snoozeBtn.dataset.action = 'unsnooze';
    } else if (isBlocking) {
      statusCard.className    = 'status-card active';
      statusMain.className    = 'status-main active';
      statusState.className   = 'status-pill active';
      statusStateText.textContent = 'Blocking';
      statusMain.textContent  = 'Focus Mode On';
      const count = focusTabCount || 0;
      statusSub.textContent   = `${count} focus tab${count !== 1 ? 's' : ''} open`;
      footerNote.textContent  = 'close focus tab to deactivate';
      snoozeRow.style.display = 'block';
      const dur = settings.snoozeDuration || 15;
      snoozeBtn.className     = 'snooze-btn';
      setSnoozeBtn(`Snooze ${dur}m`);
      snoozeBtn.dataset.action = 'snooze';
    } else {
      statusCard.className    = 'status-card inactive';
      statusMain.className    = 'status-main inactive';
      statusState.className   = 'status-pill inactive';
      statusStateText.textContent = 'All clear';
      statusMain.textContent  = 'All clear';
      statusSub.textContent   = 'no focus tabs detected';
      footerNote.textContent  = 'open a focus platform to activate';
      snoozeRow.style.display = 'none';
    }

    // Stats
    const streak = local.currentStreak || 0;
    streakVal.textContent = streak > 0 ? `${streak}d` : '—';
    streakVal.className = streak > 0 ? 'stat-val highlight' : 'stat-val';
    sessionsVal.textContent = local.totalSessions || '—';
    minutesVal.textContent  = local.totalMinutes  || '—';
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
