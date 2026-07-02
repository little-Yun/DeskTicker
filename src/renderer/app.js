const state = {
  config: null,
  quotes: new Map(),
  timer: null,
  suggestionTimer: null,
  suggestions: [],
  activeSuggestionIndex: -1,
  selectedSuggestion: null,
  rowDrag: null,
  suppressNextRowClick: false,
  refreshing: false,
  analysisSymbol: null,
  themeIndex: 0,
  themes: [
    {
      mode: 'classic-cn',
      className: '',
      colors: {
        upColor: '#ff4d4f',
        downColor: '#1fbe72',
        backgroundColor: '#10141c',
        textColor: '#dce4f2'
      }
    },
    {
      mode: 'international',
      className: 'theme-international',
      colors: {
        upColor: '#1fbe72',
        downColor: '#ff4d4f',
        backgroundColor: '#10141c',
        textColor: '#dce4f2'
      }
    },
    {
      mode: 'gray',
      className: 'theme-gray',
      colors: {
        upColor: '#545b66',
        downColor: '#545b66',
        backgroundColor: '#f5f6f8',
        textColor: '#202631'
      }
    },
    {
      mode: 'office',
      className: 'theme-office',
      colors: {
        upColor: '#d93025',
        downColor: '#188038',
        backgroundColor: '#fafcff',
        textColor: '#1d2430'
      }
    }
  ],
  minimalLayout: {
    enabled: null,
    rowCount: null
  }
};

const appEl = document.getElementById('app');
const statusText = document.getElementById('statusText');
const tableWrap = document.querySelector('.table-wrap');
const quoteRows = document.getElementById('quoteRows');
const symbolInput = document.getElementById('symbolInput');
const suggestionList = document.getElementById('suggestionList');
const refreshIntervalButton = document.getElementById('refreshIntervalButton');
const refreshIntervalLabel = document.getElementById('refreshIntervalLabel');
const refreshIntervalMenu = document.getElementById('refreshIntervalMenu');
const opacityText = document.getElementById('opacityText');
const refreshHint = document.getElementById('refreshHint');
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

function suggestionLabel(item) {
  if (!item) return '';
  return `${item.name} ${item.code}`;
}

function suggestionKey(item) {
  return item && item.symbol ? item.symbol : '';
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(Number(value)) || Number(value) === 0) return '--';
  return Number(value).toFixed(digits);
}

function formatRawNumber(value) {
  if (value === undefined || value === null || value === '' || Number(value) === 0) return '--';
  return String(value);
}

function formatChangeAmount(value, fallbackValue) {
  if (value !== undefined && value !== null && String(value).trim() !== '') return String(value);
  if (!Number.isFinite(Number(fallbackValue)) || Number(fallbackValue) === 0) return '--';
  return Number(fallbackValue).toFixed(2);
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
  const minimalMode = Boolean(state.config.privacy.minimalMode);
  const scrollTop = tableWrap ? tableWrap.scrollTop : 0;
  const scrollLeft = tableWrap ? tableWrap.scrollLeft : 0;

  appEl.classList.toggle('privacy', Boolean(state.config.privacy.hidePnL || state.config.privacy.hidePosition));
  appEl.classList.toggle('minimal', minimalMode);

  const rows = state.config.watchlist.map(item => {
    const quote = state.quotes.get(item.symbol) || {};
    const name = item.alias || quote.name || item.name || item.symbol;
    const price = quote.price || 0;
    const changeClass = trendClass(quote.change);
    return `
      <tr data-symbol="${item.symbol}" class="${state.rowDrag && state.rowDrag.symbol === item.symbol && state.rowDrag.active ? 'dragging-row' : ''}">
        <td class="name" title="${escapeHtml(name)}">${escapeHtml(name)}</td>
        <td>${item.symbol.replace(/^(sh|sz|bj)/, '')}</td>
        <td class="${changeClass}">${formatRawNumber(quote.priceText ?? price)}</td>
        <td class="${changeClass}">${formatChangeAmount(quote.changeText, quote.change)}</td>
        <td class="${changeClass}">${Number.isFinite(Number(quote.changePercent)) ? Number(quote.changePercent).toFixed(2) + '%' : '--'}</td>
        <td class="${scoreClass(quote.investmentScore)}">${quote.investmentScoreText || '--'}</td>
        <td><button class="analysis-btn" data-symbol="${item.symbol}" title="查看AI分析">AI分析</button></td>
        <td>${quote.updatedAt || '--'}</td>
        <td><button class="remove" data-symbol="${item.symbol}" title="删除">×</button></td>
      </tr>
    `;
  }).join('');
  quoteRows.innerHTML = rows || '<tr><td colspan="9" class="flat">暂无自选股，输入代码后添加。</td></tr>';
  if (tableWrap) {
    tableWrap.scrollTop = minimalMode ? 0 : scrollTop;
    tableWrap.scrollLeft = minimalMode ? 0 : scrollLeft;
  }
  opacityText.textContent = `透明度 ${Math.round(state.config.window.opacity * 100)}%`;
  refreshIntervalLabel.textContent = formatIntervalLabel(state.config.refreshIntervalMs);
  syncRefreshMenu();
  refreshHint.textContent = `每 ${formatIntervalLabel(state.config.refreshIntervalMs)} 刷新行情、评分和分析。`;
  applyMinimalLayout();
}

