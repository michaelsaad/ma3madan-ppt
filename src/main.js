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
const slideLinks = require('./ppt/links');
const updater = require('./updater');
const qrcode = require('./vendor/qrcode');
const { createHub } = require('./hub');
const { createTray } = require('./tray');

const APP_NAME = 'Ma3madan PPT';
const DECK_RE = /\.(pptx|ppt|ppsx|pps|pptm|ppsm)$/i;
// Files a link in the slides may open straight away (documents and media, never programs).
const SAFE_OPEN = /\.(pdf|jpe?g|png|gif|bmp|webp|tiff?|mp4|m4v|mov|wmv|avi|mkv|webm|mp3|wav|m4a|wma|aac|flac|ogg|txt)$/i;

app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
if (process.env.MP_SELFTEST) {
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.setPath('appData', process.env.MP_SELFTEST_DIR); // the shared phone link (hub.js) too: never the real one
  app.setPath('userData', process.env.MP_SELFTEST_DIR);
}
// MP_PROFILE=<dir>: the app as usual, in a throwaway profile (tests).
if (process.env.MP_PROFILE) {
  app.setPath('appData', process.env.MP_PROFILE);
  app.setPath('userData', process.env.MP_PROFILE);
}
if (!app.requestSingleInstanceLock()) app.quit();

let controlWin = null;
let tray = null;

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
    tray?.show(); // opened again (Start menu, a presentation from Explorer): back from the tray
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
// { recents: [{ path, name, opened, slide }], lists: [{ id, name, items: [path] }], program: [path] }
const library = Object.assign({ recents: [], lists: [], program: [] }, readJson(libraryFile(), {}));
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

