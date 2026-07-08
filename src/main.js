const { app, BrowserWindow, globalShortcut, ipcMain, screen, shell } = require('electron');
const fs = require('fs');
const https = require('https');
const path = require('path');
const log = require('electron-log');

const CONFIG_FILE = 'config.json';
const NORMAL_MIN_WIDTH = 520;
const NORMAL_MIN_HEIGHT = 180;
const DEFAULT_CONFIG = {
  refreshIntervalMs: 60000,
  watchlist: [
    { symbol: 'sh000001', name: '上证指数' },
    { symbol: 'sz399001', name: '深证成指' },
    { symbol: 'sz399006', name: '创业板指' },
    { symbol: 'sh000688', name: '科创50' }
  ],
  window: {
    width: 760,
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
    minimalMode: 'Control+Alt+N',
    dockLeft: 'Control+Alt+Left',
    dockRight: 'Control+Alt+Right',
    quit: 'Control+Alt+Q'
  }
};
const REMOTE_API_TIMEOUT_MS = 10000;

let mainWindow;
let config;
let normalWindowBounds;
let minimalLayoutApplied = false;
let suppressBoundsPersist = false;

function runtimeDirPath() {
  return app.isPackaged ? path.dirname(process.execPath) : app.getAppPath();
}

function logDirPath() {
  return path.join(runtimeDirPath(), 'log');
}

function appLogPath() {
  return path.join(logDirPath(), 'app.log');
}

function configureLogging() {
  try {
    fs.mkdirSync(logDirPath(), { recursive: true });
    log.transports.file.resolvePath = appLogPath;
    log.transports.file.level = 'info';
    log.catchErrors({ showDialog: false });
    log.info(`Log file initialized: ${appLogPath()}`);
  } catch (error) {
    console.error('Failed to initialize log file', error);
  }
}

function configPath() {
  return path.join(app.getPath('userData'), CONFIG_FILE);
}

function reasonDirPath() {
  const devRuntimeDir = path.join(app.getAppPath(), 'YinPan-win32-x64');
  const runtimeDir = app.isPackaged ? path.dirname(process.execPath) : devRuntimeDir;
  return path.join(runtimeDir, 'reason');
}

function reasonFilePath(symbol) {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return null;
  return path.join(reasonDirPath(), `${normalized}.json`);
}

function readConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return migrateConfig(mergeConfig(DEFAULT_CONFIG, saved));
  } catch (error) {
    return migrateConfig({ ...DEFAULT_CONFIG });
  }
}

