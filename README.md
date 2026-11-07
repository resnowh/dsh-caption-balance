# dsh-caption-balance

![test](https://github.com/resnowh/dsh-caption-balance/actions/workflows/test.yml/badge.svg)

[English](README.en.md) | 中文

在 DeepSeek Harness 界面里显示一行实时读数，默认放在**桌面端标题栏**（`应用 / 编辑` 菜单右边）：

```
应用  编辑  ¥61.05 · ¥4.04  谷
```

![标题栏效果](docs/titlebar.png)

[![dshbase 已验证](https://dshbase.com/badges/dsh-caption-balance.svg)](https://dshbase.com/zh/plugins/dsh-caption-balance/)
[![dshfind](https://dshfind.com/api/badge/resnowh/dsh-caption-balance?lang=zh)](https://dshfind.com/zh/plugins/resnowh/dsh-caption-balance)

- **账户余额** —— 通过官方账号服务读取，和「设置 → 账号与余额」同源，插件本身不接触任何凭证
- **今日花费** —— 由本机会话日志统计出的 token 用量按价目表折算，附当前时段
- **峰 / 谷** —— 单字提示当前计价时段：`峰` 为北京时间工作日 9:00–12:00、14:00–18:00（单价 ×2），`谷` 为半价时段，高峰时该字变为琥珀色
- **余额偏低变色** —— 低于设定阈值时余额转为琥珀色或红色，阈值与颜色可配置
- **悬停看明细** —— 余额、赠送余额、今日/本月 token 与花费、当前时段、更新时间
- **点击立即刷新**，默认每 30 秒自动刷新
- **位置与内容可配** —— 标题栏 / 会话标题栏 / 侧边栏底部三种位置，余额、今日花费、峰谷单字可分别开关
- 金额的小数部分默认小一号，数字等宽，刷新时不跳动

## 安装

要求：**DeepSeek Harness** `0.2.2-rc.1` 及以上。

```sh
dsh plugin --profile desktop add github:resnowh/dsh-caption-balance
```

安装后重启应用，并刷新页面（`Ctrl+Shift+R`）。

> 需要 `dsh.bundle.patch` 才能被 `dsh plugin add` 识别；本包已声明。

## 配置

配置写在 profile 的 `cordis.patch.yml` 中与 `dsh-caption-balance` 同名的那一行里：

```yaml
- id: dsh-caption-balance
  name: dsh-caption-balance
  config:
    currency: CNY
    refreshSeconds: 30        # 客户端轮询间隔（秒，最小 5）
    balanceRefreshSeconds: 180 # 余额缓存时长（秒）
    balanceTimeoutMs: 10000    # 余额查询超时
    peakMultiplier: 2          # 高峰时段单价倍数
    keepDays: 45               # 用量日志保留天数（覆盖一个自然月）
    sessionsDir: null          # 默认取 $DSH_HOME/sessions
    allowHosts: []             # 额外允许访问汇总接口的主机名
    display:
      position: auto           # auto | caption | header | sidebar
      showBalance: true        # 显示余额
      showToday: true          # 显示今日花费
      showPhase: true          # 显示峰 / 谷单字
      smallDecimals: true      # 小数部分小一号
      lowBalanceThreshold: 10  # 余额低于该值变色，0 关闭
      lowBalanceStyle: warn    # warn（琥珀）| danger（红）
    aliases:
      deepseek-v4-flash: deepseek-flash
    models:
      deepseek-flash:
        cacheHit: 0.02   # 元 / 百万 tokens（空闲价）
        cacheMiss: 1
        output: 4
```

价格单位是「元 / 百万 tokens」，填**空闲时段**单价，高峰时段按 `peakMultiplier` 倍计算。未配置单价的模型仍统计 token，但不计入花费，并在明细里标注。

### 显示设置

`display` 控制显示在哪里、显示哪些内容、以及余额偏低时的提示：

| 字段 | 取值 | 说明 |
|---|---|---|
| `position` | `auto`（默认）/ `caption` / `header` / `sidebar` | `auto`：标题栏菜单存在就放标题栏，否则放会话标题栏；`caption`：只放桌面端标题栏；`header`：只放会话标题栏；`sidebar`：只放侧边栏底部（导航行样式） |
| `showBalance` | `true` / `false` | 是否显示余额 |
| `showToday` | `true` / `false` | 是否显示今日花费 |
| `showPhase` | `true` / `false` | 是否显示峰 / 谷单字 |
| `smallDecimals` | `true` / `false` | 小数部分是否缩小一号 |
| `lowBalanceThreshold` | 数字，默认 `10` | 余额低于该值时变色；`0` 关闭 |
| `lowBalanceStyle` | `warn`（默认）/ `danger` | `warn` 琥珀、`danger` 红色 |

三个 `show` 开关全关时会自动保留余额，避免出现空控件。改完配置刷新页面（`Ctrl+Shift+R`）即可生效。

### 在设置里改

打开 Harness 的**设置 → 余额显示**，可以直接切换位置、各段显示、小数样式、低余额阈值与颜色，点保存立即生效，不需要改 YAML、也不用重启。

- 设置页写入的是**用户覆盖**，保存在 `~/.dsh/plugin-data/dsh-caption-balance/settings.json`，优先于 profile 里的默认值
- 想回到默认值：把各项改回原值保存，或删除上面那个文件

## 工作原理

- 宿主半边在 Harness 的 web server 上提供精确路由 `GET /api/dsh-caption-balance/summary`，只接受本机回环、同源、非跨站的请求
- 余额来自 `deepseekAccount.getBalance`（与设置页同一个接口），带超时与缓存
- 用量来自会话日志 `$DSH_HOME/sessions/**/session*.jsonl.zstd`：多帧 Zstandard 容器，按帧边界增量解码，只统计 `assistant/message` 事件里的 `data.usage`；每个会话目录只读取**版本最高的日志文件**，避免迁移后的日志被重复计数
- 客户端半边按 `display.position` 选择渲染目标：桌面端 preload 注入的标题栏菜单（`[data-windows-menu]` 影子根里的 `[role=menubar]`，排在「编辑」之后）、会话标题栏的 utilities 插槽，或侧边栏底部行；标题栏目标复用标题栏自己的按钮样式

## 已知限制

- **标题栏位置仅 Windows 桌面端可用**：macOS 桌面端和 `dsh web` 没有这排菜单，默认的 `auto` 会自动改用会话标题栏；也可以直接设 `position: header` 或 `position: sidebar`
- 花费是**按价目表推算**的参考值，不是账单；官方调价后需要更新 `models`
- 中国法定节假日未建模：节假日按工作日规则计价
- 今日/本月按**宿主本机时区**划分日历日；峰谷按北京时间计算
- 依赖桌面端 preload 的标题栏结构，DSH 大版本升级后可能失效

## 开发

```sh
npm test        # node --test，覆盖计价、日志解码、配置归一化、客户端三种挂载与低余额着色
```

零依赖，无构建步骤：`client.js` 由 DSH 客户端模块加载器直接执行，宿主半边只使用 Node 内置模块。

## License

MIT © 2026 resnowh