const openingDecks = new Map(); // path → promise, so the same file is read once
function openDeck(file) {
  const k = String(file).toLowerCase();
  if (decks.has(k)) return Promise.resolve(deckPayload(decks.get(k)));
  if (!openingDecks.has(k)) openingDecks.set(k, readDeck(file).finally(() => openingDecks.delete(k)));
  return openingDecks.get(k);
}
async function readDeck(file) {
  if (typeof file !== 'string' || !DECK_RE.test(file)) throw new Error('not a presentation');
  if (!fs.existsSync(file)) throw new Error('missing');
  const k = file.toLowerCase();
  // From the file itself when it's a .pptx (instant, even during a show); an old .ppt asks PowerPoint.
  let info = null;
  if (/\.(pptx|ppsx|pptm|ppsm)$/i.test(file)) { try { info = slideLinks.describe(file); } catch (e) { console.warn('describe', e.message); } }
  if (!info) info = await ppt.open(file);
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
  for (let from = 1; from <= n; from += 2) {
    const to = Math.min(n, from + 1);
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
// Also where the show is: inside a custom show (its name), and the presentations a link came from.
const publicShow = () => ({
  ...show, sourceId: show.running && showHwnd ? `window:${showHwnd}:0` : null,
  named: show.running && named && same(named.path, show.path) ? named.name : null,
  chain: show.running ? returnTo.map(r => ({ path: r.path, slide: r.slide })) : [],
  black: blackHold,
});
let sentWhere = '';
function sendShow() { const s = publicShow(); sentWhere = JSON.stringify([s.named, s.chain, s.black]); controlWin?.webContents.send('show-state', s); }

let polling = false, pollAgain = false;
function poll() {
  clearTimeout(pollTimer);
  if (polling) { pollAgain = true; return Promise.resolve(); }
  polling = true;
  return pollOnce().finally(() => {
    polling = false;
    if (pollAgain) { pollAgain = false; poll(); }
    else if (show.running) pollTimer = setTimeout(poll, 300);
  });
}
async function pollOnce() {
  let s;
  const tp = Date.now();
  try { s = await ppt.state(); if (process.env.MP_SELFTEST && Date.now() - tp > 600) console.log('[slow state]', Date.now() - tp, 'ms'); } catch (e) { s = { running: false, error: e.message }; }
  const changed = JSON.stringify(s) !== JSON.stringify(show);
  // Another presentation took over the screen (a link in the slides): its window is a new one.
  if (!s.running || String(s.path || '').toLowerCase() !== String(show.path || '').toLowerCase()) { showHwnd = null; showRect = null; }
  // A presentation this app hasn't opened (PowerPoint followed a link by itself): open it here
  // too, so the presenter view and the phone show its slides, notes and sections.
  if (s.running && s.path && !decks.has(s.path.toLowerCase()) && !following.has(s.path.toLowerCase())) {
    const k = s.path.toLowerCase();
    following.add(k);
    openDeck(s.path).then(d => controlWin?.webContents.send('deck-opened', d)).catch(e => console.warn('follow', e.message)).finally(() => following.delete(k));
  }
  // The linked presentation's show ended: back to where we were, like PowerPoint.
  // (Its end is reached when it closes, or when it gets to the "end of slide show" screen.)
  if ((!s.running || s.state === 5) && show.running && returnTo.length && !endingAll && !switching) {
    const back = returnTo.pop();
    show = s;
    startShow(back.path, back.slide, { keepReturn: true, cover: true })
      .then(() => back.named && ppt.namedShow(back.named.name, back.named.from, back.slide).then(() => { named = back.named; poll(); }))
      .catch(e => console.warn('return', e.message));
    return;
  }
  if (!s.running && !switching) { returnTo.length = 0; endingAll = false; named = null; }
  // A show started some other way (in PowerPoint itself): find its window for the live view.
  if (s.running && !showHwnd && !findingShow) {
    findingShow = true;
    ppt.findShow().then(f => { showHwnd = f.hwnd; showRect = f.rect; sendShow(); }).catch(() => {}).finally(() => { findingShow = false; });
  }
  show = s;
  if (changed) {
    if (s.running && s.path && s.slide) rememberSlide(s.path, s.slide);
    sendShow();
  } else if (JSON.stringify([publicShow().named, publicShow().chain, blackHold]) !== sentWhere) sendShow();
  // Held black with one screen (no cover window): PowerPoint's own black, again after every move.
  if (blackHold && !coverWin && s.running && s.state !== 3 && s.state !== 5) ppt.screen(3, true).catch(() => {});
}

// Presentations to come back to: a link in the slides started another one's show.
const returnTo = []; // [{ path, slide }]
const following = new Set();
let endingAll = false;
let switching = 0; // a show is being started: its old one ending isn't the linked one ending
let named = null; // inside a custom show: { path, from: the slide that opened it, name }
const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

// Going from one presentation to another, the screen is covered black for the moment between
// them (else the audience sees the desktop, or PowerPoint's window, for a second).
async function startShow(file, slide, opts = {}) {
  switching++;
  const covering = show.running || opts.cover;
  if (covering) cover(true);
  try { return await startShowNow(file, slide, opts); } finally { switching--; if (covering) cover(false); }
}
let coverWin = null;
function cover(on) {
  if (!on) {
    if (blackHold) return; // held black stays until it's turned off
    const w = coverWin; coverWin = null;
    // A little after the new show is placed, so it's already drawn under the cover.
    setTimeout(() => { if (w && !w.isDestroyed()) w.destroy(); }, 350);
    return;
  }
  if (coverWin && !coverWin.isDestroyed()) return;
  const target = showTarget();
  if (!target.display || target.display.id === controlDisplay().id) return; // one screen: nothing to hide from
  try {
    coverWin = new BrowserWindow({
      ...target.display.bounds, frame: false, show: false, backgroundColor: '#000000', skipTaskbar: true,
      focusable: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, hasShadow: false,
    });
    coverWin.setAlwaysOnTop(true, 'screen-saver');
    coverWin.setBounds(target.display.bounds);
    coverWin.showInactive();
  } catch (e) { console.warn('cover', e.message); coverWin = null; }
}
// PowerPoint puts its show on top when it's placed: the cover goes back over it.
function raiseCover() { if (coverWin && !coverWin.isDestroyed()) { coverWin.setAlwaysOnTop(true, 'screen-saver'); coverWin.moveTop(); } }

// Black held: the audience sees black until it's turned off by hand, whatever happens meanwhile:
// moving through the slides, getting another presentation ready and showing it, the show ending.
// The slides still show here and on the phone. On a second screen it's a black window over the
// projector; with one screen, PowerPoint's own black (put back after every move).
let blackHold = false;
async function setBlack(on) {
  blackHold = !!on;
  if (on) {
    cover(true);
    if (!coverWin && show.running) await ppt.screen(3, true).catch(() => {});
  } else {
    cover(false);
    if (show.running && show.state === 3) await ppt.screen(1, true).catch(() => {});
  }
  sendShow();
}
// A point inside the chosen screen, in real pixels: the window helper finds that screen's exact
// rectangle itself (Electron's own numbers are scaled per screen).
function targetPoint(display) {
  const b = display.bounds;
  return screen.dipToScreenPoint({ x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) });
}
let placeTimers = [];
async function placeShow(target) {
  if (!target.display || target.windowed) return;
  const covers = target.display.id === controlDisplay().id;
  const placed = await ppt.place({ ...targetPoint(target.display), top: !covers });
  showRect = placed.rect;
  return placed;
}
// PowerPoint can resize its show a moment after it opens (a screen with another scaling sends it
// a "DPI changed"): look again twice, and put it back if it moved.
function recheckPlacement(target) {
  for (const t of placeTimers) clearTimeout(t);
  placeTimers = [600, 1800].map(ms => setTimeout(() => { if (show.running) placeShow(target).then(raiseCover).catch(() => {}); }, ms));
}

async function startShowNow(file, slide, opts) {
  if (!opts.keepReturn) returnTo.length = 0;
  const target = showTarget();
  let monitor = null;
  if (target.display && !target.windowed) { try { monitor = (await ppt.monitor(targetPoint(target.display))).device; } catch {} }
  if (decks.has(file.toLowerCase())) {
    await ppt.start(file, slide || 1, !!target.windowed, monitor);
  } else {
    // Not read yet (a link to another presentation): the show starts first, at once, and its
    // slides, notes and sections are read right after.
    if (!fs.existsSync(file)) throw new Error('missing');
    await ppt.start(file, slide || 1, !!target.windowed, monitor);
    openDeck(file).then(d => controlWin?.webContents.send('deck-opened', d)).catch(e => console.warn('open', e.message));
  }
  if (opts.notify && decks.has(file.toLowerCase())) controlWin?.webContents.send('deck-opened', deckPayload(decks.get(file.toLowerCase())));
  try {
    const found = await ppt.findShow();
    showHwnd = found.hwnd;
    showRect = found.rect;
    // PowerPoint was told the screen; make sure it fills it exactly (else Windows keeps the taskbar).
    await placeShow(target);
    raiseCover();
    recheckPlacement(target);
  } catch (e) { console.warn('show window', e.message); }
  // Keys stay with the operator's window (unless the show covers it: one screen only).
  showCoversControls = !target.windowed && target.display?.id === controlDisplay().id;
  if (!showCoversControls) setTimeout(() => controlWin?.focus(), 150);
  await poll();
  return publicShow();
}

async function showCommand(c) {
  const t0 = Date.now();
  if (process.env.MP_SELFTEST) console.log('[cmd]', c.action, 'running', show.running);
  // Black is held (on or off by hand only), even with no show running.
  if (c.action === 'black' || (c.action === 'screen' && (c.s === 3 || c.s === 1))) {
    const on = c.action === 'black' ? !(blackHold || show.state === 3) : c.s === 3;
    await setBlack(on);
    if (!on && show.running && show.state === 4) await ppt.screen(1, true);
    if (show.running) await poll();
    return publicShow();
  }
  if (!show.running) return publicShow();
  switch (c.action) {
    case 'next': await ppt.next(); break;
    case 'prev': await ppt.prev(); break;
    case 'go': await ppt.go(c.n); break;
    case 'first': await ppt.go(1); break;
    case 'last': await ppt.go(show.count || 1); break;
    case 'white': if (blackHold) await setBlack(false); await ppt.screen(4); break;
    // Exactly this screen (from the phone, whose idea of the screen may be a moment old).
    case 'screen': if (c.s === 4) { if (blackHold) await setBlack(false); await ppt.screen(4, true); } break;
    // Back where the show came from: out of a custom show, or to the presentation a link left.
    case 'back':
      if (named && same(named.path, show.path)) { named = null; await ppt.jump('end'); }
      else if (returnTo.length) { cover(true); await ppt.end(); setTimeout(() => cover(false), 4000); }
      break;
    case 'end': endingAll = true; returnTo.length = 0; await ppt.end(); break;
  }
  await poll();
  return show;
}

// A click on the slide in the presenter view becomes a real click on the projector, so links,
// action buttons, video controls and animation triggers all work.
// sx, sy: the spot on the slide (0..1), from the presenter view or the phone.
async function showClick(sx, sy) {
  if (!show.running) return;
  // Links and action buttons, found in the file itself (instant), then done by PowerPoint.
  let hit = { done: false };
  const act = show.slide ? slideLinks.hit(show.path, show.slide, sx, sy) : null;
  if (process.env.MP_SELFTEST) console.log('[link]', JSON.stringify(act));
  if (act) {
    if (act.go) { await ppt.go(act.go); hit = { done: true }; }
    else if (act.jump) {
      // "End show" inside a custom show goes back to its menu slide (PowerPoint's way), not out.
      if (act.jump === 'end') { if (named && same(named.path, show.path)) named = null; else endingAll = !returnTo.length; }
      await ppt.jump(act.jump);
      hit = { done: true };
    }
    else if (act.show) { named = { path: show.path, from: show.slide, name: act.show }; await ppt.namedShow(act.show); hit = { done: true }; }
    else if (act.url) { shell.openExternal(act.url); hit = { done: true }; }
    // A link to a file: a picture, a video, a PDF… opens here. Anything else (a program, a
    // script, a file on another computer) is left to PowerPoint, which asks first.
    else if (act.open && SAFE_OPEN.test(act.open) && !/^\\\\/.test(act.open) && fs.existsSync(act.open)) { shell.openPath(act.open); hit = { done: true }; }
    else if (act.file) hit = { done: false, file: act.file, slide: 1 };
  } else if (act === undefined) {
    // Not a file we can read (an old .ppt): ask PowerPoint what's there.
    hit = await ppt.hit(sx, sy).catch(() => ({ done: false }));
    if (process.env.MP_SELFTEST) console.log('[hit]', JSON.stringify(hit));
  }
  if (hit.done) { poll(); return; }
  if (hit.file) {
    // A link to another presentation: show it, and come back here when it ends.
    if (!fs.existsSync(hit.file)) { controlWin?.webContents.send('notice', { key: 'linkMissing', name: path.basename(hit.file) }); return; }
    returnTo.push({ path: show.path, slide: show.slide, named: named && same(named.path, show.path) ? named : null });
    await startShow(hit.file, hit.slide || 1, { keepReturn: true, notify: true });
    return;
  }
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
  // Started with Windows: stays in the tray until opened.
  controlWin.once('ready-to-show', () => { if (!process.env.MP_SELFTEST_HIDDEN && !tray?.startHidden) controlWin.show(); });
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
  if (k === 'remoteOn') { if (v) hub?.start(); else hub?.stop(); }
});
ipcMain.handle('app-version', () => app.getVersion());
ipcMain.handle('get-displays', () => displaysInfo());