function migrateConfig(nextConfig) {
  if (nextConfig.hotkeys && nextConfig.hotkeys.minimalMode === 'Control+Alt+M') {
    nextConfig.hotkeys.minimalMode = DEFAULT_CONFIG.hotkeys.minimalMode;
  }
  return nextConfig;
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
  if (!mainWindow || suppressBoundsPersist || config.privacy.minimalMode) return;
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
  register(keys.minimalMode, toggleMinimalMode);
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

function applyMinimalLayout(enabled, rowCount) {
  if (!mainWindow) return;
  if (!enabled && !minimalLayoutApplied) {
    mainWindow.setMinimumSize(NORMAL_MIN_WIDTH, NORMAL_MIN_HEIGHT);
    return;
  }

  const bounds = mainWindow.getBounds();
  suppressBoundsPersist = true;
  try {
    if (enabled) {
      if (!normalWindowBounds && isNormalWindowBounds(bounds)) {
        normalWindowBounds = bounds;
      }
      const width = 304;
      const height = Math.max(32, Math.min(800, Number(rowCount || 1) * 28 + 4));
      mainWindow.setMinimumSize(260, 30);
      if (bounds.width !== width || bounds.height !== height) {
        mainWindow.setBounds({
          x: bounds.x,
          y: bounds.y,
          width,
          height
        });
      }
      minimalLayoutApplied = true;
    } else {
      const restoreBounds = getNormalRestoreBounds(bounds);
      mainWindow.setMinimumSize(NORMAL_MIN_WIDTH, NORMAL_MIN_HEIGHT);
      mainWindow.setBounds(restoreBounds);
      normalWindowBounds = null;
      minimalLayoutApplied = false;
      if (config && config.window) {
        config.window.width = restoreBounds.width;
        config.window.height = restoreBounds.height;
        config.window.x = restoreBounds.x;
        config.window.y = restoreBounds.y;
        saveConfig();
      }
    }
  } finally {
    setTimeout(() => {
      suppressBoundsPersist = false;
    }, 100);
  }
}

function isNormalWindowBounds(bounds) {
  return Boolean(
    bounds &&
    Number(bounds.width) >= NORMAL_MIN_WIDTH &&
    Number(bounds.height) >= NORMAL_MIN_HEIGHT
  );
}

function getNormalRestoreBounds(currentBounds) {
  if (isNormalWindowBounds(normalWindowBounds)) {
    return normalWindowBounds;
  }

  const configuredBounds = {
    x: Number.isFinite(config.window.x) ? config.window.x : currentBounds.x,
    y: Number.isFinite(config.window.y) ? config.window.y : currentBounds.y,
    width: Number(config.window.width),
    height: Number(config.window.height)
  };
  if (isNormalWindowBounds(configuredBounds)) {
    return configuredBounds;
  }

  return {
    x: currentBounds.x,
    y: currentBounds.y,
    width: Math.max(NORMAL_MIN_WIDTH, DEFAULT_CONFIG.window.width),
    height: Math.max(NORMAL_MIN_HEIGHT, DEFAULT_CONFIG.window.height)
  };
}

function toggleMinimalMode() {
  if (!config) return;
  config.privacy.minimalMode = !config.privacy.minimalMode;
  saveConfig();
  applyMinimalLayout(config.privacy.minimalMode, config.watchlist.length || 1);
  sendToRenderer('config:updated', config);
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

function serializeError(error) {
  if (!error) return {};
  return {
    name: error.name,
    message: error.message,
    code: error.code,
    stack: error.stack
  };
}

function bodyPreview(body) {
  return String(body || '').slice(0, 1000);
}

function logRemoteApiError(context, error) {
  log.error(JSON.stringify({
    type: 'remote-api-error',
    time: new Date().toISOString(),
    ...context,
    error: serializeError(error)
  }));
}

function logRemoteApiWarning(context) {
  log.warn(JSON.stringify({
    type: 'remote-api-warning',
    time: new Date().toISOString(),
    ...context
  }));
}

function fetchRemoteText(url, context) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false;

    function finishWithError(error, extra = {}) {
      if (settled) return;
      settled = true;
      logRemoteApiError({
        ...context,
        url,
        durationMs: Date.now() - startedAt,
        ...extra
      }, error);
      reject(error);
    }

    const request = https.get(url, {
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
        if (settled) return;
        const statusCode = response.statusCode || 0;
        const meta = {
          ...context,
          url,
          statusCode,
          durationMs: Date.now() - startedAt
        };

        if (statusCode < 200 || statusCode >= 300) {
          finishWithError(new Error(`Remote API returned HTTP ${statusCode}`), {
            statusCode,
            bodyPreview: bodyPreview(body)
          });
          return;
        }

        settled = true;
        resolve({ body, meta });
      });
      response.on('error', finishWithError);
    });

    request.setTimeout(REMOTE_API_TIMEOUT_MS, () => {
      request.destroy(new Error(`Remote API request timed out after ${REMOTE_API_TIMEOUT_MS}ms`));
    });
    request.on('error', finishWithError);
  });
}

