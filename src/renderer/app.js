const state = {
  config: null,
  quotes: new Map(),
  timer: null,
  refreshing: false,
  themeIndex: 0,
  themes: ['', 'theme-international', 'theme-gray', 'theme-office']
};

const appEl = document.getElementById('app');
const statusText = document.getElementById('statusText');
const quoteRows = document.getElementById('quoteRows');
const symbolInput = document.getElementById('symbolInput');
const costInput = document.getElementById('costInput');
const quantityInput = document.getElementById('quantityInput');
const opacityText = document.getElementById('opacityText');

function normalizeSymbol(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (/^(sh|sz|bj)\d{6}$/.test(raw)) return raw;
  if (!/^\d{6}$/.test(raw)) return null;
  if (raw.startsWith('6') || raw.startsWith('5') || raw.startsWith('9')) return `sh${raw}`;
  if (raw.startsWith('0') || raw.startsWith('1') || raw.startsWith('2') || raw.startsWith('3')) return `sz${raw}`;
  if (raw.startsWith('4') || raw.startsWith('8')) return `bj${raw}`;
  return null;
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(Number(value)) || Number(value) === 0) return '--';
  return Number(value).toFixed(digits);
}

function formatAmount(value) {
  if (!Number.isFinite(Number(value))) return '--';
  const number = Number(value);
  if (Math.abs(number) >= 100000000) return `${(number / 100000000).toFixed(2)}亿`;
  if (Math.abs(number) >= 10000) return `${(number / 10000).toFixed(2)}万`;
  return number.toFixed(2);
}

function trendClass(value) {
  const number = Number(value);
  if (number > 0) return 'up';
  if (number < 0) return 'down';
  return 'flat';
}

function render() {
  const rows = state.config.watchlist.map(item => {
    const quote = state.quotes.get(item.symbol) || {};
    const name = item.alias || quote.name || item.name || item.symbol;
    const price = quote.price || 0;
    const cost = Number(item.cost || 0);
    const quantity = Number(item.quantity || 0);
    const pnl = price && cost && quantity ? (price - cost) * quantity : 0;
    const changeClass = trendClass(quote.change);
    const pnlClass = trendClass(pnl);
    return `
      <tr>
        <td class="name" title="${escapeHtml(name)}">${escapeHtml(name)}</td>
        <td>${item.symbol.replace(/^(sh|sz|bj)/, '')}</td>
        <td class="${changeClass}">${formatNumber(price)}</td>
        <td class="${changeClass}">${formatNumber(quote.change)}</td>
        <td class="${changeClass}">${Number.isFinite(Number(quote.changePercent)) ? Number(quote.changePercent).toFixed(2) + '%' : '--'}</td>
        <td class="optional">${cost ? cost.toFixed(2) : '--'}</td>
        <td class="optional">${quantity || '--'}</td>
        <td class="optional pnl-col ${pnlClass}">${pnl ? formatAmount(pnl) : '--'}</td>
        <td>${quote.updatedAt || '--'}</td>
        <td><button class="remove" data-symbol="${item.symbol}" title="删除">×</button></td>
      </tr>
    `;
  }).join('');
  quoteRows.innerHTML = rows || '<tr><td colspan="10" class="flat">暂无自选股，输入代码后添加。</td></tr>';
  appEl.classList.toggle('privacy', Boolean(state.config.privacy.hidePnL || state.config.privacy.hidePosition));
  appEl.classList.toggle('minimal', Boolean(state.config.privacy.minimalMode));
  opacityText.textContent = `透明度 ${Math.round(state.config.window.opacity * 100)}%`;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

async function refreshQuotes(manual = false) {
  if (state.refreshing) return;
  state.refreshing = true;
  statusText.textContent = manual ? '手动刷新中...' : '刷新中...';
  try {
    const symbols = state.config.watchlist.map(item => item.symbol);
    const quotes = await window.yinpan.getQuotes(symbols);
    for (const quote of quotes) {
      state.quotes.set(quote.symbol, quote);
      const item = state.config.watchlist.find(stock => stock.symbol === quote.symbol);
      if (item && quote.name) item.name = quote.name;
    }
    await saveConfig();
    statusText.textContent = `已刷新 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
  } catch (error) {
    statusText.textContent = '行情延迟，保留旧数据';
  } finally {
    state.refreshing = false;
    render();
  }
}

function scheduleRefresh() {
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(() => refreshQuotes(false), state.config.refreshIntervalMs || 60000);
}

async function saveConfig() {
  state.config = await window.yinpan.saveConfig(state.config);
}

async function addStock() {
  const symbol = normalizeSymbol(symbolInput.value);
  if (!symbol) {
    statusText.textContent = '请输入 6 位代码，例如 600519';
    symbolInput.focus();
    return;
  }
  if (state.config.watchlist.some(item => item.symbol === symbol)) {
    statusText.textContent = `${symbol} 已存在`;
    return;
  }
  state.config.watchlist.push({
    symbol,
    name: symbol,
    cost: Number(costInput.value) || undefined,
    quantity: Number(quantityInput.value) || undefined
  });
  symbolInput.value = '';
  costInput.value = '';
  quantityInput.value = '';
  await saveConfig();
  render();
  refreshQuotes(true);
}

async function removeStock(symbol) {
  state.config.watchlist = state.config.watchlist.filter(item => item.symbol !== symbol);
  state.quotes.delete(symbol);
  await saveConfig();
  render();
}

function cycleTheme() {
  state.themeIndex = (state.themeIndex + 1) % state.themes.length;
  document.body.classList.remove(...state.themes.filter(Boolean));
  const next = state.themes[state.themeIndex];
  if (next) document.body.classList.add(next);
}

async function togglePrivacy() {
  state.config.privacy.hidePnL = !state.config.privacy.hidePnL;
  state.config.privacy.hidePosition = state.config.privacy.hidePnL;
  await saveConfig();
  render();
}

async function toggleMinimal() {
  state.config.privacy.minimalMode = !state.config.privacy.minimalMode;
  await saveConfig();
  render();
}

function bindEvents() {
  document.getElementById('addBtn').addEventListener('click', addStock);
  document.getElementById('refreshBtn').addEventListener('click', () => refreshQuotes(true));
  document.getElementById('themeBtn').addEventListener('click', cycleTheme);
  document.getElementById('privacyBtn').addEventListener('click', togglePrivacy);
  document.getElementById('minimalBtn').addEventListener('click', toggleMinimal);
  document.getElementById('hideBtn').addEventListener('click', () => window.yinpan.hideWindow());
  document.getElementById('closeBtn').addEventListener('click', () => window.yinpan.closeApp());
  symbolInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') addStock();
  });
  quoteRows.addEventListener('click', event => {
    const button = event.target.closest('.remove');
    if (button) removeStock(button.dataset.symbol);
  });

  window.yinpan.onCycleTheme(cycleTheme);
  window.yinpan.onTogglePrivacy(togglePrivacy);
  window.yinpan.onToggleMinimal(toggleMinimal);
  window.yinpan.onOpacity(opacity => {
    state.config.window.opacity = opacity;
    render();
  });
}

async function init() {
  state.config = await window.yinpan.getConfig();
  bindEvents();
  render();
  scheduleRefresh();
  refreshQuotes(true);
}

init();