ipcMain.handle('library-load', () => library);
ipcMain.on('library-save', (_e, lib) => {
  if (Array.isArray(lib?.recents)) library.recents = lib.recents;
  if (Array.isArray(lib?.lists)) library.lists = lib.lists;
  if (Array.isArray(lib?.program)) library.program = lib.program.filter(p => typeof p === 'string');
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
// A phone asks to connect: the taskbar button blinks until the window is looked at.
ipcMain.on('flash-window', () => { if (controlWin && !controlWin.isFocused()) controlWin.flashFrame(true); });
// A slide's picture for the phone: a small JPEG as a data URL (it travels over the data channel).
ipcMain.handle('thumb-data', async (_e, file, n, width) => {
  const d = decks.get(String(file).toLowerCase());
  if (!d || !(n >= 1 && n <= d.ready)) return null;
  // Big ones (the phone's live slide) are made sharp, once per slide, at 1280 px.
  let src = path.join(d.dir, `${n}.png`);
  if (width > 480) {
    const big = path.join(d.dir, `big-${n}.png`);
    if (!fs.existsSync(big)) {
      try { await ppt.exportOne(d.info.path, n, big, 1280, Math.round(1280 * d.info.height / d.info.width)); } catch (e) { console.warn('big slide', e.message); }
    }
    if (fs.existsSync(big)) src = big;
  }
  const img = nativeImage.createFromPath(src);
  if (img.isEmpty()) return null;
  const w = Math.max(80, Math.min(1280, width | 0 || 320));
  // One message on the phone's connection holds about 256 KB: busy slides get a lighter JPEG.
  const small = img.resize({ width: w, quality: 'good' });
  const qualities = w > 400 ? [80, 65, 50, 38] : [70, 50];
  for (const q of qualities) {
    const data = small.toJPEG(q).toString('base64');
    if (data.length < 200000 || q === qualities[qualities.length - 1]) return 'data:image/jpeg;base64,' + data;
  }
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

let hub = null;
app.whenReady().then(() => {
  checkPowerPointRunning();
  // ✕ keeps the app running in the tray (a show goes on, the phone still reaches it).
  tray = createTray({ title: APP_NAME, icon: path.join(__dirname, 'assets', 'app-256.png'), settings, save: saveSettings, window: () => controlWin });
  createControl();
  tray.attach(controlWin);
  // The phone link, shared with Ma3madan Play when both are open (hub.js).
  hub = createHub({ app: 'ppt', title: APP_NAME, version: app.getVersion(), window: () => controlWin, computerName: () => require('os').hostname(), phoneDir: path.join(__dirname, 'phone') });
  controlWin.webContents.on('did-finish-load', () => hub.pageReady());
  if (settings.remoteOn && (!process.env.MP_SELFTEST || process.env.MP_LINK_TEST)) hub.start();
  if (process.env.MP_SELFTEST) controlWin.webContents.on('console-message', e => console.log('[page]', e.message));
  if (process.env.MP_SELFTEST) require(process.env.MP_REMOTE_HOST ? '../test/remote-host' : process.env.MP_SHOTS ? '../test/readme-shots' : '../test/selftest')(controlWin, { app, ppt });
  screen.on('display-added', sendDisplays);
  screen.on('display-removed', sendDisplays);
  screen.on('display-metrics-changed', sendDisplays);
  // A screen changed (projector plugged in, scaling or resolution changed) during a show: fill it again.
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(ev, () => { if (show.running) setTimeout(() => placeShow(showTarget()).catch(() => {}), 500); });
  // Start the window helper now, not on the first show: it takes a second or two to load, and
  // a show placed late is one the audience sees jump. Locked-down PCs may not allow it at all.
  ppt.warm().catch(e => { console.warn('window helper', e.message); setTimeout(() => controlWin?.webContents.send('notice', { key: 'winHelperFailed' }), 3000); });
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
  hub?.stop();
  // Close our read-only copies; close PowerPoint only if we started it and it has nothing else open.
  Promise.race([ppt.quit(!powerPointWasRunning), new Promise(r => setTimeout(r, 4000))])
    .catch(() => {})
    .finally(() => { ppt.dispose(); app.quit(); });
});
app.on('window-all-closed', () => app.quit());
