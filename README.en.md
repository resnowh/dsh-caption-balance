# dsh-caption-balance

![test](https://github.com/resnowh/dsh-caption-balance/actions/workflows/test.yml/badge.svg)

[中文](README.md) | English

A one-line account reading for the DeepSeek Harness UI, placed in the
**desktop title bar** right after the `应用 / 编辑` caption menu by default:

```
应用  编辑  ¥61.05 · ¥4.04  谷
```

![title bar](docs/titlebar.png)

[![dshbase verified](https://dshbase.com/badges/dsh-caption-balance.svg)](https://dshbase.com/plugins/dsh-caption-balance/)
[![dshfind](https://dshfind.com/api/badge/resnowh/dsh-caption-balance?lang=en)](https://dshfind.com/en/plugins/resnowh/dsh-caption-balance)

- **Account balance** — read through the official account service, the same source
  as *Settings → Account & balance*; the plugin never touches a credential
- **Today's spend** — local session-log token usage priced with the public price
  list, plus the current pricing window
- **Peak / off-peak** — a single character: `峰` (peak, Beijing weekdays
  09:00–12:00 and 14:00–18:00, ×2) or `谷` (off-peak, half price); the peak
  character turns amber
- **Low-balance tint** — below a configurable threshold the balance switches to
  amber or red; a gradient style can also fade it from one colour to another
  between two amounts
- **Hover for details** — balance, bonus wallets, today/month tokens and cost,
  current window, update time
- **Click to refresh**, otherwise refreshes every 30 seconds
- **Configurable position and content** — title bar, session header or sidebar
  footer; balance, today's spend and the peak character can be toggled
- Decimal digits render one step smaller so the number stays stable and quiet

## Install

Requires **DeepSeek Harness** `0.2.2-rc.1` or newer.

**Option 1: the Plugins page (GUI)**

Open **Plugins → Add plugin** (or *Install a third-party plugin* from its
dropdown) and paste the repository URL:

```
https://github.com/resnowh/dsh-caption-balance
```

Press *Enable now* after the install finishes, then restart the app.

**Option 2: the CLI**

```sh
dsh plugin --profile desktop add github:resnowh/dsh-caption-balance
```

Replace `--profile` with the profile you install into (the desktop app uses
`desktop`).

**Option 3: a local directory** (for development)

```sh
git clone https://github.com/resnowh/dsh-caption-balance.git
dsh plugin --profile desktop add /path/to/dsh-caption-balance
```

Restart the app to pick it up (the desktop build has no page-reload shortcut).

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
    display:
      position: auto           # auto | caption | header | sidebar
      showBalance: true        # show the balance
      showToday: true          # show today's spend
      showPhase: true          # show the peak / off-peak character
      smallDecimals: true      # render decimals one step smaller
      lowBalanceThreshold: 10  # tint below this amount, 0 disables
      lowBalanceStyle: warn    # warn (amber) | danger (red) | gradient
      gradientFromAmount: 0    # gradient start amount
      gradientFromColor: '#e5484d'
      gradientToAmount: 50     # gradient end amount
      gradientToColor: '#22c55e'
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

### Display settings

`display` decides where the widget renders, which segments it shows, and how a
low balance is highlighted:

| Field | Values | Meaning |
|---|---|---|
| `position` | `auto` (default) / `caption` / `header` / `sidebar` | `auto`: caption menu when present, otherwise the session header; `caption`: desktop title bar only; `header`: session header only; `sidebar`: sidebar footer row |
| `showBalance` | `true` / `false` | Show the balance |
| `showToday` | `true` / `false` | Show today's spend |
| `showPhase` | `true` / `false` | Show the peak / off-peak character |
| `smallDecimals` | `true` / `false` | Render decimals one step smaller |
| `lowBalanceThreshold` | number, default `10` | Tint the balance below this amount; `0` disables (unused by the gradient style) |
| `lowBalanceStyle` | `warn` (default) / `danger` / `gradient` | Amber, red, or a colour interpolated between two endpoints |
| `gradientFromAmount` | number, default `0` | Gradient start: at or below this amount the balance takes `gradientFromColor` |
| `gradientFromColor` | `#rrggbb`, default `#e5484d` | Low-balance end colour |
| `gradientToAmount` | number, default `50` | Gradient end: at or above this amount the balance takes `gradientToColor`; the range in between is linear |
| `gradientToColor` | `#rrggbb`, default `#22c55e` | Healthy-balance end colour |

For example, "red at ¥0 fading to green at ¥50" is `lowBalanceStyle: gradient`
with `gradientFromAmount: 0` / `gradientFromColor: '#e5484d'` /
`gradientToAmount: 50` / `gradientToColor: '#22c55e'`. The settings form also
offers colour pickers and a live gradient preview strip.

If all three `show` flags are off, the balance is kept so the widget never
renders empty. Restart the app after changing the config (the desktop build
has no page-reload shortcut).

### From the settings dialog or the Plugins page

The same form is reachable from two places, both writing one configuration:

- **Settings → Balance display** — its own page in the settings navigation
- **Plugins → Balance display → configuration** — open the plugin card; the
  form sits between the description and the bundle rows

Switch the position, the segments, the decimal style, the low-balance
threshold and colour, then press Save: it applies immediately — no YAML edit,
no restart.

- The page writes **user overrides** to
  `~/.dsh/plugin-data/dsh-caption-balance/settings.json`, which win over the
  profile defaults
- To go back to the defaults, press **Reset to defaults** in the form: it fills
  the form with the deployment defaults and saves them at once, which is the
  same as deleting that file

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
- The client half picks its render target from `display.position`: the caption
  menubar injected by the desktop preload (after 编辑, reusing the caption's own
  button styling), the conversation header's utilities slot, or the sidebar
  footer row.
- With the default `auto` position the caption menu wins, and the conversation
  header is used when that menu does not exist (macOS desktop, `dsh web`).

## Limitations

- The title-bar placement is **Windows desktop only**; elsewhere `auto` switches
  to the session header, or set `position: header` / `position: sidebar`
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
