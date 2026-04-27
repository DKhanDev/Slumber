# 🌙 Slumber — Tab Suspender

Suspend inactive tabs to free up memory and CPU. Restore them instantly with one click or keypress.

[Install from Chrome Web Store](#) · [Report a bug](https://github.com/DKhanDev/Slumber/issues) · [Support the project](https://ko-fi.com/dkhandev)

---

## What it does

When a tab has been idle for a configurable period, Slumber replaces it with a lightweight sleeping page that preserves the title, favicon, and original URL. The tab takes up no memory and no CPU until you wake it. One click or keypress restores it exactly where you left off.

Free tier suspends up to 10 tabs concurrently. Pro removes all limits.

---

## Features

| Feature | Free | Pro |
|---|---|---|
| Auto-suspend by timer | ✓ | ✓ |
| Manual suspend (one tab) | ✓ | ✓ |
| Sleep all / wake all | ✓ | ✓ |
| Never suspend pinned tabs | ✓ | ✓ |
| Never suspend audible tabs | ✓ | ✓ |
| Suspended tab limit | 10 tabs | Unlimited |
| Bulk select & suspend | — | ✓ |
| Domain whitelist | — | ✓ |
| Cross-device settings sync | — | ✓ |

**Pro is $4.99 one-time** via Paddle. No subscription, no renewal.

---

## Trust & transparency

**Permissions:** `tabs`, `storage`, `alarms`
**Host permissions:** `dkhandev-site-payment-worker.workers.dev` — used solely to validate your Pro license key at activation and silently on browser startup
**Telemetry:** none
**Network:** the only external connection is a single GET request to the license validation endpoint, containing only your license key. It is never triggered by browsing activity and never transmits tab data
**Data:** your tab URLs, titles, and favicons never leave your device
**Payments:** handled entirely by Paddle — Slumber never sees your card details or email
**Pro license:** a `XXXX-XXXX-XXXX-XXXX` key issued at purchase. Enter it once in Options → License. It is stored in `chrome.storage.sync` and syncs automatically across all Chrome instances signed in to your Google account. On a fresh profile, enter the same key again to restore access

Most competing tab suspenders request `<all_urls>` host access and additional permissions like `webNavigation` or `history`. Slumber requests none of these. Every permission and network call in this list is verifiable by reading the source.

---

## Why Slumber exists

The Great Suspender was removed from the Chrome Web Store in February 2021 after its new owners pushed an update containing malware. Over two million users were left without a trusted tab suspender.

Slumber was built to fill that gap — on Manifest V3 (the current Chrome extension standard), with minimal permissions, no telemetry, and a fully auditable codebase. It is owned and maintained by a solo developer with no plans to sell.

---

## File structure

```
slumber/
├── manifest.json
├── icons/
│   └── icon-{16,32,48,128}.png
├── background/
│   ├── worker.js           # Service worker, message router, tab event listeners
│   ├── suspender.js        # Core suspend/unsuspend logic, exemption checks
│   ├── alarms.js           # Alarm scheduling utilities
│   └── storage.js          # Typed chrome.storage wrappers
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js            # Tab list, select mode, free tier meter
├── suspended/
│   ├── suspended.html      # Sleeping tab page
│   ├── suspended.css
│   └── suspended.js        # Renders metadata from URL hash, wake on interaction
└── options/
    ├── options.html
    ├── options.css
    └── options.js          # General, Whitelist, License, Stats sections
```

---

## Technical notes

**Manifest V3.** The extension is built entirely on MV3. No MV2 APIs or patterns are used.

**No remote code.** No scripts are fetched or executed at runtime. The only outbound request the extension makes is the license key validation GET call — it carries no browsing data.

**Pro license via Chrome Sync.** After purchase, your `XXXX-XXXX-XXXX-XXXX` license key is validated against a Cloudflare Worker and the result stored in `chrome.storage.sync`. Chrome syncs it across every signed-in browser automatically. On startup the key is silently re-validated; if the server is unreachable, the last stored valid state is preserved. Users on a fresh profile can restore access by entering the same key from their purchase receipt.

**Tab metadata privacy.** URLs, titles, and favicons are encoded into the URL hash of the suspended page (`suspended.html#url=...&title=...&favicon=...`) and stored in `chrome.storage.local` for the duration of the suspension only. They are deleted the moment the tab wakes. They are never transmitted.

---

## Roadmap

**v1.1 — Suspension schedule**
Define time windows during which auto-suspend is active. Example: only suspend tabs between 9am–6pm on weekdays.

**v1.2 — Per-tab rules**
Set individual tab behaviour — never suspend a specific tab regardless of domain, or always suspend a specific tab immediately.

---

## License

MIT
