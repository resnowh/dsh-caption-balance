# dsh-caption-balance

A one-line account balance strip for the **DeepSeek Harness desktop title bar**,
sitting right after the `应用 / 编辑` caption menu:

```
应用  编辑  ¥61.05 · ¥4.04  谷
```

![title bar](docs/titlebar.png)

- **Account balance** — read through the official account service, the same source
  as *Settings → Account & balance*; the plugin never touches a credential
- **Today's spend** — local session-log token usage priced with the public price
  list, plus the current pricing window
- **Peak / off-peak** — a single character: `峰` (peak, Beijing weekdays
  09:00–12:00 and 14:00–18:00, ×2) or `谷` (off-peak, half price); the peak
  character turns amber
- **Hover for details** — balance, bonus wallets, today/month tokens and cost,
  current window, update time
- **Click to refresh**, otherwise refreshes every 30 seconds
- Decimal digits render one step smaller so the number stays stable and quiet

## Install

Requires **DeepSeek Harness desktop (Windows)** `0.2.2-rc.1` or newer.

```sh
dsh plugin --profile desktop add github:resnowh/dsh-caption-balance
```

Restart the app and reload the page (`Ctrl+Shift+R`).

## Configuration

Edit the row named `dsh-caption-balance` in the profile's `cordis.patch.yml`:

```yaml
- id: dsh-caption-balance
  name: dsh-caption-balance
  config:
    currency: CNY
    refreshSeconds: 30         # client poll interval (seconds, min 5)
    balanceRefreshSeconds: 180 # balance cache lifetime (seconds)
    balanceTimeoutMs: 10000    # balance query timeout
    peakMultiplier: 2          # peak-hour price multiplier
    keepDays: 45               # usage log retention (covers one month)
    sessionsDir: null          # defaults to $DSH_HOME/sessions
    allowHosts: []             # extra hostnames allowed to read the summary route
    aliases:
      deepseek-v4-flash: deepseek-flash
    models:
      deepseek-flash:
        cacheHit: 0.02   # CNY per million tokens (off-peak)
        cacheMiss: 1
        output: 4
```

Prices are made up of the **off-peak** rate; peak hours multiply them by
`peakMultiplier`. Models without a configured price still count tokens but are
excluded from cost and listed as unpriced.

## How it works

- The host half registers one exact route, `GET /api/dsh-caption-balance/summary`,
  on the Harness web server. It only answers loopback, same-origin, non-cross-site
  callers.
- Balance comes from `deepseekAccount.getBalance` with a timeout and a cache.
- Usage is rebuilt from the session logs under `$DSH_HOME/sessions`:
  multi-frame Zstandard files are split frame by frame from the container
  structure, and only `assistant/message` events with `data.usage` are counted.
  Each session directory is read from its highest-version log file only, so a
  migrated session is never counted twice.
- The client half appends one button to the caption menubar that the desktop
  preload injects, right after 编辑, reusing the caption's own button styling.
- On platforms without that caption menu (macOS desktop, `dsh web`) the widget
  falls back to the conversation header's utilities slot.

## Limitations

- The desktop title bar placement is **Windows-only**; elsewhere the fallback
  chip appears in the session header instead
- Cost is an **estimate** from the configured price table, not a bill
- Chinese public holidays are not modelled; peak pricing follows the weekday rule
- Today/month buckets use the host's local timezone; peak windows use Beijing time
- The caption placement depends on the desktop preload's title-bar structure and
  may need an update after a major DSH release

## Development

```sh
npm test    # node --test: pricing, log decoding, aggregation, config, client mounting
```

Zero dependencies and no build step: `client.js` is executed directly by the DSH
client module loader, and the host half only uses Node built-ins.

## License

MIT © 2026 resnowh