async function fetchQuotes(symbols) {
  const validSymbols = [...new Set(symbols.map(normalizeSymbol).filter(Boolean))];
  if (validSymbols.length === 0) return Promise.resolve([]);

  const url = `https://web.sqt.gtimg.cn/utf8/q=${validSymbols.join(',')}&r=${Date.now()}`;
  const { body, meta } = await fetchRemoteText(url, {
    endpoint: 'quotes',
    symbols: validSymbols
  });

  try {
    const quotes = parseTencentQuotes(body);
    if (quotes.length === 0) {
      throw new Error('Remote API returned no quote data');
    }

    const returnedSymbols = new Set(quotes.map(quote => quote.symbol));
    const missingSymbols = validSymbols.filter(symbol => !returnedSymbols.has(symbol));
    if (missingSymbols.length > 0) {
      logRemoteApiWarning({
        ...meta,
        reason: 'partial-quote-response',
        symbols: validSymbols,
        missingSymbols,
        bodyPreview: bodyPreview(body)
      });
    }

    return quotes;
  } catch (error) {
    logRemoteApiError({
      ...meta,
      symbols: validSymbols,
      bodyPreview: bodyPreview(body)
    }, error);
    throw error;
  }
}

async function fetchStockSuggestions(keyword) {
  const query = String(keyword || '').trim();
  if (!query) return Promise.resolve([]);

  const url = `https://smartbox.gtimg.cn/s3/?q=${encodeURIComponent(query)}&t=all&r=${Date.now()}`;
  const { body, meta } = await fetchRemoteText(url, {
    endpoint: 'suggestions',
    keyword: query
  });

  try {
    return parseStockSuggestions(body);
  } catch (error) {
    logRemoteApiError({
      ...meta,
      keyword: query,
      bodyPreview: bodyPreview(body)
    }, error);
    throw error;
  }
}

function parseStockSuggestions(body) {
  const match = String(body || '').match(/v_hint="([^"]*)"/);
  if (!match) return [];

  const decoded = decodeTencentEscapes(match[1]);
  return decoded.split('^')
    .map(item => {
      const fields = item.split('~');
      const market = String(fields[0] || '').toLowerCase();
      const code = fields[1] || '';
      const name = fields[2] || '';
      const type = fields[4] || '';
      const symbol = `${market}${code}`;
      return { market, code, name, type, symbol };
    })
    .filter(item => /^(sh|sz|bj)\d{6}$/.test(item.symbol))
    .slice(0, 8);
}

function decodeTencentEscapes(value) {
  try {
    return JSON.parse(`"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\\\\u/g, '\\u')}"`);
  } catch (error) {
    return String(value).replace(/\\u([\da-f]{4})/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
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
    const changeText = fields[31] || formatMetric(change, Math.max(decimalPlaces(fields[3]), decimalPlaces(fields[4]), 2));
    const changePercent = price && previousClose ? change / previousClose * 100 : toNumber(fields[32]);
    const updatedAt = formatQuoteTime(fields[30]);
    const investmentScore = calculateInvestmentScore({
      price,
      previousClose,
      open,
      high,
      low,
      changePercent,
      amount,
      volume
    });
    const quote = {
      symbol,
      name,
      priceText,
      price,
      previousClose,
      open,
      high,
      low,
      change,
      changeText,
      changePercent,
      amount,
      volume,
      investmentScore,
      investmentScoreText: Number.isFinite(investmentScore) ? String(investmentScore) : '--',
      updatedAt,
      stale: false
    };
    saveAnalysisReason(quote);
    quotes.push(quote);
  }
  return quotes;
}

function calculateInvestmentScore(quote) {
  const price = Number(quote.price);
  const previousClose = Number(quote.previousClose);
  const open = Number(quote.open);
  const high = Number(quote.high);
  const low = Number(quote.low);
  const changePercent = Number(quote.changePercent);
  const amount = Number(quote.amount);
  const volume = Number(quote.volume);

  if (!price || !previousClose) return null;

  let score = 50;
  score += clamp(changePercent * 2.2, -22, 18);

  if (open > 0) {
    const openMove = (price - open) / open * 100;
    score += clamp(openMove * 1.8, -9, 9);
  }

  if (high > low) {
    const rangePosition = (price - low) / (high - low);
    score += clamp((rangePosition - 0.5) * 14, -7, 7);
  }

  if (high > 0 && low > 0 && previousClose > 0) {
    const intradayRange = (high - low) / previousClose * 100;
    if (intradayRange > 7 && changePercent < 0) score -= 5;
    if (intradayRange > 7 && changePercent > 0) score += 3;
  }

  if (amount >= 100000000 || volume >= 1000000) {
    score += changePercent >= 0 ? 3 : -3;
  }

  return Math.round(clamp(score, 0, 100));
}

function clamp(value, min, max) {
  if (!Number.isFinite(Number(value))) return 0;
  return Math.max(min, Math.min(max, Number(value)));
}

function saveAnalysisReason(quote) {
  const filePath = reasonFilePath(quote.symbol);
  if (!filePath) return;

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(buildAnalysisReason(quote), null, 2), 'utf8');
  } catch (error) {
    log.warn(`Failed to save analysis reason for ${quote.symbol}: ${error.message}`);
  }
}

