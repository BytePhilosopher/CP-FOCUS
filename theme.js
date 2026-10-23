// CF Focus — theme.js
// Shared light/dark theming for the popup, the options page and the block page.
//
// Every page loads this FIRST, in <head>, so the theme is stamped on <html>
// before anything paints. chrome.storage is async and would flash the wrong
// theme, so the preference is mirrored into localStorage (shared across all
// extension pages, since they're one origin) and read synchronously here.
//
// The stored preference is 'light' | 'dark' | 'system'. `data-theme` on <html>
// is always resolved to a concrete 'light' or 'dark' — that way the CSS never
// needs a prefers-color-scheme duplicate of every variable.

(function () {
  const KEY = 'cf-theme';
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  function readPref() {
    try {
      const v = localStorage.getItem(KEY);
      if (v === 'light' || v === 'dark' || v === 'system') return v;
    } catch (_) {}
    return 'system';
  }

  function resolve(pref) {
    if (pref === 'light' || pref === 'dark') return pref;
    return media.matches ? 'dark' : 'light';
  }

  function stamp(pref) {
    const resolved = resolve(pref);
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.style.colorScheme = resolved;
    return resolved;
  }

  // Apply immediately — this runs before <body> exists, so there's no flash.
  let pref = readPref();
  stamp(pref);

  // Follow the OS while the preference is 'system'.
  const onMediaChange = () => { if (pref === 'system') notify(stamp(pref)); };
  if (media.addEventListener) media.addEventListener('change', onMediaChange);
  else if (media.addListener) media.addListener(onMediaChange);

  const listeners = [];
  function notify(resolved) {
    for (const fn of listeners) { try { fn(resolved, pref); } catch (_) {} }
  }

  function set(next) {
    pref = (next === 'light' || next === 'dark') ? next : 'system';
    try { localStorage.setItem(KEY, pref); } catch (_) {}
    const resolved = stamp(pref);
    try {
      if (window.chrome && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.set({ theme: pref }, () => { void chrome.runtime.lastError; });
      }
    } catch (_) {}
    notify(resolved);
    return resolved;
  }

  window.CFTheme = {
    get: () => pref,
    resolved: () => resolve(pref),
    set,
    // Light → Dark → System → Light
    cycle() { return set({ light: 'dark', dark: 'system', system: 'light' }[pref] || 'light'); },
    onChange(fn) { listeners.push(fn); },
    /**
     * Wire up a control that shows the current theme and cycles on click.
     * The label/icon update is left to the caller via onChange.
     */
    attachToggle(el) {
      if (!el) return;
      el.addEventListener('click', e => { e.stopPropagation(); this.cycle(); });
    },
  };

  // Reconcile with the synced preference once chrome.storage answers. This only
  // matters on a page's first load in a fresh profile, or after another device
  // changed it — localStorage already holds the right value the rest of the time.
  try {
    if (window.chrome && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get({ theme: null }, res => {
        void chrome.runtime.lastError;
        const synced = res && res.theme;
        if (!synced || synced === pref) return;
        pref = synced;
        try { localStorage.setItem(KEY, pref); } catch (_) {}
        notify(stamp(pref));
      });
    }
  } catch (_) {}
})();
