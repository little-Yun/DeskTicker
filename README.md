# 隐盘 DeskTicker

一个面向中国大陆市场的 Windows 轻量盯盘小工具。它参考 Shadowin 的“透明置顶小窗 + 全局快捷键”思路，实现 A 股/指数自选行情、每 60 秒刷新、颜色主题切换和一键隐藏。

## 功能

- Windows Electron 透明置顶小窗。
- 中国大陆股票、指数、ETF 等自选列表。
- 默认每 60 秒刷新一次行情。
- 添加股票代码，例如 `600519`、`000001`、`sh600519`、`sz000001`。
- 本地保存自选股、成本、持仓、窗口位置、透明度和隐私模式。
- 支持成本、持仓、浮动盈亏展示。
- 支持颜色主题、隐私隐藏、极简模式。
- 支持全局快捷键。

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl + ~` | 显示 / 隐藏窗口 |
| `Ctrl + [` | 降低透明度 |
| `Ctrl + ]` | 提高透明度 |
| `Ctrl + Alt + C` | 切换颜色主题 |
| `Ctrl + Alt + H` | 隐藏持仓 / 盈亏 |
| `Ctrl + Alt + N` | 极简模式 / 普通模式|
| `Ctrl + Alt + Left` | 贴到屏幕左下 |
| `Ctrl + Alt + Right` | 贴到屏幕右下 |
| `Ctrl + Alt + Q` | 退出 |

## 开发

```bash
npm install
npm start
```

如果 Electron 二进制下载较慢，可以使用镜像：

```bash
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm install
```

## 打包 Windows

```bash
npm run package:win
```

打包后运行：

```text
dist/YinPan-win32-x64/YinPan.exe
```

## 说明

- 行情数据使用腾讯公开行情文本接口封装。
- 本工具只做行情展示和个人持仓记录，不提供交易、荐股或收益承诺。
- 如果行情接口临时不可用，界面会保留上一笔数据并显示“行情延迟”。

