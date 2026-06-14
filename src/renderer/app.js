const state = {
  config: null,
  quotes: new Map(),
  timer: null,
  refreshing: false,
  analysisSymbol: null,
  themeIndex: 0,
  themes: ['', 'theme-international', 'theme-gray', 'theme-office']
};

const appEl = document.getElementById('app');
const statusText = document.getElementById('statusText');
const quoteRows = document.getElementById('quoteRows');
const symbolInput = document.getElementById('symbolInput');
const opacityText = document.getElementById('opacityText');
const analysisModal = document.getElementById('analysisModal');
const analysisSubtitle = document.getElementById('analysisSubtitle');
const analysisContent = document.getElementById('analysisContent');

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

function formatRawNumber(value) {
  if (value === undefined || value === null || value === '' || Number(value) === 0) return '--';
  return String(value);
}

function trendClass(value) {
  const number = Number(value);
  if (number > 0) return 'up';
  if (number < 0) return 'down';
  return 'flat';
}

function scoreClass(score) {
  const number = Number(score);
  if (!Number.isFinite(number)) return 'flat';
  if (number >= 60) return 'score-good';
  if (number >= 45) return 'score-watch';
  return 'score-risk';
}

function render() {
  const rows = state.config.watchlist.map(item => {
    const quote = state.quotes.get(item.symbol) || {};
    const name = item.alias || quote.name || item.name || item.symbol;
    const price = quote.price || 0;
    const changeClass = trendClass(quote.change);
    return `
      <tr>
        <td class="name" title="${escapeHtml(name)}">${escapeHtml(name)}</td>
        <td>${item.symbol.replace(/^(sh|sz|bj)/, '')}</td>
        <td class="${changeClass}">${formatRawNumber(quote.priceText ?? price)}</td>
        <td class="${changeClass}">${formatNumber(quote.change)}</td>
        <td class="${changeClass}">${Number.isFinite(Number(quote.changePercent)) ? Number(quote.changePercent).toFixed(2) + '%' : '--'}</td>
        <td class="${scoreClass(quote.investmentScore)}">${quote.investmentScoreText || '--'}</td>
        <td><button class="analysis-btn" data-symbol="${item.symbol}" title="查看分析">分析</button></td>
        <td>${quote.updatedAt || '--'}</td>
        <td><button class="remove" data-symbol="${item.symbol}" title="删除">×</button></td>
      </tr>
    `;
  }).join('');
  quoteRows.innerHTML = rows || '<tr><td colspan="9" class="flat">暂无自选股，输入代码后添加。</td></tr>';
  appEl.classList.toggle('privacy', Boolean(state.config.privacy.hidePnL || state.config.privacy.hidePosition));
  appEl.classList.toggle('minimal', Boolean(state.config.privacy.minimalMode));
  opacityText.textContent = `透明度 ${Math.round(state.config.window.opacity * 100)}%`;
  applyMinimalLayout();
}

function applyMinimalLayout() {
  window.yinpan.setMinimalLayout({
    enabled: Boolean(state.config.privacy.minimalMode),
    rowCount: state.config.watchlist.length || 1
  });
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
    if (state.analysisSymbol && !analysisModal.hidden) {
      showAnalysis(state.analysisSymbol);
    }
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
    name: symbol
  });
  symbolInput.value = '';
  await saveConfig();
  render();
  refreshQuotes(true);
}

async function showAnalysis(symbol) {
  state.analysisSymbol = symbol;
  const quote = state.quotes.get(symbol) || {};
  const item = state.config.watchlist.find(stock => stock.symbol === symbol) || {};
  const name = item.alias || quote.name || item.name || symbol;
  analysisSubtitle.textContent = `${name} ${symbol.replace(/^(sh|sz|bj)/, '')}`;
  analysisContent.innerHTML = '<p class="flat">正在读取最近一次评分原因...</p>';
  analysisModal.hidden = false;

  try {
    const analysis = await window.yinpan.getAnalysis(symbol);
    analysisContent.innerHTML = renderAnalysis(analysis);
    analysisSubtitle.textContent = `${analysis.name || name} ${(analysis.code || symbol.replace(/^(sh|sz|bj)/, ''))}`;
  } catch (error) {
    analysisContent.innerHTML = `<p class="score-risk">分析读取失败：${escapeHtml(error.message || String(error))}</p>`;
  }
}

function closeAnalysis() {
  state.analysisSymbol = null;
  analysisModal.hidden = true;
}

function renderAnalysis(analysis) {
  const quote = analysis.quote || {};
  return `
    <h3>结论</h3>
    <p><strong>${escapeHtml(analysis.title || '暂无分析结论')}</strong></p>
    <p><strong>观点：</strong>${escapeHtml(analysis.stance || analysis.conclusion || '--')}</p>
    <p><strong>置信度：</strong>${escapeHtml(analysis.confidence || '--')}</p>
    <p><strong>更新时间：</strong>${escapeHtml(analysis.generatedAt || '--')}，行情时间：${escapeHtml(analysis.quoteTime || '--')}</p>
    <p>${escapeHtml(analysis.conclusion || '')}</p>

    <h3>关键行情</h3>
    <p>现价：${escapeHtml(quote.price || '--')}，涨跌：${escapeHtml(quote.change || '--')}，涨幅：${escapeHtml(quote.changePercent || '--')}</p>
    <p>昨收：${escapeHtml(quote.previousClose || '--')}，开盘：${escapeHtml(quote.open || '--')}，最高：${escapeHtml(quote.high || '--')}，最低：${escapeHtml(quote.low || '--')}</p>
    <p>成交额：${escapeHtml(quote.amount || '--')}，成交量：${escapeHtml(quote.volume || '--')}</p>

    <h3>关键依据</h3>
    ${renderList(analysis.reasons)}

    <h3>评分拆解</h3>
    ${renderBreakdown(analysis.breakdown)}

    <h3>后续监控</h3>
    ${renderList(analysis.monitors)}
  `;
}

function renderList(items) {
  if (!Array.isArray(items) || items.length === 0) return '<p class="flat">暂无。</p>';
  return items.map(item => `<p>${escapeHtml(item)}</p>`).join('');
}

function renderBreakdown(items) {
  if (!Array.isArray(items) || items.length === 0) return '<p class="flat">暂无。</p>';
  return items.map(item => `
    <p><strong>${escapeHtml(item.label || '--')}：${escapeHtml(item.value || '--')}</strong><br>${escapeHtml(item.detail || '')}</p>
  `).join('');
}

async function removeStock(symbol) {
  state.config.watchlist = state.config.watchlist.filter(item => item.symbol !== symbol);
  state.quotes.delete(symbol);
  if (state.analysisSymbol === symbol) closeAnalysis();
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
  document.getElementById('minimalBtn').addEventListener('click', toggleMinimal);
  document.getElementById('hideBtn').addEventListener('click', () => window.yinpan.hideWindow());
  document.getElementById('closeBtn').addEventListener('click', () => window.yinpan.closeApp());
  document.getElementById('analysisCloseBtn').addEventListener('click', closeAnalysis);
  analysisModal.addEventListener('click', event => {
    if (event.target === analysisModal) closeAnalysis();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !analysisModal.hidden) closeAnalysis();
  });
  symbolInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') addStock();
  });
  quoteRows.addEventListener('click', event => {
    const removeButton = event.target.closest('.remove');
    if (removeButton) removeStock(removeButton.dataset.symbol);

    const analysisButton = event.target.closest('.analysis-btn');
    if (analysisButton) showAnalysis(analysisButton.dataset.symbol);
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