function normalizeRefreshInterval(value) {
  const interval = Number(value);
  return [5000, 10000, 15000, 60000].includes(interval) ? interval : 60000;
}

function formatIntervalLabel(value) {
  const interval = normalizeRefreshInterval(value);
  if (interval < 60000) return `${interval / 1000} 秒`;
  return '1分钟';
}

function applyMinimalLayout() {
  const payload = {
    enabled: Boolean(state.config.privacy.minimalMode),
    rowCount: state.config.watchlist.length || 1
  };
  if (
    state.minimalLayout.enabled === payload.enabled &&
    state.minimalLayout.rowCount === payload.rowCount
  ) {
    return;
  }
  state.minimalLayout = payload;
  window.yinpan.setMinimalLayout(payload);
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
  state.timer = setInterval(() => refreshQuotes(false), normalizeRefreshInterval(state.config.refreshIntervalMs));
}

async function saveConfig() {
  state.config = await window.yinpan.saveConfig(state.config);
}

async function addStock() {
  const symbol = await resolveInputSymbol();
  if (!symbol) {
    statusText.textContent = '请输入 6 位代码或股票名称，例如 600519 / 上汽集团';
    symbolInput.focus();
    return;
  }
  if (state.config.watchlist.some(item => item.symbol === symbol)) {
    statusText.textContent = `${symbol} 已存在`;
    return;
  }
  state.config.watchlist.unshift({
    symbol,
    name: symbol
  });
  symbolInput.value = '';
  hideSuggestions();
  await saveConfig();
  render();
  refreshQuotes(true);
}

async function resolveInputSymbol() {
  const directSymbol = normalizeSymbol(symbolInput.value);
  if (directSymbol) return directSymbol;
  if (state.selectedSuggestion && symbolInput.value.trim() === suggestionLabel(state.selectedSuggestion)) {
    return state.selectedSuggestion.symbol;
  }
  if (state.suggestions.length > 0) return state.suggestions[0].symbol;

  const suggestions = await window.yinpan.getSuggestions(symbolInput.value);
  return suggestions.length > 0 ? suggestions[0].symbol : null;
}

function scheduleSuggestionSearch() {
  clearTimeout(state.suggestionTimer);
  state.selectedSuggestion = null;
  state.activeSuggestionIndex = -1;
  const keyword = symbolInput.value.trim();
  if (!keyword) {
    hideSuggestions();
    return;
  }

  const localSuggestions = findLocalSuggestions(keyword);
  if (localSuggestions.length > 0) {
    state.suggestions = localSuggestions;
    renderSuggestions();
  } else {
    renderSuggestionMessage('正在查找股票...');
  }

  state.suggestionTimer = setTimeout(() => searchSuggestions(keyword), 180);
}

