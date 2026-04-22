# 🌙 Slumber — Tab Suspender

Suspend inactive tabs to free up memory and CPU. Restore them instantly with one click or keypress.

[Install from Chrome Web Store](#) · [Report a bug](../../issues) · [Support the project](https://ko-fi.com/[handle])

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

**Pro is $4.99 one-time** via ExtensionPay and Stripe. No subscription, no renewal.

---

## Trust & transparency

**Permissions:** `tabs`, `storage`, `alarms`
**Host permissions:** `extensionpay.com` only — for Pro subscription verification, nothing else
**Telemetry:** none
**Network:** the only external call is to `extensionpay.com` to verify your Pro subscription status. It is made once on install and periodically in the background — never triggered by your browsing activity, never transmitting tab data
**Data:** your tab URLs, titles, and favicons never leave your device
**Payments:** handled entirely by ExtensionPay and Stripe — Slumber never sees your card details or email

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
├── ExtPay.js               # ExtensionPay 3.1.1 (bundled, not remote)
├── ExtPay.esm.js           # ES module shim for ExtPay
├── icons/
│   └── icon-{16,32,48,128}.png
├── background/
│   ├── worker.js           # Service worker, message router, tab event listeners
│   ├── suspender.js        # Core suspend/unsuspend logic, exemption checks
│   ├── pro.js              # isPro() and openPaymentPage() via ExtensionPay
│   ├── alarms.js           # Alarm scheduling utilities
│   ├── storage.js          # Typed chrome.storage wrappers
│   └── license.js          # Stub retained for import compatibility
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

**No remote code.** `ExtPay.js` is bundled inside the extension zip and loaded via `chrome.runtime.getURL()` — a `chrome-extension://` URL, not a remote one. No scripts are fetched and executed at runtime.

**ES modules throughout.** All background files use `import`/`export`. ExtPay's IIFE build is wrapped in a thin ES module shim (`ExtPay.esm.js`) that dynamic-imports it and re-exports the `ExtPay` constructor, avoiding the need for a bundler.

**No circular dependencies.** `isPro()` and `openPaymentPage()` live in `pro.js`, which is imported by both `worker.js` and `suspender.js` without creating a cycle.

**MV3 service worker caveat.** Per ExtensionPay's documentation, top-level `extpay` variables go `undefined` inside service worker callbacks. `pro.js` re-declares `ExtPay(EXTPAY_ID)` inside each function body as the correct workaround. `startBackground()` is called only once, at the top level of `worker.js`.

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