function readAnalysisReason(symbol) {
  const filePath = reasonFilePath(symbol);
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      symbol: normalizeSymbol(symbol) || String(symbol || ''),
      title: '暂无分析结论',
      generatedAt: '',
      conclusion: '还没有保存过该股票的评分原因。等待下一次行情刷新后会自动生成。',
      reasons: [],
      breakdown: [],
      monitors: []
    };
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return {
      symbol: normalizeSymbol(symbol) || String(symbol || ''),
      title: '分析读取失败',
      generatedAt: '',
      conclusion: `评分原因文件无法读取：${error.message}`,
      reasons: [],
      breakdown: [],
      monitors: []
    };
  }
}

function buildAnalysisReason(quote) {
  const score = Number(quote.investmentScore);
  const price = Number(quote.price);
  const previousClose = Number(quote.previousClose);
  const open = Number(quote.open);
  const high = Number(quote.high);
  const low = Number(quote.low);
  const change = Number(quote.change);
  const changePercent = Number(quote.changePercent);
  const amount = Number(quote.amount);
  const volume = Number(quote.volume);
  const openMove = open > 0 ? (price - open) / open * 100 : 0;
  const rangePosition = high > low ? (price - low) / (high - low) : null;
  const stance = scoreToStance(score);
  const confidence = price && previousClose && high && low ? '中等' : '偏低';
  const generatedAt = new Date().toLocaleString('zh-CN', { hour12: false });

  return {
    symbol: quote.symbol,
    code: quote.symbol.replace(/^(sh|sz|bj)/, ''),
    name: quote.name,
    score,
    stance,
    confidence,
    generatedAt,
    quoteTime: quote.updatedAt,
    title: `${quote.name} ${quote.symbol.toUpperCase()}：${Number.isFinite(score) ? score : '--'}/100`,
    conclusion: `${stance}。该结论基于最近一次行情刷新生成，主要反映分钟级交易面强弱，不构成个性化投资建议。`,
    quote: {
      price: formatMetric(price, 2),
      change: formatMetric(change, 2),
      changePercent: `${formatMetric(changePercent, 2)}%`,
      previousClose: formatMetric(previousClose, 2),
      open: formatMetric(open, 2),
      high: formatMetric(high, 2),
      low: formatMetric(low, 2),
      amount: formatAmount(amount),
      volume: formatVolume(volume)
    },
    reasons: [
      `交易面：现价 ${formatMetric(price, 2)}，涨跌 ${formatMetric(change, 2)}，涨幅 ${formatMetric(changePercent, 2)}%。`,
      open > 0
        ? `日内表现：相对开盘价 ${formatSigned(openMove)}%，${openMove >= 0 ? '盘中承接偏积极' : '盘中承接偏弱'}。`
        : '日内表现：开盘价数据不足，暂不纳入判断。',
      rangePosition === null
        ? '区间位置：日内高低点数据不足，暂不纳入判断。'
        : `区间位置：价格位于日内区间约 ${(rangePosition * 100).toFixed(0)}% 分位，${rangePosition >= 0.66 ? '接近高位' : rangePosition <= 0.33 ? '接近低位' : '处于中部'}。`,
      `成交活跃度：成交额约 ${formatAmount(amount)}，成交量约 ${formatVolume(volume)}，${amount >= 100000000 || volume >= 1000000 ? '活跃度较高' : '活跃度一般'}。`
    ],
    breakdown: [
      {
        label: '交易与动量',
        value: `${score}/100`,
        detail: `涨幅、开盘后表现、日内区间位置和成交活跃度共同决定本次评分。`
      },
      {
        label: '基本面与估值',
        value: '未接入实时基本面',
        detail: '当前桌面小窗只使用分钟级行情接口；基本面、公告和舆情需要接入额外数据源后再纳入自动更新。'
      },
      {
        label: '风险与不确定性',
        value: confidence,
        detail: '评分会随每分钟行情刷新变化，短线波动较大时需要降低结论权重。'
      }
    ],
    monitors: [
      `上调信号：涨幅扩大、价格靠近日内高位且成交继续放大。`,
      `下调信号：价格跌回日内低位、涨幅转弱或放量下跌。`,
      `复核节奏：每 ${Math.round((config && config.refreshIntervalMs ? config.refreshIntervalMs : 60000) / 1000)} 秒随行情刷新自动更新一次评分原因。`
    ]
  };
}

