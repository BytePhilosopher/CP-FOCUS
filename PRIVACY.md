# CF Focus — Privacy Policy

_Last updated: 2026-05-20_

## TL;DR

CF Focus does **not** collect, transmit, sell, or share any personal data. Everything stays on your device. There is no analytics, no telemetry, no ads, no third-party SDKs.

## What the extension accesses

To do its job, CF Focus reads the following data — all locally, in your browser:

1. **URLs of tabs you have open.** Only used to detect whether you currently have a competitive-programming platform open (e.g. codeforces.com). The URL is never logged or sent anywhere.
2. **URLs you try to navigate to.** When you attempt to visit an AI site while a focus platform is open, the request is redirected to the extension's local blocked page. This is done via Chrome's `declarativeNetRequest` API, which is privacy-preserving by design — the extension does **not** read the request body, response, or headers.
3. **Settings you choose** (enabled platforms, custom blocklist, snooze duration, schedule, daily goal, hint thresholds, PIN hash). Stored in `chrome.storage.sync` so they sync across your Chrome devices via your Google account. We never see them.
4. **Local stats** (today's minutes, streak, sessions, blocks avoided, problems solved). Stored in `chrome.storage.local` on this device only.

## What the extension does NOT do

- Does not send any data to any server.
- Does not embed analytics, A/B testing, or telemetry of any kind.
- Does not read page content of any site.
- Does not read or store browsing history.
- Does not access cookies, passwords, or form data.
- Does not include any third-party scripts. The only external resource is Google Fonts (loaded by the popup, options, and blocked pages); if you prefer fully offline operation, block fonts.googleapis.com for the extension origin.

## PIN

If you set an optional PIN to protect the Settings page, only its SHA-256 hash is stored. The PIN itself is never stored in plain text and never leaves your device.

## Permissions explained

| Permission | Why |
|------------|-----|
| `tabs` | Detect open focus-platform tabs |
| `storage` | Save your settings and stats |
| `declarativeNetRequest`, `declarativeNetRequestWithHostAccess` | Redirect AI-site requests to the blocked page without reading the requests |
| `alarms` | Schedule snooze expiry, break reminders, and session timers |
| `notifications` | Show "break time" and "session complete" notifications |
| Host permissions `*://*/*` | Allow blocking of user-defined custom AI domains (we can't know in advance which hosts you'll add) |

## Contact

If you have questions, open an issue on the project's GitHub repository.

## Changes

If this policy changes meaningfully, the extension version will be bumped and this file updated. There is no automated notification because we have no way to contact you — we don't know who you are.
