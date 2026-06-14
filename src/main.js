const { app, BrowserWindow, globalShortcut, ipcMain, screen, shell } = require('electron');
const fs = require('fs');
const https = require('https');
const path = require('path');
const log = require('electron-log');

const CONFIG_FILE = 'config.json';
const DEFAULT_CONFIG = {
  refreshIntervalMs: 60000,
  watchlist: [
    { symbol: 'sh000001', name: '上证指数' },
    { symbol: 'sz399001', name: '深证成指' },
    { symbol: 'sz399006', name: '创业板指' },
    { symbol: 'sh000688', name: '科创50' }
  ],
  window: {
    width: 860,
    height: 300,
    x: undefined,
    y: undefined,
    opacity: 0.86,
    alwaysOnTop: true
  },
  theme: {
    mode: 'classic-cn',
    upColor: '#ff4d4f',
    downColor: '#1fbe72',
    backgroundColor: '#10141c',
    textColor: '#dce4f2'
  },
  privacy: {
    hidePosition: false,
    hidePnL: false,
    minimalMode: false
  },
  hotkeys: {
    toggleVisible: 'Control+`',
    opacityDown: 'Control+[',
    opacityUp: 'Control+]',
    cycleTheme: 'Control+Alt+C',
    privacyMode: 'Control+Alt+H',
    minimalMode: 'Control+Alt+M',
    dockLeft: 'Control+Alt+Left',
    dockRight: 'Control+Alt+Right',
    quit: 'Control+Alt+Q'
  }
};

let mainWindow;
let config;

function configPath() {
  return path.join(app.getPath('userData'), CONFIG_FILE);
}

function readConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return mergeConfig(DEFAULT_CONFIG, saved);
  } catch (error) {
    return { ...DEFAULT_CONFIG };
  }
}

function mergeConfig(base, override) {
  const output = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key]) {
      output[key] = mergeConfig(base[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function saveConfig() {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8');
  } catch (error) {
    log.error(error);
  }
}

function createWindow() {
  const display = screen.getPrimaryDisplay();
  const width = config.window.width;
  const height = config.window.height;
  const x = Number.isFinite(config.window.x) ? config.window.x : display.workArea.x + display.workArea.width - width - 24;
  const y = Number.isFinite(config.window.y) ? config.window.y : display.workArea.y + display.workArea.height - height - 24;

  mainWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: 520,
    minHeight: 180,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: config.window.alwaysOnTop,
    skipTaskbar: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    title: '隐盘',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setOpacity(config.window.opacity);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('resize', persistWindowBounds);
  mainWindow.on('move', persistWindowBounds);
}

function persistWindowBounds() {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  config.window.width = bounds.width;
  config.window.height = bounds.height;
  config.window.x = bounds.x;
  config.window.y = bounds.y;
  saveConfig();
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const keys = config.hotkeys;

  register(keys.toggleVisible, () => {
    if (!mainWindow) return;
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
  register(keys.opacityDown, () => changeOpacity(-0.08));
  register(keys.opacityUp, () => changeOpacity(0.08));
  register(keys.cycleTheme, () => sendToRenderer('theme:cycle'));
  register(keys.privacyMode, () => sendToRenderer('privacy:toggle'));
  register(keys.minimalMode, () => sendToRenderer('minimal:toggle'));
  register(keys.dockLeft, () => dockWindow('left'));
  register(keys.dockRight, () => dockWindow('right'));
  register(keys.quit, () => app.quit());
}

function register(accelerator, callback) {
  if (!accelerator) return;
  const ok = globalShortcut.register(accelerator, callback);
  if (!ok) log.warn(`Failed to register hotkey: ${accelerator}`);
}

function changeOpacity(delta) {
  if (!mainWindow) return;
  const opacity = Math.max(0.2, Math.min(0.95, Number((mainWindow.getOpacity() + delta).toFixed(2))));
  mainWindow.setOpacity(opacity);
  config.window.opacity = opacity;
  saveConfig();
  sendToRenderer('window:opacity', opacity);
}

function dockWindow(side) {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const x = side === 'left' ? display.workArea.x : display.workArea.x + display.workArea.width - bounds.width;
  const y = display.workArea.y + display.workArea.height - bounds.height;
  mainWindow.setBounds({ ...bounds, x, y });
  persistWindowBounds();
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function normalizeSymbol(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (/^(sh|sz|bj)\d{6}$/.test(raw)) return raw;
  if (!/^\d{6}$/.test(raw)) return null;
  if (raw.startsWith('6') || raw.startsWith('5') || raw.startsWith('9')) return `sh${raw}`;
  if (raw.startsWith('0') || raw.startsWith('1') || raw.startsWith('2') || raw.startsWith('3')) return `sz${raw}`;
  if (raw.startsWith('4') || raw.startsWith('8')) return `bj${raw}`;
  return null;
}

function fetchQuotes(symbols) {
  const validSymbols = [...new Set(symbols.map(normalizeSymbol).filter(Boolean))];
  if (validSymbols.length === 0) return Promise.resolve([]);

  const url = `https://web.sqt.gtimg.cn/utf8/q=${validSymbols.join(',')}&r=${Date.now()}`;
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'Referer': 'https://gu.qq.com/',
        'User-Agent': 'Mozilla/5.0 YinPan/0.1'
      }
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
      });
      response.on('end', () => {
        resolve(parseTencentQuotes(body));
      });
    }).on('error', reject);
  });
}

function parseTencentQuotes(body) {
  const quotes = [];
  const lines = String(body || '').split(/;\s*/);
  for (const line of lines) {
    const match = line.match(/v_([a-z]{2}\d{6})="([^"]*)"/i);
    if (!match) continue;
    const symbol = match[1].toLowerCase();
    const fields = match[2].split('~');
    const name = fields[1] || symbol;
    const priceText = fields[3] || '';
    const price = toNumber(fields[3]);
    const previousClose = toNumber(fields[4]);
    const open = toNumber(fields[5]);
    const volume = toNumber(fields[6]);
    const amount = toNumber(fields[37] || fields[36]);
    const high = toNumber(fields[33]);
    const low = toNumber(fields[34]);
    const change = price && previousClose ? price - previousClose : toNumber(fields[31]);
    const changePercent = price && previousClose ? change / previousClose * 100 : toNumber(fields[32]);
    const updatedAt = formatQuoteTime(fields[30]);
    quotes.push({
      symbol,
      name,
      priceText,
      price,
      previousClose,
      open,
      high,
      low,
      change,
      changePercent,
      amount,
      volume,
      updatedAt,
      stale: false
    });
  }
  return quotes;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatQuoteTime(value) {
  const text = String(value || '');
  if (/^\d{14}$/.test(text)) {
    return `${text.slice(8, 10)}:${text.slice(10, 12)}:${text.slice(12, 14)}`;
  }
  return text || '--';
}

app.whenReady().then(() => {
  config = readConfig();
  createWindow();
  registerHotkeys();

  ipcMain.handle('config:get', () => config);
  ipcMain.handle('config:save', (_event, nextConfig) => {
    config = mergeConfig(config, nextConfig);
    if (mainWindow) {
      mainWindow.setOpacity(config.window.opacity);
      mainWindow.setAlwaysOnTop(config.window.alwaysOnTop);
    }
    saveConfig();
    registerHotkeys();
    return config;
  });
  ipcMain.handle('quotes:get', async (_event, symbols) => fetchQuotes(symbols));
  ipcMain.handle('window:minimize-hide', () => {
    if (mainWindow) mainWindow.hide();
  });
  ipcMain.handle('window:close', () => app.quit());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.focus();
  });
}
