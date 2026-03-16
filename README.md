# CF Focus — AI Blocker for Competitive Programming

> Block AI tools automatically whenever you open a competitive programming platform. Train harder. Think deeper.

---

## What it does

CF Focus is a Chrome extension that **automatically blocks AI websites** (ChatGPT, Claude, Gemini, etc.) the moment you open a competitive programming platform like Codeforces or LeetCode. When you close the platform tab, AI sites become accessible again — no manual toggling needed.

---

## Features

### Auto-Blocking
- Activates the moment you open a focus platform tab
- Deactivates automatically when you close it
- Shows a **blocked page** with the site name and a motivational quote

### Multi-Platform Support
Choose which platforms trigger blocking:
| Platform | Domain |
|----------|--------|
| Codeforces | codeforces.com |
| LeetCode | leetcode.com |
| AtCoder | atcoder.jp |
| HackerRank | hackerrank.com |
| CodeChef | codechef.com |
| CSES | cses.fi |

### Custom Blocklist
- Toggle individual AI sites on/off
- Add any custom domain to block (e.g. `khanacademy.org`)
- 19 AI sites blocked by default

### Snooze
- Pause blocking temporarily (5m / 15m / 30m / 1h / 2h)
- Keyboard shortcut: `Ctrl+Shift+B` (Mac: `⌘⇧B`)
- Auto-resumes when the snooze expires

### Scheduled Blocking
- Block AI during fixed hours regardless of open tabs
- Pick active days (Mon–Sun) and a time range
- Perfect for structured study schedules

### Focus Stats
- Tracks your daily streak, total sessions, and total focus minutes
- Streak increments each day you have at least one focus session
- All stats visible in the popup and settings page

### PIN Lock
- Set a 4–8 digit PIN to prevent changing settings
- PIN is hashed (SHA-256) before storage — never stored in plain text
- Protects against impulsive disabling

### Settings sync
- All settings sync across your Chrome devices via `chrome.storage.sync`

---

## Blocked AI Sites (defaults)

ChatGPT · OpenAI Chat · Claude · Gemini · Copilot · Bing Chat · Perplexity · Phind · Poe · DeepSeek · Grok · Mistral · You.com · Cohere · HuggingFace Chat · AI Studio · Writesonic · xAI · Character.AI

---

## Installation

### From source (local testing)

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select the `codeforces-ai-blocker` folder
6. The extension icon appears in your toolbar

### From Chrome Web Store
*(Coming soon)*

---

## Usage

1. Open any enabled focus platform (e.g. codeforces.com)
2. The extension badge shows **ON** — AI sites are now blocked
3. Try opening ChatGPT → you'll see the blocked page instead
4. Close all focus platform tabs → AI sites become accessible again

**To temporarily pause blocking:**
- Click the extension icon → **Snooze Xm**
- Or press `Ctrl+Shift+B` / `⌘⇧B`

**To change settings:**
- Click the **⚙** icon in the popup → opens the full settings page

---

## File Structure

```
codeforces-ai-blocker/
├── manifest.json      # Extension config (MV3)
├── background.js      # Service worker: blocking logic, stats, snooze, schedule
├── popup.html         # Toolbar popup UI
├── popup.js           # Popup logic
├── options.html       # Full settings page
├── options.js         # Settings logic
├── blocked.html       # Page shown when a site is blocked
├── rules.json         # (legacy reference, not loaded)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## How it works

- Uses Chrome's `declarativeNetRequest` API to redirect blocked sites to `blocked.html` — fast, reliable, and privacy-respecting (no request content is read)
- All rules are **dynamic** — added/removed instantly when blocking state changes
- The service worker is **stateless**: on every tab event it queries all open tabs fresh, so it works correctly even after Chrome restarts or the service worker is killed
- Settings are stored in `chrome.storage.sync` (synced across devices); stats in `chrome.storage.local`

---

## Privacy

- No data is ever sent to any server
- No browsing history is read or stored
- Only tab URLs are checked to detect focus platform tabs
- PIN is stored as a SHA-256 hash, never in plain text

---

## Contributing

Pull requests welcome. To add a new platform or AI site, edit the `PLATFORMS` / `DEFAULT_BLOCKED` arrays in `background.js` and mirror the change in `options.js`.

---

## License

MIT
