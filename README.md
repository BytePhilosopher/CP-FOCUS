# CF Focus — AI Blocker for Competitive Programming

> Block AI tools automatically whenever you open a competitive programming platform. Earn hints by struggling first. Train harder, think deeper.

---

## What it does

CF Focus is a Chrome extension that **automatically blocks AI chatbots** (ChatGPT, Claude, Gemini, Copilot, …) the moment you open a competitive programming platform like Codeforces or LeetCode. Close the platform tab and AI sites become accessible again — no manual toggling.

It also gives you **Focus Sessions** (timed deep-work blocks, with an optional Hardcore mode that can't be paused), a **Progressive Hint Unlock** system that rewards real struggle, and tracks your **daily streak, focus minutes, blocks avoided, and problems solved**.

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

### Focus Sessions
Start a timed deep-work block from the popup (15 / 25 / 45 / 60 / 90 min). Blocking stays on for the entire duration regardless of which tabs are open.

- **Standard** — you can end the session early.
- **Hardcore** — no snooze, no end, no exit. Disables the hint unlock too. Use sparingly.

### Custom Blocklist
- Toggle individual AI sites on/off
- Add any custom domain to block
- 19 AI sites blocked by default

### Snooze
- Pause blocking temporarily (5m / 15m / 30m / 1h / 2h)
- Keyboard shortcut: `Ctrl+Shift+B` (Mac: `⌘⇧B`)
- Auto-resumes when the snooze expires
- Disabled during Hardcore sessions

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
- Vertical bar chart and "resistance rate" donut in the Overview page.

### PIN Lock
- Set a 4–8 digit PIN to gate the Settings page
- PIN stored as SHA-256 hash, never plain text
- Useful for protecting against impulsive self-disabling

### Settings Sync
Settings sync across your Chrome devices via `chrome.storage.sync`. Stats stay per-device.

---

## Blocked AI Sites (defaults)

ChatGPT · OpenAI Chat · Claude · Gemini · Copilot · Bing Chat · Perplexity · Phind · Poe · DeepSeek · Grok · Mistral · You.com · Cohere · HuggingFace Chat · AI Studio · Writesonic · xAI · Character.AI

---

## Installation

### From Chrome Web Store
`https://chromewebstore.google.com/detail/cf-focus-%E2%80%94-ai-blocker-for/obkgjknggnkpboahhaeieemknmpngmpl?utm_source=item-share-cb&pli=1`
---

## Usage

1. Open any enabled focus platform (e.g. `codeforces.com`)
2. The extension badge shows **ON** — AI sites are now blocked
3. Try opening ChatGPT → you'll see the blocked page instead, with your hint timeline
4. Close all focus platform tabs → AI sites become accessible again

**To temporarily pause blocking:**
- Click the extension icon → **Snooze Xm**
- Or press `Ctrl+Shift+B` / `⌘⇧B`

**To start a Focus Session:**
- Click the extension icon → pick a duration → optionally toggle Hardcore → **Start Focus Session**

**To change settings:**
- Click the **⚙** icon in the popup → opens the full settings page

---

## File Structure

```
codeforces-ai-blocker/
├── manifest.json      # Extension config (MV3)
├── background.js      # Service worker: blocking, sessions, stats, hint tiers
├── popup.html / .js   # Toolbar popup UI
├── options.html / .js # Full settings page
├── blocked.html / .js # Page shown when an AI site is blocked
├── PRIVACY.md         # Privacy policy
├── LICENSE            # MIT
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

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

Pull requests welcome. To add a new platform or AI site, edit the `PLATFORMS` / `DEFAULT_BLOCKED` arrays in `background.js` and mirror the change in `options.js`.

---

## License

MIT — see [LICENSE](LICENSE).