function scoreToStance(score) {
  if (!Number.isFinite(Number(score))) return '观望，数据不足';
  if (score >= 75) return '偏强，可继续关注';
  if (score >= 60) return '中性偏强，可谨慎持有';
  if (score >= 45) return '中性观望，等待确认';
  if (score >= 30) return '偏弱，谨慎持有或降低仓位';
  return '弱势，优先控制风险';
}

function formatMetric(value, digits = 2) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '--';
}

function decimalPlaces(value) {
  const match = String(value || '').match(/\.(\d+)/);
  return match ? match[1].length : 0;
}

function formatSigned(value) {
  if (!Number.isFinite(Number(value))) return '--';
  const number = Number(value);
  return `${number >= 0 ? '+' : ''}${number.toFixed(2)}`;
}

function formatAmount(value) {
  if (!Number.isFinite(Number(value)) || Number(value) === 0) return '--';
  const number = Number(value);
  if (Math.abs(number) >= 100000000) return `${(number / 100000000).toFixed(2)}亿`;
  if (Math.abs(number) >= 10000) return `${(number / 10000).toFixed(2)}万`;
  return number.toFixed(2);
}

function formatVolume(value) {
  if (!Number.isFinite(Number(value)) || Number(value) === 0) return '--';
  const number = Number(value);
  if (Math.abs(number) >= 100000000) return `${(number / 100000000).toFixed(2)}亿`;
  if (Math.abs(number) >= 10000) return `${(number / 10000).toFixed(2)}万`;
  return String(Math.round(number));
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
  configureLogging();
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
  ipcMain.handle('suggestions:get', async (_event, keyword) => fetchStockSuggestions(keyword));
  ipcMain.handle('analysis:get', (_event, symbol) => readAnalysisReason(symbol));
  ipcMain.handle('window:minimize-hide', () => {
    if (mainWindow) mainWindow.hide();
  });
  ipcMain.handle('window:opacity-adjust', (_event, delta) => {
    changeOpacity(Number(delta));
    return config.window.opacity;
  });
  ipcMain.handle('window:minimal-layout', (_event, payload) => {
    applyMinimalLayout(Boolean(payload && payload.enabled), Number(payload && payload.rowCount));
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
