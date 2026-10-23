const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel, fn) => ipcRenderer.on(channel, (_e, data) => fn(data));
const LINK_IN = new Set(['link-host-start', 'link-host-identity', 'link-host-apps', 'link-host-send', 'link-host-stop', 'link-app-in', 'link-status']);
const LINK_OUT = new Set(['link-app-out', 'link-host-net', 'link-host-peers', 'link-host-online', 'link-host-seen']);
const LINK_ASK = new Set(['link-op', 'link-host-trust', 'link-status']);

// Tests point the phone link at a test copy of the server.
if (process.env.MA3MADAN_BASE) contextBridge.exposeInMainWorld('MA3MADAN_BASE', process.env.MA3MADAN_BASE);

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
  onDeckOpened: fn => on('deck-opened', fn),
  onNotice: fn => on('notice', fn),

  // phone remote
  qrSvg: text => ipcRenderer.invoke('qr-svg', text),
  hostName: () => ipcRenderer.invoke('host-name'),
  thumbData: (p, n, w) => ipcRenderer.invoke('thumb-data', p, n, w),
  flashWindow: () => ipcRenderer.send('flash-window'),
  // the phone link shared with Ma3madan Play (hub.js, link-page.js): only these channels
  link: {
    on: (ch, fn) => { if (LINK_IN.has(ch)) on(ch, fn); },
    send: (ch, data) => { if (LINK_OUT.has(ch)) ipcRenderer.send(ch, data); },
    invoke: (ch, data) => (LINK_ASK.has(ch) ? ipcRenderer.invoke(ch, data) : Promise.resolve(null)),
  },

  // updates
  onUpdateAvailable: fn => on('update-available', fn),
  onUpdateProgress: fn => on('update-progress', fn),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  checkForUpdate: () => ipcRenderer.invoke('update-check'),
});
