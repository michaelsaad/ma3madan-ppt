const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel, fn) => ipcRenderer.on(channel, (_e, data) => fn(data));

contextBridge.exposeInMainWorld('api', {
  // settings, screens
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSetting: (k, v) => ipcRenderer.send('set-setting', k, v),
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  onDisplays: fn => on('displays', fn),
  appVersion: () => ipcRenderer.invoke('app-version'),

  // library
  loadLibrary: () => ipcRenderer.invoke('library-load'),
  saveLibrary: lib => ipcRenderer.send('library-save', lib),
  pickDecks: title => ipcRenderer.invoke('pick-decks', title),
  takeOpenFiles: () => ipcRenderer.invoke('take-open-files'),
  onOpenFiles: fn => on('open-files', fn),
  pathForFile: f => webUtils.getPathForFile(f),
  fileExists: p => ipcRenderer.invoke('file-exists', p),
  showInFolder: p => ipcRenderer.send('show-in-folder', p),
  openInPowerPoint: p => ipcRenderer.send('open-in-powerpoint', p),

  // presentations and the show
  openDeck: p => ipcRenderer.invoke('deck-open', p),
  closeDeck: p => ipcRenderer.invoke('deck-close', p),
  onThumbs: fn => on('thumbs', fn),
  startShow: (p, slide) => ipcRenderer.invoke('show-start', p, slide),
  showCmd: c => ipcRenderer.invoke('show-cmd', c),
  showClick: (fx, fy) => ipcRenderer.invoke('show-click', fx, fy),
  showState: () => ipcRenderer.invoke('show-state'),
  onShowState: fn => on('show-state', fn),

  // phone remote
  qrSvg: text => ipcRenderer.invoke('qr-svg', text),
  hostName: () => ipcRenderer.invoke('host-name'),
  thumbData: (p, n, w) => ipcRenderer.invoke('thumb-data', p, n, w),

  // updates
  onUpdateAvailable: fn => on('update-available', fn),
  onUpdateProgress: fn => on('update-progress', fn),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  checkForUpdate: () => ipcRenderer.invoke('update-check'),
});