async function searchSuggestions(keyword) {
  try {
    const remoteSuggestions = await window.yinpan.getSuggestions(keyword);
    if (symbolInput.value.trim() !== keyword) return;
    state.suggestions = mergeSuggestions(findLocalSuggestions(keyword), remoteSuggestions);
    renderSuggestions();
  } catch (error) {
    if (state.suggestions.length === 0) renderSuggestionMessage('查找失败，请输入股票代码添加');
  }
}

function findLocalSuggestions(keyword) {
  const text = String(keyword || '').trim().toLowerCase();
  if (!text) return [];

  return state.config.watchlist.map(item => {
    const quote = state.quotes.get(item.symbol) || {};
    const name = item.alias || quote.name || item.name || item.symbol;
    const code = item.symbol.replace(/^(sh|sz|bj)/, '');
    return {
      symbol: item.symbol,
      market: item.symbol.slice(0, 2),
      code,
      name,
      type: 'LOCAL'
    };
  }).filter(item => {
    return item.symbol.includes(text) || item.code.includes(text) || item.name.toLowerCase().includes(text);
  }).slice(0, 8);
}

function mergeSuggestions(...groups) {
  const seen = new Set();
  const merged = [];
  for (const group of groups) {
    for (const item of group || []) {
      const key = suggestionKey(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  return merged.slice(0, 8);
}

function renderSuggestions() {
  if (state.suggestions.length === 0) {
    renderSuggestionMessage('没有匹配到股票');
    return;
  }

  suggestionList.innerHTML = state.suggestions.map(item => `
    <button class="suggestion-item" type="button" data-symbol="${item.symbol}" aria-selected="${String(state.suggestions.indexOf(item) === state.activeSuggestionIndex)}">
      <span class="suggestion-name">${escapeHtml(item.name)}</span>
      <span class="suggestion-code">${escapeHtml(item.code)}</span>
      <span class="suggestion-market">${escapeHtml(item.market.toUpperCase())}</span>
    </button>
  `).join('');
  suggestionList.hidden = false;
}

function renderSuggestionMessage(message) {
  suggestionList.innerHTML = `<div class="suggestion-empty">${escapeHtml(message)}</div>`;
  suggestionList.hidden = false;
}

function selectSuggestion(symbol) {
  const suggestion = state.suggestions.find(item => item.symbol === symbol);
  if (!suggestion) return;
  state.selectedSuggestion = suggestion;
  symbolInput.value = suggestionLabel(suggestion);
  hideSuggestions();
}

function hideSuggestions() {
  state.suggestions = [];
  state.activeSuggestionIndex = -1;
  suggestionList.innerHTML = '';
  suggestionList.hidden = true;
}

function moveActiveSuggestion(delta) {
  if (state.suggestions.length === 0) return;
  const next = state.activeSuggestionIndex < 0
    ? (delta > 0 ? 0 : state.suggestions.length - 1)
    : (state.activeSuggestionIndex + delta + state.suggestions.length) % state.suggestions.length;
  state.activeSuggestionIndex = next;
  renderSuggestions();
  const active = suggestionList.querySelector('[aria-selected="true"]');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function chooseActiveSuggestion() {
  if (state.activeSuggestionIndex < 0) return false;
  const suggestion = state.suggestions[state.activeSuggestionIndex];
  if (!suggestion) return false;
  selectSuggestion(suggestion.symbol);
  return true;
}

async function changeRefreshInterval() {
  const selected = refreshIntervalMenu.querySelector('[aria-selected="true"]');
  state.config.refreshIntervalMs = normalizeRefreshInterval(selected && selected.dataset.value);
  await saveConfig();
  scheduleRefresh();
  render();
  refreshQuotes(true);
}

function syncRefreshMenu() {
  const current = String(normalizeRefreshInterval(state.config.refreshIntervalMs));
  refreshIntervalMenu.querySelectorAll('[data-value]').forEach(button => {
    button.setAttribute('aria-selected', String(button.dataset.value === current));
  });
}

function toggleRefreshMenu() {
  const open = refreshIntervalMenu.hidden;
  refreshIntervalMenu.hidden = !open;
  refreshIntervalButton.setAttribute('aria-expanded', String(open));
}

function closeRefreshMenu() {
  refreshIntervalMenu.hidden = true;
  refreshIntervalButton.setAttribute('aria-expanded', 'false');
}

async function showAnalysis(symbol) {
  state.analysisSymbol = symbol;
  const quote = state.quotes.get(symbol) || {};
  const item = state.config.watchlist.find(stock => stock.symbol === symbol) || {};
  const name = item.alias || quote.name || item.name || symbol;
  hideSuggestions();
  analysisSubtitle.textContent = `${name} ${symbol.replace(/^(sh|sz|bj)/, '')}`;
  analysisContent.innerHTML = '<p class="flat">正在读取最近一次评分原因...</p>';
  document.body.classList.add('modal-open');
  analysisModal.hidden = false;
  document.getElementById('analysisCloseBtn').focus();

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
  document.body.classList.remove('modal-open');
  analysisModal.hidden = true;
}

async function adjustWindowOpacity(delta) {
  const opacity = await window.yinpan.adjustOpacity(delta);
  state.config.window.opacity = opacity;
  render();
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

function startRowPress(event) {
  if (event.button !== 0 || document.body.classList.contains('modal-open')) return;
  if (event.target.closest('button, input, select, .refresh-select, .suggestion-list')) return;

  const row = event.target.closest('tr[data-symbol]');
  if (!row) return;

  clearRowPress();
  state.rowDrag = {
    symbol: row.dataset.symbol,
    active: false,
    changed: false,
    startX: event.clientX,
    startY: event.clientY,
    timer: setTimeout(() => beginRowDrag(row.dataset.symbol), 160)
  };
}

function beginRowDrag(symbol) {
  if (!state.rowDrag || state.rowDrag.symbol !== symbol) return;
  state.rowDrag.active = true;
  document.body.classList.add('row-dragging');
  statusText.textContent = '拖动排序，松开保存';
  render();
}

function moveRowDrag(event) {
  if (!state.rowDrag) return;

  if (!state.rowDrag.active) {
    const moved = Math.hypot(event.clientX - state.rowDrag.startX, event.clientY - state.rowDrag.startY);
    if (moved > 8) clearRowPress();
    return;
  }

  event.preventDefault();
  const targetRow = document.elementFromPoint(event.clientX, event.clientY)?.closest('tr[data-symbol]');
  if (!targetRow || targetRow.dataset.symbol === state.rowDrag.symbol) return;
  reorderWatchlist(state.rowDrag.symbol, targetRow.dataset.symbol);
}

function reorderWatchlist(sourceSymbol, targetSymbol) {
  const sourceIndex = state.config.watchlist.findIndex(item => item.symbol === sourceSymbol);
  const targetIndex = state.config.watchlist.findIndex(item => item.symbol === targetSymbol);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;

  const [item] = state.config.watchlist.splice(sourceIndex, 1);
  state.config.watchlist.splice(targetIndex, 0, item);
  state.rowDrag.changed = true;
  render();
}

async function finishRowDrag() {
  if (!state.rowDrag) return;
  const shouldSave = state.rowDrag.active && state.rowDrag.changed;
  state.suppressNextRowClick = state.rowDrag.active;
  clearRowPress();
  render();
  if (shouldSave) {
    await saveConfig();
    statusText.textContent = '排序已保存';
  }
}

function clearRowPress() {
  if (state.rowDrag && state.rowDrag.timer) clearTimeout(state.rowDrag.timer);
  state.rowDrag = null;
  document.body.classList.remove('row-dragging');
}

function themeClassNames() {
  return state.themes.map(theme => theme.className).filter(Boolean);
}

function getThemeByMode(mode) {
  return state.themes.find(theme => theme.mode === mode) || state.themes[0];
}

function applyTheme(theme) {
  const nextTheme = theme || getThemeByMode(state.config?.theme?.mode);
  state.themeIndex = state.themes.indexOf(nextTheme);
  if (state.themeIndex < 0) state.themeIndex = 0;
  document.body.classList.remove(...themeClassNames());
  if (nextTheme.className) document.body.classList.add(nextTheme.className);
}

async function cycleTheme() {
  const currentIndex = state.themeIndex >= 0 ? state.themeIndex : 0;
  const nextTheme = state.themes[(currentIndex + 1) % state.themes.length];
  state.config.theme = {
    ...(state.config.theme || {}),
    mode: nextTheme.mode,
    ...nextTheme.colors
  };
  applyTheme(nextTheme);
  await saveConfig();
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
  refreshIntervalButton.addEventListener('click', event => {
    event.stopPropagation();
    hideSuggestions();
    toggleRefreshMenu();
  });
  refreshIntervalMenu.addEventListener('click', event => {
    const item = event.target.closest('[data-value]');
    if (!item) return;
    refreshIntervalMenu.querySelectorAll('[data-value]').forEach(button => {
      button.setAttribute('aria-selected', String(button === item));
    });
    closeRefreshMenu();
    changeRefreshInterval();
  });
  document.getElementById('themeBtn').addEventListener('click', cycleTheme);
  document.getElementById('minimalBtn').addEventListener('click', toggleMinimal);
  document.getElementById('hideBtn').addEventListener('click', () => window.yinpan.hideWindow());
  document.getElementById('closeBtn').addEventListener('click', () => window.yinpan.closeApp());
  document.getElementById('analysisCloseBtn').addEventListener('click', closeAnalysis);
  analysisModal.addEventListener('click', event => {
    if (event.target === analysisModal) closeAnalysis();
  });
  document.addEventListener('keydown', event => {
    if (!analysisModal.hidden && event.ctrlKey && !event.altKey && !event.shiftKey) {
      if (event.key === '[' || event.code === 'BracketLeft') {
        event.preventDefault();
        adjustWindowOpacity(-0.08);
        return;
      }
      if (event.key === ']' || event.code === 'BracketRight') {
        event.preventDefault();
        adjustWindowOpacity(0.08);
        return;
      }
    }
    if (event.key === 'Escape' && !analysisModal.hidden) closeAnalysis();
    if (event.key === 'Escape') closeRefreshMenu();
  });
  symbolInput.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActiveSuggestion(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActiveSuggestion(-1);
      return;
    }
    if (event.key === 'Enter') {
      if (chooseActiveSuggestion()) {
        event.preventDefault();
        addStock();
        return;
      }
      addStock();
    }
    if (event.key === 'Escape') hideSuggestions();
  });
  symbolInput.addEventListener('input', scheduleSuggestionSearch);
  suggestionList.addEventListener('mousedown', event => {
    const item = event.target.closest('.suggestion-item');
    if (!item) return;
    event.preventDefault();
    selectSuggestion(item.dataset.symbol);
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.symbol-box')) hideSuggestions();
    if (!event.target.closest('.refresh-select')) closeRefreshMenu();
  });
  quoteRows.addEventListener('click', event => {
    if (state.suppressNextRowClick) {
      state.suppressNextRowClick = false;
      event.preventDefault();
      return;
    }
    if (document.body.classList.contains('row-dragging')) return;
    const removeButton = event.target.closest('.remove');
    if (removeButton) removeStock(removeButton.dataset.symbol);

    const analysisButton = event.target.closest('.analysis-btn');
    if (analysisButton) showAnalysis(analysisButton.dataset.symbol);
  });
  quoteRows.addEventListener('pointerdown', startRowPress);
  document.addEventListener('pointermove', moveRowDrag);
  document.addEventListener('pointerup', finishRowDrag);
  document.addEventListener('pointercancel', clearRowPress);

  window.yinpan.onCycleTheme(cycleTheme);
  window.yinpan.onTogglePrivacy(togglePrivacy);
  window.yinpan.onToggleMinimal(toggleMinimal);
  window.yinpan.onConfigUpdated(config => {
    state.config = config;
    applyTheme();
    render();
  });
  window.yinpan.onOpacity(opacity => {
    state.config.window.opacity = opacity;
    render();
  });
}

async function init() {
  state.config = await window.yinpan.getConfig();
  applyTheme();
  bindEvents();
  render();
  scheduleRefresh();
  refreshQuotes(true);
}

init();
