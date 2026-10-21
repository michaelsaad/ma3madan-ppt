// Main process: the operator's window, the library of presentations, and PowerPoint.
//
// PowerPoint itself shows the slides on the projector (animations, videos, fonts and links all
// work as the author made them). This app is everything around it: the presenter view on the
// laptop, sections and a slide grid, saved lists, and the phone remote.
const { app, BrowserWindow, ipcMain, screen, dialog, shell, nativeTheme, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');
const ppt = require('./ppt/bridge');
const updater = require('./updater');
const qrcode = require('./vendor/qrcode');

const APP_NAME = 'Ma3madan PPT';
const DECK_RE = /\.(pptx|ppt|ppsx|pps|pptm|ppsm)$/i;

app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
if (process.env.MP_SELFTEST) {
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.setPath('userData', process.env.MP_SELFTEST_DIR);
}
if (!app.requestSingleInstanceLock()) app.quit();

let controlWin = null;

// ---------- persistence ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const libraryFile = () => path.join(app.getPath('userData'), 'library.json');
const thumbsRoot = () => path.join(app.getPath('userData'), 'thumbs');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
const settings = readJson(settingsFile(), {});
const saveSettings = () => writeJson(settingsFile(), settings);

// ---------- presentations opened from outside (Explorer, "Open with") ----------
let pendingOpen = process.argv.slice(1).filter(a => DECK_RE.test(a) && fs.existsSync(a));
app.on('second-instance', (_e, argv) => {
  const files = argv.slice(1).filter(a => DECK_RE.test(a) && fs.existsSync(a));
  if (controlWin) {
    if (controlWin.isMinimized()) controlWin.restore();
    controlWin.focus();
    if (files.length) controlWin.webContents.send('open-files', files);
  }
});

// ---------- screens ----------
// Numbered like Windows does: 1 is the main screen, the others from left to right.
function numberedDisplays() {
  const primary = screen.getPrimaryDisplay();
  const others = screen.getAllDisplays().filter(d => d.id !== primary.id)
    .sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
  return [primary, ...others].map((d, i) => ({ d, n: i + 1 }));
}
const controlDisplay = () => (controlWin ? screen.getDisplayMatching(controlWin.getBounds()) : screen.getPrimaryDisplay());

// Where the show goes: settings.showOn = display id, or unset (automatic: the first screen that
// isn't the laptop's, else the laptop's own screen).
function showTarget() {
  const all = screen.getAllDisplays();
  const chosen = all.find(d => d.id === settings.showOn);
  if (chosen) return { display: chosen };
  const ctl = controlDisplay();
  return { display: all.find(d => d.id !== ctl.id) || ctl };
}
function displaysInfo() {
  const ctl = controlDisplay();
  return {
    displays: numberedDisplays().map(({ d, n }) => ({ id: d.id, n, w: d.size.width, h: d.size.height, laptop: d.id === ctl.id, primary: n === 1 })),
    showOn: settings.showOn ?? 'auto',
  };
}
const sendDisplays = () => controlWin?.webContents.send('displays', displaysInfo());

// ---------- library: recents and saved lists ----------
// { recents: [{ path, name, opened, slide }], lists: [{ id, name, items: [path] }] }
const library = Object.assign({ recents: [], lists: [] }, readJson(libraryFile(), {}));
const saveLibrary = () => writeJson(libraryFile(), library);

function touchRecent(file, name) {
  const old = library.recents.find(r => r.path.toLowerCase() === file.toLowerCase());
  library.recents = library.recents.filter(r => r !== old);
  library.recents.unshift({ ...(old || {}), path: file, name: name || path.basename(file), opened: Date.now() });
  library.recents = library.recents.slice(0, 60);
  saveLibrary();
}
function rememberSlide(file, slide) {
  const r = library.recents.find(x => x.path.toLowerCase() === file.toLowerCase());
  if (r && slide > 0 && r.slide !== slide) { r.slide = slide; saveLibraryLater(); }
}
let libTimer;
const saveLibraryLater = () => { clearTimeout(libTimer); libTimer = setTimeout(saveLibrary, 1500); };

// ---------- presentations ----------
const decks = new Map(); // path (lower case) → { info, dir, ready }

// Thumbnails are cached per file version (path + size + date), so reopening is instant.
function thumbsDirFor(file) {
  const st = fs.statSync(file);
  const h = crypto.createHash('sha1').update(`${file.toLowerCase()}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 16);
  return path.join(thumbsRoot(), h);
}

async function openDeck(file) {
  if (!fs.existsSync(file)) throw new Error('missing');
  const k = file.toLowerCase();
  if (decks.has(k)) return deckPayload(decks.get(k));
  const info = await ppt.open(file);
  const dir = thumbsDirFor(file);
  const d = { info, dir, ready: 0 };
  decks.set(k, d);
  touchRecent(file, info.name);
  makeThumbs(d); // in the background; the grid fills in as they come
  return deckPayload(d);
}
const deckPayload = d => ({ ...d.info, thumbs: pathToFileURL(d.dir).href + '/', ready: d.ready });

async function makeThumbs(d) {
  const n = d.info.slides.length;
  fs.mkdirSync(d.dir, { recursive: true });
  // Already made for this version of the file?
  if (fs.existsSync(path.join(d.dir, `${n}.png`)) && fs.existsSync(path.join(d.dir, 'done'))) {
    d.ready = n;
    controlWin?.webContents.send('thumbs', { path: d.info.path, ready: n });
    return;
  }
  const w = 480, h = Math.round(w * d.info.height / d.info.width);
  for (let from = 1; from <= n; from += 6) {
    const to = Math.min(n, from + 5);
    try { await ppt.thumbs(d.info.path, d.dir, w, h, from, to); } catch (e) { console.warn('thumbs', e.message); return; }
    d.ready = to;
    controlWin?.webContents.send('thumbs', { path: d.info.path, ready: to });
  }
  fs.writeFileSync(path.join(d.dir, 'done'), '');
}

// Old thumbnail folders (other versions of files) are cleared after a month.
function pruneThumbs() {
  try {
    const month = Date.now() - 30 * 864e5;
    for (const name of fs.readdirSync(thumbsRoot())) {
      const p = path.join(thumbsRoot(), name);
      if (fs.statSync(p).mtimeMs < month) fs.rmSync(p, { recursive: true, force: true });
    }
  } catch {}
}

// ---------- the slide show ----------
let show = { running: false };
let pollTimer = null;
let showHwnd = null;
let findingShow = false;
let showRect = null; // the show window, in screen pixels
let showCoversControls = false; // the show is full screen on the operator's own screen

// What the page gets: the state plus the id to capture the show window for the live view.
const publicShow = () => ({ ...show, sourceId: show.running && showHwnd ? `window:${showHwnd}:0` : null });
function sendShow() { controlWin?.webContents.send('show-state', publicShow()); }

async function poll() {
  clearTimeout(pollTimer);
  let s;
  try { s = await ppt.state(); } catch (e) { s = { running: false, error: e.message }; }
  const changed = JSON.stringify(s) !== JSON.stringify(show);
  if (!s.running) { showHwnd = null; showRect = null; }
  // A show started some other way (in PowerPoint itself): find its window for the live view.
  if (s.running && !showHwnd && !findingShow) {
    findingShow = true;
    ppt.findShow().then(f => { showHwnd = f.hwnd; showRect = f.rect; sendShow(); }).catch(() => {}).finally(() => { findingShow = false; });
  }
  show = s;
  if (changed) {
    if (s.running && s.path && s.slide) rememberSlide(s.path, s.slide);
    sendShow();
  }
  // Fast while presenting (the operator sees changes made on the projector right away).
  if (s.running) pollTimer = setTimeout(poll, 200);
}

async function startShow(file, slide) {
  await openDeck(file);
  const target = showTarget();
  await ppt.start(file, slide || 1, !!target.windowed);
  try {
    const found = await ppt.findShow();
    showHwnd = found.hwnd;
    showRect = found.rect;
    if (target.display) {
      // PowerPoint picks its own monitor: move the show to the chosen screen, in real pixels.
      const r = screen.dipToScreenRect(null, target.display.bounds);
      const placed = await ppt.place({ x: r.x, y: r.y, w: r.width, h: r.height });
      showRect = placed.rect;
    }
  } catch (e) { console.warn('show window', e.message); }
  // Keys stay with the operator's window (unless the show covers it: one screen only).
  showCoversControls = !target.windowed && target.display?.id === controlDisplay().id;
  if (!showCoversControls) setTimeout(() => controlWin?.focus(), 150);
  await poll();
  return publicShow();
}

async function showCommand(c) {
  if (!show.running) return show;
  switch (c.action) {
    case 'next': await ppt.next(); break;
    case 'prev': await ppt.prev(); break;
    case 'go': await ppt.go(c.n); break;
    case 'first': await ppt.go(1); break;
    case 'last': await ppt.go(show.count || 1); break;
    case 'black': await ppt.screen(3); break;
    case 'white': await ppt.screen(4); break;
    case 'end': await ppt.end(); break;
  }
  await poll();
  return show;
}

// A click on the slide in the presenter view becomes a real click on the projector, so links,
// action buttons, video controls and animation triggers all work.
// sx, sy: the spot on the slide (0..1), from the presenter view or the phone.
async function showClick(sx, sy) {
  if (!show.running) return;
  // Links and action buttons: PowerPoint itself finds the shape and does its action.
  const hit = await ppt.hit(sx, sy).catch(() => ({ done: false }));
  if (process.env.MP_SELFTEST) console.log('[hit]', JSON.stringify(hit));
  if (hit.done) { setTimeout(poll, 100); return; }
  // Anything else (animation triggers, video buttons): a real click. The show window has the
  // screen's shape, with the slide letterboxed inside it.
  if (!showRect) { try { const f = await ppt.findShow(); showHwnd = f.hwnd; showRect = f.rect; } catch {} }
  let fx = sx, fy = sy;
  const d = decks.get(String(show.path || '').toLowerCase());
  if (showRect && d) {
    const win = showRect.w / showRect.h, slide = d.info.width / d.info.height;
    if (win > slide) { const w = slide / win; fx = (1 - w) / 2 + sx * w; } else { const h = win / slide; fy = (1 - h) / 2 + sy * h; }
  }
  // The keyboard comes back to this window afterwards, but only when the show is on another
  // screen: with one screen the show covers everything, and taking focus from it pauses it.
  const back = controlWin && !showCoversControls ? Number(controlWin.getNativeWindowHandle().readBigInt64LE()) : 0;
  const r = await ppt.click(fx, fy, back);
  if (process.env.MP_SELFTEST) console.log('[click]', JSON.stringify(r));
  // Taking the focus back can leave PowerPoint paused: keep it running.
  if (back) setTimeout(() => ppt.resume().catch(() => {}), 250);
  setTimeout(poll, 150);
}

// ---------- window ----------
function initialBounds() {
  const saved = settings.controlBounds;
  const visible = saved && screen.getAllDisplays().some(d => {
    const a = d.workArea;
    return saved.x < a.x + a.width - 80 && saved.x + saved.width > a.x + 80 && saved.y >= a.y - 10 && saved.y < a.y + a.height - 80;
  });
  if (visible) return saved;
  const a = screen.getPrimaryDisplay().workArea;
  const width = Math.min(1280, a.width), height = Math.min(800, a.height);
  return { x: a.x + Math.round((a.width - width) / 2), y: a.y + Math.round((a.height - height) / 2), width, height };
}

const THEME_COLORS = {
  dark: { bg: '#0a101d', bar: '#111a2b', symbol: '#e9edf5' },
  light: { bg: '#edf1f7', bar: '#ffffff', symbol: '#172033' },
};
const themeColors = () => THEME_COLORS[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'];
function applyTheme() {
  nativeTheme.themeSource = ['light', 'dark'].includes(settings.theme) ? settings.theme : 'system';
}
nativeTheme.on('updated', () => {
  if (!controlWin || controlWin.isDestroyed()) return;
  const c = themeColors();
  controlWin.setTitleBarOverlay({ color: c.bar, symbolColor: c.symbol, height: 56 });
  controlWin.setBackgroundColor(c.bg);
});

function createControl() {
  applyTheme();
  const colors = themeColors();
  controlWin = new BrowserWindow({
    ...initialBounds(),
    minWidth: 720,
    minHeight: 480,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.bar, symbolColor: colors.symbol, height: 56 },
    backgroundColor: colors.bg,
    title: APP_NAME,
    icon: path.join(__dirname, 'assets', 'app-256.png'),
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  controlWin.setMenu(null);
  if (settings.controlMaximized ?? true) controlWin.maximize();
  controlWin.once('ready-to-show', () => { if (!process.env.MP_SELFTEST_HIDDEN) controlWin.show(); });
  controlWin.loadFile(path.join(__dirname, 'control.html'));

  let saveTimer;
  const rememberBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!controlWin || controlWin.isFullScreen()) return;
      settings.controlMaximized = controlWin.isMaximized();
      if (!controlWin.isMaximized() && !controlWin.isMinimized()) settings.controlBounds = controlWin.getNormalBounds();
      saveSettings();
    }, 400);
  };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) controlWin.on(ev, rememberBounds);
  controlWin.on('move', () => sendDisplays());
  // Links in the page open in the browser, never inside the app.
  controlWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  controlWin.webContents.on('will-navigate', e => e.preventDefault());
  controlWin.on('closed', () => { controlWin = null; app.quit(); });
}

// ---------- IPC ----------
ipcMain.handle('get-settings', () => settings);
ipcMain.on('set-setting', (_e, k, v) => {
  settings[k] = v; saveSettings();
  if (k === 'theme') applyTheme();
  if (k === 'showOn') sendDisplays();
});
ipcMain.handle('app-version', () => app.getVersion());
ipcMain.handle('get-displays', () => displaysInfo());

ipcMain.handle('library-load', () => library);
ipcMain.on('library-save', (_e, lib) => {
  if (Array.isArray(lib?.recents)) library.recents = lib.recents;
  if (Array.isArray(lib?.lists)) library.lists = lib.lists;
  saveLibrary();
});
ipcMain.handle('pick-decks', async (_e, title) => {
  const r = await dialog.showOpenDialog(controlWin, {
    title, properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PowerPoint', extensions: ['pptx', 'ppt', 'ppsx', 'pps', 'pptm', 'ppsm'] }],
  });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('take-open-files', () => { const f = pendingOpen; pendingOpen = []; return f; });
ipcMain.handle('file-exists', (_e, p) => fs.existsSync(p));
ipcMain.on('show-in-folder', (_e, p) => shell.showItemInFolder(p));
ipcMain.on('open-in-powerpoint', (_e, p) => shell.openPath(p));

// Every PowerPoint call answers { ok, result } or { ok: false, error }: the page shows the message.
const safe = fn => async (_e, ...a) => { try { return { ok: true, result: await fn(...a) }; } catch (e) { return { ok: false, error: e.message }; } };
ipcMain.handle('deck-open', safe(openDeck));
ipcMain.handle('deck-close', safe(async file => {
  const k = file.toLowerCase();
  if (show.running && show.path?.toLowerCase() === k) await ppt.end();
  decks.delete(k);
  await ppt.close(file);
  return true;
}));
ipcMain.handle('show-start', safe(startShow));
ipcMain.handle('show-cmd', safe(showCommand));
ipcMain.handle('show-click', safe(showClick));
ipcMain.handle('show-state', () => publicShow());

// ---------- phone remote ----------
ipcMain.handle('qr-svg', (_e, text) => {
  if (typeof text !== 'string' || text.length > 600) return null;
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
});
ipcMain.handle('host-name', () => require('os').hostname());
// A slide's picture for the phone: a small JPEG as a data URL (it travels over the data channel).
ipcMain.handle('thumb-data', (_e, file, n, width) => {
  const d = decks.get(String(file).toLowerCase());
  if (!d || !(n >= 1 && n <= d.ready)) return null;
  const img = nativeImage.createFromPath(path.join(d.dir, `${n}.png`));
  if (img.isEmpty()) return null;
  const w = Math.max(80, Math.min(960, width | 0 || 320));
  return 'data:image/jpeg;base64,' + img.resize({ width: w, quality: 'good' }).toJPEG(w > 400 ? 78 : 70).toString('base64');
});

ipcMain.handle('update-check', async () => {
  try { const info = await updater.check(); if (info) controlWin?.webContents.send('update-available', info); return { ok: true, info }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('update-install', async () => {
  try { return { ok: true, result: await updater.install(p => controlWin?.webContents.send('update-progress', p)) }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// ---------- lifecycle ----------
// Was PowerPoint already running before us? Then it's the operator's: never close it.
let powerPointWasRunning = true;
function checkPowerPointRunning() {
  execFile('tasklist', ['/FI', 'IMAGENAME eq POWERPNT.EXE', '/NH'], { windowsHide: true }, (_err, out) => {
    powerPointWasRunning = /POWERPNT/i.test(out || '');
  });
}

app.whenReady().then(() => {
  checkPowerPointRunning();
  createControl();
  if (process.env.MP_SELFTEST) controlWin.webContents.on('console-message', e => console.log('[page]', e.message));
  if (process.env.MP_SELFTEST) require(process.env.MP_REMOTE_HOST ? '../test/remote-host' : '../test/selftest')(controlWin, { app, ppt });
  screen.on('display-added', sendDisplays);
  screen.on('display-removed', sendDisplays);
  screen.on('display-metrics-changed', sendDisplays);
  setTimeout(pruneThumbs, 30000);
  if (app.isPackaged) {
    const checkForUpdate = () => updater.check().then(info => info && controlWin?.webContents.send('update-available', info)).catch(() => {});
    setTimeout(checkForUpdate, 8000);
    setInterval(checkForUpdate, 6 * 3600e3);
  }
});

let quitting = false;
app.on('before-quit', e => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  clearTimeout(pollTimer);
  // Close our read-only copies; close PowerPoint only if we started it and it has nothing else open.
  Promise.race([ppt.quit(!powerPointWasRunning), new Promise(r => setTimeout(r, 4000))])
    .catch(() => {})
    .finally(() => { ppt.dispose(); app.quit(); });
});
app.on('window-all-closed', () => app.quit());
