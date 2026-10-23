# CF Focus — AI Blocker for Competitive Programming

> A Chrome extension that automatically blocks AI tools whenever you open a competitive programming platform. Earn hints by working through the problem first — train harder, think deeper.

**[➜ Install from the Chrome Web Store](https://chromewebstore.google.com/detail/obkgjknggnkpboahhaeieemknmpngmpl)**

---

## Overview

CF Focus **automatically blocks AI chatbots** (ChatGPT, Claude, Gemini, Copilot, and more) the moment you open a competitive programming platform such as Codeforces or LeetCode. Close the platform tab and AI sites become accessible again — no manual toggling required.

It also provides a **count-up focus clock** that runs for as long as a practice tab is open, a **Progressive Hint Unlock** system that rewards genuine effort, and tracks your **daily streak, focus minutes, blocks avoided, and problems solved** — including a year-long lock-in calendar.

---

## Features

### Auto-Blocking
- Activates the moment you open a focus platform tab
- Deactivates automatically when the last focus tab closes
- Shows a calming blocked page with the site name, a motivational quote, and your hint progress

### Multi-Platform Support
| Platform | Domain |
|----------|--------|
| Codeforces | codeforces.com |
| LeetCode | leetcode.com |
| AtCoder | atcoder.jp |
| HackerRank | hackerrank.com |
| CodeChef | codechef.com |
| CSES | cses.fi |

You can also add **custom platforms** (e.g. Kattis, open.kattis.com) to trigger blocking.

### Progressive Hint Unlock
The longer you stay focused on a problem without snoozing or solving, the more help you earn:

1. **0 → 15 min** — Full block. No hints.
2. **15 min** — Hint 1 unlocks: general approach questions ("What data structure fits? Can you write the brute force?").
3. **25 min** — Hint 2 unlocks: specific algorithmic patterns ("If monotonic, binary-search the answer. Small N → bitmask.").
4. **35 min** — AI unlock button appears: you've put in real effort, you've earned a 10-min window of access.

All thresholds are configurable in **Settings → Hints**. The timer resets when you snooze, solve a problem, or close all focus tabs.

### Focus Clock
The popup shows a single count-up clock with a flame that burns brighter the longer you go. It starts the moment your first practice tab opens and resets when the last one closes — snoozing does not reset it. The ring fills toward your daily goal.

**Start Focus Tab** opens (or jumps to) a practice tab, which is what starts the clock.

### Custom Blocklist
- Toggle individual AI sites on/off
- Add any custom domain to block
- 19 AI sites blocked by default

### Snooze
- Pause blocking temporarily (5m / 15m / 30m / 1h / 2h)
- Keyboard shortcut: `Ctrl+Shift+B` (Mac: `⌘⇧B`)
- Auto-resumes when the snooze expires

### Scheduled Blocking
- Block AI during fixed hours regardless of open tabs
- Pick active days (Mon–Sun) and a time range
- Supports overnight windows (e.g. 22:00 → 02:00)

### Daily Goal & Break Reminders
- Set a daily focus goal (30 min – 4 h). Progress shown in the popup.
- Optional break-reminder notification after sustained focus (25 / 50 / 90 / 120 min, or off).

### Focus Stats
- **Today**: minutes focused, AI blocks avoided, problems solved.
- **All-time**: total sessions, total focus hours, blocks avoided, problems solved.
- **Streak**: current and longest streak of consecutive focused days.
- **Lock-In Calendar**: a GitHub-style year grid of every day you kept the blocker on, with a per-month roll-up of days locked in.
- Vertical bar chart and "resistance rate" donut in the Overview page.

### PIN Lock
- Set a 4–8 digit PIN to gate the Settings page
- PIN stored as SHA-256 hash, never plain text
- Useful for protecting against impulsive self-disabling

### Light & Dark Themes
Every surface — popup, settings and the block page — supports light and dark. Pick **Light / Dark / Auto** from the popup's theme button or **Settings → Appearance**; Auto follows your OS. The choice syncs across devices.

### Settings Sync
Settings sync across your Chrome devices via `chrome.storage.sync`. Stats stay per-device.

---

## Blocked AI Sites (defaults)

ChatGPT · OpenAI Chat · Claude · Gemini · Copilot · Bing Chat · Perplexity · Phind · Poe · DeepSeek · Grok · Mistral · You.com · Cohere · HuggingFace Chat · AI Studio · Writesonic · xAI · Character.AI

---

## Installation

[**Install CF Focus from the Chrome Web Store →**](https://chromewebstore.google.com/detail/obkgjknggnkpboahhaeieemknmpngmpl)

1. Open the listing on the Chrome Web Store.
2. Click **Add to Chrome**, then confirm.
3. The settings page opens automatically on first install.

---

## Usage

1. Open any enabled focus platform (e.g. `codeforces.com`)
2. The extension badge shows **ON** — AI sites are now blocked
3. Try opening ChatGPT → you'll see the blocked page instead, with your hint timeline
4. Close all focus platform tabs → AI sites become accessible again

**To temporarily pause blocking:**
- Click the extension icon → **Snooze Xm**
- Or press `Ctrl+Shift+B` / `⌘⇧B`

**To start focusing:**
- Click the extension icon → **Start Focus Tab**. The clock starts and keeps counting until every practice tab is closed.

**To change settings:**
- Click the **⚙** icon in the popup → opens the full settings page

---

## Project Structure

```
codeforces-ai-blocker/
├── manifest.json           # Extension manifest (Manifest V3)
├── background.js           # Service worker — blocking, sessions, stats, hint tiers
│
├── popup.html              # Toolbar popup — markup
├── popup.js                # Toolbar popup — logic
├── options.html            # Settings page — markup
├── options.js              # Settings page — logic
├── blocked.html            # Block screen shown when an AI site is intercepted
├── blocked.js              # Block screen — logic
│
├── icons/                  # Extension icons (16 / 48 / 128 px)
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
│
├── store-assets/           # Chrome Web Store listing assets
│   ├── LISTING.md
│   ├── SCREENSHOTS.md
│   ├── icon.svg
│   ├── promo-marquee.html
│   └── promo-small.html
│
├── DEPLOY.md               # Build & publishing guide
├── PRIVACY.md              # Privacy policy
├── README.md               # Project documentation
└── LICENSE                 # MIT License
```

| Area | Files | Responsibility |
|------|-------|----------------|
| Core | `manifest.json`, `background.js` | Extension configuration and the service worker that drives blocking, focus sessions, stats, and hint tiers |
| UI | `popup.*`, `options.*`, `blocked.*` | Toolbar popup, full settings page, and the screen shown when an AI site is blocked |
| Assets | `icons/`, `store-assets/` | Runtime icons and Chrome Web Store listing material |
| Docs | `README.md`, `PRIVACY.md`, `DEPLOY.md`, `LICENSE` | Documentation, privacy policy, deployment notes, and license |

---

## How it works

- Uses Chrome's `declarativeNetRequest` API to redirect blocked sites to `blocked.html` — fast, reliable, and privacy-respecting (no request *content* is read)
- Path-suffixed entries (Bing Chat, HF Chat) use `regexFilter` so they only match the chat path
- All DNR rules are **dynamic** — added/removed instantly when blocking state changes
- The service worker is **stateless**: on every event it queries open tabs fresh, so it works correctly after Chrome restarts or service worker eviction
- Settings live in `chrome.storage.sync`; stats and per-tab hint timer in `chrome.storage.local`

---

## Privacy

- No data is ever sent to any server
- No browsing history is read or stored
- Only tab URLs are checked locally to detect focus platform tabs
- PIN is stored as a SHA-256 hash

See [PRIVACY.md](PRIVACY.md) for the full policy.

---

## Contributing

Contributions are welcome. To add a new platform or AI site, edit the `PLATFORMS` / `DEFAULT_BLOCKED` arrays in `background.js` and mirror the change in `options.js`. Please open an issue to discuss substantial changes before submitting a pull request.

---

## Author

**Yostina Abera**
📧 [aberayostina@gmail.com](mailto:aberayostina@gmail.com)

---

## License

Released under the MIT License. See [LICENSE](LICENSE) for details.

Copyright © 2026 Yostina Abera.
