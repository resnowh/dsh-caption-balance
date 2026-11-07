# dsh-caption-balance

![test](https://github.com/resnowh/dsh-caption-balance/actions/workflows/test.yml/badge.svg)

[English](README.en.md) | 中文

在 DeepSeek Harness **桌面端标题栏**（`应用 / 编辑` 菜单右边）显示一行实时读数：

```
应用  编辑  ¥61.05 · ¥4.04  谷
```

![标题栏效果](docs/titlebar.png)

[![dshbase 已验证](https://dshbase.com/badges/dsh-caption-balance.svg)](https://dshbase.com/zh/plugins/dsh-caption-balance/)
[![dshfind](https://dshfind.com/api/badge/resnowh/dsh-caption-balance?lang=zh)](https://dshfind.com/zh/plugins/resnowh/dsh-caption-balance)

- **账户余额** —— 通过官方账号服务读取，和「设置 → 账号与余额」同源，插件本身不接触任何凭证
- **今日花费** —— 由本机会话日志统计出的 token 用量按价目表折算，附当前时段
- **峰 / 谷** —— 单字提示当前计价时段：`峰` 为北京时间工作日 9:00–12:00、14:00–18:00（单价 ×2），`谷` 为半价时段，高峰时该字变为琥珀色
- **悬停看明细** —— 余额、赠送余额、今日/本月 token 与花费、当前时段、更新时间
- **点击立即刷新**，默认每 30 秒自动刷新
- 金额的小数部分自动小一号，数字等宽，刷新时不跳动

## 安装

要求：**DeepSeek Harness 桌面端（Windows）**，版本 `0.2.2-rc.1` 及以上。

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
    aliases:
      deepseek-v4-flash: deepseek-flash
    models:
      deepseek-flash:
        cacheHit: 0.02   # 元 / 百万 tokens（空闲价）
        cacheMiss: 1
        output: 4
```

价格单位是「元 / 百万 tokens」，填**空闲时段**单价，高峰时段按 `peakMultiplier` 倍计算。未配置单价的模型仍统计 token，但不计入花费，并在明细里标注。

## 工作原理

- 宿主半边在 Harness 的 web server 上提供精确路由 `GET /api/dsh-caption-balance/summary`，只接受本机回环、同源、非跨站的请求
- 余额来自 `deepseekAccount.getBalance`（与设置页同一个接口），带超时与缓存
- 用量来自会话日志 `$DSH_HOME/sessions/**/session*.jsonl.zstd`：多帧 Zstandard 容器，按帧边界增量解码，只统计 `assistant/message` 事件里的 `data.usage`；每个会话目录只读取**版本最高的日志文件**，避免迁移后的日志被重复计数
- 客户端半边把按钮插入桌面端 preload 注入的标题栏菜单（`[data-windows-menu]` 的影子根里的 `[role=menubar]`），排在「编辑」之后，并复用标题栏自己的按钮样式

## 已知限制

- **仅 Windows 桌面端可见**：`dsh web`、macOS 没有这个标题栏菜单，宿主接口照常工作但界面不显示
- 花费是**按价目表推算**的参考值，不是账单；官方调价后需要更新 `models`
- 中国法定节假日未建模：节假日按工作日规则计价
- 今日/本月按**宿主本机时区**划分日历日；峰谷按北京时间计算
- 依赖桌面端 preload 的标题栏结构，DSH 大版本升级后可能失效

## 开发

```sh
npm test        # node --test，覆盖计价、日志解码、配置归一化
```

零依赖，无构建步骤：`client.js` 由 DSH 客户端模块加载器直接执行，宿主半边只使用 Node 内置模块。

## License

MIT © 2026 resnowh
