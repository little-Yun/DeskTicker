const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yinpan', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: config => ipcRenderer.invoke('config:save', config),
  getQuotes: symbols => ipcRenderer.invoke('quotes:get', symbols),
  getSuggestions: keyword => ipcRenderer.invoke('suggestions:get', keyword),
  getAnalysis: symbol => ipcRenderer.invoke('analysis:get', symbol),
  hideWindow: () => ipcRenderer.invoke('window:minimize-hide'),
  adjustOpacity: delta => ipcRenderer.invoke('window:opacity-adjust', delta),
  setMinimalLayout: payload => ipcRenderer.invoke('window:minimal-layout', payload),
  closeApp: () => ipcRenderer.invoke('window:close'),
  onCycleTheme: callback => ipcRenderer.on('theme:cycle', callback),
  onTogglePrivacy: callback => ipcRenderer.on('privacy:toggle', callback),
  onToggleMinimal: callback => ipcRenderer.on('minimal:toggle', callback),
  onConfigUpdated: callback => ipcRenderer.on('config:updated', (_event, config) => callback(config)),
  onOpacity: callback => ipcRenderer.on('window:opacity', (_event, opacity) => callback(opacity))
});
