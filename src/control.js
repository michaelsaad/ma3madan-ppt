// The operator's window: library on the side, a presentation's sections and slides, and the
// presenter view while the show runs.
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const baseName = p => p.split(/[\\/]/).pop().replace(/\.(pptx|ppt|ppsx|pps|pptm|ppsm)$/i, '');
const folderOf = p => p.split(/[\\/]/).slice(-2, -1)[0] || '';

let settings = {};
let library = { recents: [], lists: [] };
const open = [];          // open presentations, in tab order: deck info from main (+ ready thumbs)
let active = null;        // path of the presentation on screen
let selected = 1;         // selected slide in the grid
let show = { running: false };
let displays = { displays: [], showOn: 'auto' };
let pvGridOpen = false;
const collapsed = new Set(JSON.parse(localStorage.getItem('collapsedSections') || '[]'));

const deckOf = p => open.find(d => same(d.path, p));
const activeDeck = () => deckOf(active);
const isLive = d => show.running && d && same(show.path, d.path);
const thumbUrl = (d, n) => (d && n <= d.ready ? `${d.thumbs}${n}.png` : '');

// ---------- toast ----------
let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

// ---------- menus ----------
function openMenu(x, y, items) {
  const m = $('menu');
  m.innerHTML = '';
  for (const it of items) {
    if (it === '-') { m.appendChild(document.createElement('hr')); continue; }
    if (it.label) { const l = document.createElement('div'); l.className = 'menu-label'; l.textContent = it.label; m.appendChild(l); continue; }
    const b = document.createElement('button');
    if (it.danger) b.className = 'danger';
    b.innerHTML = `${it.icon ? `<svg><use href="#${it.icon}"/></svg>` : ''}<span>${esc(it.text)}</span>${it.checked ? '<svg class="check"><use href="#i-check"/></svg>' : ''}`;
    b.onclick = () => { closeMenu(); it.run(); };
    m.appendChild(b);
  }
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
}
function closeMenu() { $('menu').hidden = true; }
addEventListener('mousedown', e => { if (!$('menu').hidden && !$('menu').contains(e.target)) closeMenu(); }, true);
addEventListener('blur', closeMenu);

// ---------- modal ----------
function modal(html, onReady) {
  $('modalCard').classList.remove('wide');
  $('modalCard').innerHTML = html;
  $('modal').hidden = false;
  onReady?.($('modalCard'));
}
function closeModal() { $('modal').hidden = true; $('modalCard').classList.remove('wide'); }
$('modal').addEventListener('mousedown', e => { if (e.target === $('modal')) closeModal(); });

function ask(title, value, okText) {
  return new Promise(resolve => {
    modal(`<h3>${esc(title)}</h3><input type="text" id="askInput" value="${esc(value)}">
      <div class="actions"><button id="askCancel">${esc(t('cancel'))}</button><button id="askOk" class="primary">${esc(okText || t('ok'))}</button></div>`, c => {
      const inp = c.querySelector('#askInput');
      inp.focus(); inp.select();
      const done = v => { closeModal(); resolve(v); };
      c.querySelector('#askOk').onclick = () => done(inp.value.trim() || null);
      c.querySelector('#askCancel').onclick = () => done(null);
      inp.onkeydown = e => { if (e.key === 'Enter') done(inp.value.trim() || null); if (e.key === 'Escape') done(null); e.stopPropagation(); };
    });
  });
}

// ---------- library (side panel) ----------
const saveLibrary = () => { api.saveLibrary(library); window.pushRemote?.(); };
const recentOf = p => library.recents.find(r => same(r.path, p));
const listsHolding = p => library.lists.filter(l => l.items.some(x => same(x, p)));
const collapsedGroups = new Set(JSON.parse(localStorage.getItem('collapsedGroups') || '[]'));

function itemThumb(p) {
  const d = deckOf(p);
  if (d && d.ready) return thumbUrl(d, 1);
  const r = recentOf(p);
  return r?.thumb || '';
}

function renderLibrary() {
  const q = $('search').value.trim().toLowerCase();
  const match = p => !q || baseName(p).toLowerCase().includes(q) || p.toLowerCase().includes(q);
  const box = $('library');
  box.innerHTML = '';
  const group = (id, title, icon, paths, opts = {}) => {
    const g = document.createElement('div');
    g.className = 'group' + (collapsedGroups.has(id) && !q ? ' collapsed' : '');
    const head = document.createElement('div');
    head.className = 'group-head';
    head.innerHTML = `<svg class="caret"><use href="#i-caret"/></svg><svg><use href="#${icon}"/></svg><span>${esc(title)}</span><span class="count">${paths.length}</span>` +
      (opts.list ? `<button class="icon ghost more"><svg><use href="#i-more"/></svg></button>` : '');
    head.onclick = e => {
      if (e.target.closest('.more')) return;
      collapsedGroups.has(id) ? collapsedGroups.delete(id) : collapsedGroups.add(id);
      localStorage.setItem('collapsedGroups', JSON.stringify([...collapsedGroups]));
      renderLibrary();
    };
    if (opts.list) {
      head.querySelector('.more').onclick = e => { e.stopPropagation(); listMenu(opts.list, e.clientX, e.clientY); };
      // Drop an item from another group onto a list to add it there.
      head.addEventListener('dragover', e => { if (dragPath) { e.preventDefault(); g.classList.add('drop-target'); } });
      head.addEventListener('dragleave', () => g.classList.remove('drop-target'));
      head.addEventListener('drop', e => { e.preventDefault(); g.classList.remove('drop-target'); if (dragPath) addToList(opts.list, dragPath); });
    }
    g.appendChild(head);
    const body = document.createElement('div');
    body.className = 'group-body';
    const shown = paths.filter(match);
    if (!shown.length) {
      const e = document.createElement('div');
      e.className = 'group-empty';
      e.textContent = q ? t('noMatch') : (opts.list ? t('listEmpty') : t('noRecents'));
      body.appendChild(e);
    }
    for (const p of shown) body.appendChild(itemRow(p, opts.list));
    g.appendChild(body);
    box.appendChild(g);
  };
  group('recents', t('recents'), 'i-recent', library.recents.map(r => r.path));
  for (const l of library.lists) group('list:' + l.id, l.name, 'i-list', l.items, { list: l });
}

let dragPath = null;
function itemRow(p, list) {
  const el = document.createElement('div');
  el.className = 'item' + (same(p, active) ? ' active' : '');
  el.draggable = true;
  const r = recentOf(p);
  const thumb = itemThumb(p);
  const live = show.running && same(show.path, p);
  el.innerHTML = `<div class="thumb" ${thumb ? `style="background-image:url('${thumb.replace(/'/g, '%27')}')"` : ''}></div>
    <div class="meta"><div class="name">${live ? '<span class="live-dot"></span>' : ''}${esc(r?.name ? baseName(r.name) : baseName(p))}</div>
    <div class="sub">${esc(folderOf(p))}${r?.slide > 1 ? ' · ' + esc(t('slideN', { n: r.slide })) : ''}</div></div>
    <button class="icon ghost more"><svg><use href="#i-more"/></svg></button>`;
  el.title = p;
  el.onclick = e => { if (!e.target.closest('.more')) openDeck(p); };
  el.ondblclick = e => { if (!e.target.closest('.more')) openDeck(p).then(ok => ok && startShow(1)); };
  el.querySelector('.more').onclick = e => { e.stopPropagation(); itemMenu(p, list, e.clientX, e.clientY); };
  el.oncontextmenu = e => { e.preventDefault(); itemMenu(p, list, e.clientX, e.clientY); };
  el.ondragstart = e => { dragPath = p; e.dataTransfer.effectAllowed = 'copy'; };
  el.ondragend = () => { dragPath = null; };
  api.fileExists(p).then(ok => { if (!ok) { el.classList.add('missing'); el.querySelector('.sub').textContent = t('fileMissing'); } });
  return el;
}

function itemMenu(p, list, x, y) {
  const items = [
    { text: t('open'), icon: 'i-folder', run: () => openDeck(p) },
    { text: t('fromStart'), icon: 'i-play', run: () => openDeck(p).then(ok => ok && startShow(1)) },
    '-',
    { label: t('addToList') },
    ...library.lists.map(l => ({ text: l.name, icon: 'i-list', checked: l.items.some(x => same(x, p)), run: () => (l.items.some(x => same(x, p)) ? removeFromList(l, p) : addToList(l, p)) })),
    { text: t('newListWith'), icon: 'i-add', run: () => newList(p) },
    '-',
    { text: t('editInPowerPoint'), icon: 'i-pp', run: () => api.openInPowerPoint(p) },
    { text: t('showInFolder'), icon: 'i-folder', run: () => api.showInFolder(p) },
    '-',
    list
      ? { text: t('removeFromList', { name: list.name }), icon: 'i-x', danger: true, run: () => removeFromList(list, p) }
      : { text: t('removeFromRecents'), icon: 'i-x', danger: true, run: () => { library.recents = library.recents.filter(r => !same(r.path, p)); saveLibrary(); renderLibrary(); } },
  ];
  openMenu(x, y, items);
}

function listMenu(l, x, y) {
  const i = library.lists.indexOf(l);
  openMenu(x, y, [
    { text: t('rename'), run: async () => { const n = await ask(t('rename'), l.name); if (n) { l.name = n; saveLibrary(); renderLibrary(); } } },
    ...(i > 0 ? [{ text: t('moveUp'), run: () => { library.lists.splice(i, 1); library.lists.splice(i - 1, 0, l); saveLibrary(); renderLibrary(); } }] : []),
    ...(i < library.lists.length - 1 ? [{ text: t('moveDown'), run: () => { library.lists.splice(i, 1); library.lists.splice(i + 1, 0, l); saveLibrary(); renderLibrary(); } }] : []),
    { text: t('openAll'), run: async () => { for (const p of l.items) await openDeck(p, true); if (l.items[0]) activate(l.items[0]); } },
    '-',
    { text: t('deleteList'), danger: true, run: () => { library.lists = library.lists.filter(x => x !== l); saveLibrary(); renderLibrary(); } },
  ]);
}

function addToList(l, p) {
  if (!l.items.some(x => same(x, p))) { l.items.push(p); saveLibrary(); renderLibrary(); }
  toast(t('addedTo', { name: l.name }));
}
function removeFromList(l, p) { l.items = l.items.filter(x => !same(x, p)); saveLibrary(); renderLibrary(); }
async function newList(withPath) {
  const name = await ask(t('newList'), '', t('create'));
  if (!name) return;
  const l = { id: Date.now().toString(36), name, items: withPath ? [withPath] : [] };
  library.lists.push(l);
  saveLibrary(); renderLibrary();
}

// Remember slide 1 of each presentation as its picture in the library.
function rememberThumb(d) {
  const r = recentOf(d.path);
  if (r && d.ready && r.thumb !== thumbUrl(d, 1)) { r.thumb = thumbUrl(d, 1); saveLibrary(); }
}

// ---------- opening presentations ----------
const opening = new Map();
async function openDeck(p, background) {
  if (deckOf(p)) { if (!background) activate(p); return true; }
  if (!opening.has(p)) {
    opening.set(p, api.openDeck(p));
    if (!background) toast(t('opening', { name: baseName(p) }));
  }
  const r = await opening.get(p);
  opening.delete(p);
  if (!r.ok) {
    toast(r.error === 'missing' ? t('fileMissing') : t('openFailed', { e: r.error }));
    return false;
  }
  if (!deckOf(p)) open.push(r.result);
  $('toast').hidden = true;
  library = await api.loadLibrary(); // main added it to the recents
  if (!background) { selected = recentOf(p)?.slide || 1; activate(r.result.path); }
  else { renderTabs(); renderLibrary(); }
  return true;
}

async function closeDeck(p) {
  const i = open.findIndex(d => same(d.path, p));
  if (i < 0) return;
  open.splice(i, 1);
  await api.closeDeck(p);
  if (same(active, p)) active = open[Math.min(i, open.length - 1)]?.path || null;
  render();
}

function activate(p) {
  active = p;
  pvGridOpen = false;
  render();
}

async function openFiles(paths) {
  let first = true;
  for (const p of paths) { await openDeck(p, !first); first = false; }
}

// ---------- tabs ----------
function renderTabs() {
  const box = $('tabs');
  box.innerHTML = '';
  for (const d of open) {
    const el = document.createElement('div');
    el.className = 'tab' + (same(d.path, active) ? ' active' : '');
    el.title = d.path;
    el.innerHTML = `${isLive(d) ? '<span class="live-dot"></span>' : ''}<span class="name">${esc(baseName(d.name))}</span><button class="x" title="${esc(t('close'))}"><svg><use href="#i-x"/></svg></button>`;
    el.onclick = e => { if (!e.target.closest('.x')) activate(d.path); };
    el.onauxclick = e => { if (e.button === 1) closeDeck(d.path); };
    el.querySelector('.x').onclick = e => { e.stopPropagation(); closeDeck(d.path); };
    box.appendChild(el);
  }
}

// ---------- sections and slides ----------
// Sections as [{ name, first, count, index }]; a presentation without sections is one unnamed section.
function sectionsOf(d) {
  if (d.sections.length) return d.sections.map((s, i) => ({ ...s, index: i + 1 }));
  return [{ name: '', first: 1, count: d.slides.length, index: 1 }];
}
const sectionOfSlide = (d, n) => sectionsOf(d).find(s => n >= s.first && n < s.first + s.count) || sectionsOf(d)[0];

function slideCard(d, s, opts = {}) {
  const el = document.createElement('div');
  const cur = isLive(d) && show.slide === s.index;
  el.className = 'card' + (cur ? ' current' : '') + (!isLive(d) && s.index === selected && !opts.strip ? ' selected' : '') + (s.hidden ? ' hidden-slide' : '');
  el.dataset.n = s.index;
  const src = thumbUrl(d, s.index);
  el.innerHTML = `<div class="pic" ${src ? `style="background-image:url('${src.replace(/'/g, '%27')}')"` : ''}><span class="no">${s.index}</span>${s.clicks ? `<span class="anim" title="${esc(t('tClicks', { n: s.clicks }))}">✦ ${s.clicks}</span>` : ''}</div>
    <div class="cap">${esc(s.title || t('slideN', { n: s.index }))}</div>`;
  el.title = s.title || '';
  el.onclick = () => {
    if (isLive(d)) { api.showCmd({ action: 'go', n: s.index }); if (opts.closeGrid) closePvGrid(); return; }
    selected = s.index;
    for (const c of document.querySelectorAll('#grid .card.selected')) c.classList.remove('selected');
    el.classList.add('selected');
  };
  el.ondblclick = () => { if (!isLive(d)) startShow(s.index); };
  return el;
}

function renderGrid(box, d, opts = {}) {
  const keep = box.scrollTop;
  box.innerHTML = '';
  box.style.setProperty('--ratio', `${d.width}/${d.height}`);
  const secs = sectionsOf(d);
  const curSec = isLive(d) ? sectionOfSlide(d, show.slide) : null;
  for (const sec of secs) {
    const key = d.path.toLowerCase() + '|' + sec.index;
    const wrap = document.createElement('div');
    wrap.className = 'sec' + (collapsed.has(key) ? ' collapsed' : '') + (curSec === sec || curSec?.index === sec.index ? ' current-sec' : '');
    if (sec.name || secs.length > 1) {
      const head = document.createElement('div');
      head.className = 'sec-head';
      head.innerHTML = `<svg class="caret"><use href="#i-caret"/></svg><b>${esc(sec.name || t('untitledSection'))}</b><span class="count">${esc(sec.count === 1 ? t('oneSlide') : t('slidesCount', { n: sec.count }))}</span>
        <button class="sec-play small"><svg><use href="#i-play"/></svg>${esc(isLive(d) ? t('goHere') : t('startHere'))}</button>`;
      head.onclick = e => {
        if (e.target.closest('.sec-play')) {
          if (isLive(d)) { api.showCmd({ action: 'go', n: sec.first }); if (opts.closeGrid) closePvGrid(); }
          else startShow(sec.first);
          return;
        }
        collapsed.has(key) ? collapsed.delete(key) : collapsed.add(key);
        localStorage.setItem('collapsedSections', JSON.stringify([...collapsed]));
        wrap.classList.toggle('collapsed');
      };
      wrap.appendChild(head);
    }
    const grid = document.createElement('div');
    grid.className = 'slides';
    for (let n = sec.first; n < sec.first + sec.count; n++) grid.appendChild(slideCard(d, d.slides[n - 1], opts));
    wrap.appendChild(grid);
    box.appendChild(wrap);
  }
  box.scrollTop = keep;
}

// ---------- screens ("Show on") ----------
function showOnText() {
  const list = displays.displays;
  const d = list.find(x => x.id === displays.showOn);
  if (d) return t('screenN', { n: d.n });
  const other = list.find(x => !x.laptop);
  return other ? t('screenN', { n: other.n }) : t('onThisScreen');
}
function showOnMenu(e) {
  const r = e.currentTarget.getBoundingClientRect();
  const pick = v => { api.setSetting('showOn', v === 'auto' ? undefined : v); displays.showOn = v; renderDeck(); };
  openMenu(r.left, r.bottom + 4, [
    { label: t('showOn') },
    { text: t('automatic'), checked: displays.showOn === 'auto' || displays.showOn == null, run: () => pick('auto') },
    ...displays.displays.map(d => ({ text: `${t('screenN', { n: d.n })}${d.laptop ? ' — ' + t('thisScreen') : ''} (${d.w}×${d.h})`, icon: 'i-screens', checked: displays.showOn === d.id, run: () => pick(d.id) })),
  ]);
}

// ---------- the deck view ----------
function renderDeck() {
  const d = activeDeck();
  if (!d) return;
  $('deckName').textContent = baseName(d.name);
  const secs = d.sections.length;
  $('deckMeta').textContent = [t('slidesCount', { n: d.slides.length }), secs ? (secs === 1 ? t('oneSection') : t('sectionsCount', { n: secs })) : ''].filter(Boolean).join(' · ');
  $('showOnLabel').textContent = showOnText();
  renderGrid($('grid'), d);
}

// ---------- presenter view ----------
let liveSource = null, liveStream = null;
async function setLive(sourceId) {
  if (sourceId === liveSource) return;
  liveSource = sourceId;
  liveStream?.getTracks().forEach(tr => tr.stop());
  liveStream = null;
  $('live').srcObject = null;
  $('current').classList.remove('has-live');
  if (!sourceId) return;
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxWidth: 1920, maxHeight: 1080, maxFrameRate: 30 } },
    });
    if (liveSource !== sourceId) { s.getTracks().forEach(tr => tr.stop()); return; }
    liveStream = s;
    $('live').srcObject = s;
    $('current').classList.add('has-live');
    s.getVideoTracks()[0].onended = () => { if (liveSource === sourceId) { liveSource = null; $('current').classList.remove('has-live'); } };
  } catch (e) {
    console.warn('live view', e);
  }
}

function renderPresenter() {
  const d = activeDeck();
  if (!d || !isLive(d)) return;
  const n = show.slide || 0, count = d.slides.length;
  const slide = d.slides[n - 1];
  $('pvDeck').textContent = baseName(d.name);
  $('currentImg').src = n ? thumbUrl(d, n) : '';
  if (document.activeElement !== $('slideNo')) $('slideNo').value = n || '—';
  $('slideCount').textContent = `/ ${count}`;
  // Black / white screen
  const badge = $('screenBadge');
  badge.hidden = !(show.state === 3 || show.state === 4);
  badge.className = 'screen-badge' + (show.state === 4 ? ' white' : '');
  badge.textContent = show.state === 4 ? t('whiteOn') : t('blackOn');
  $('blackBtn').classList.toggle('on', show.state === 3);
  $('whiteBtn').classList.toggle('on', show.state === 4);
  // Next: another animation step on this slide, or the next visible slide.
  const stepsLeft = (show.clicks || 0) - (show.click || 0);
  let nextN = n + 1;
  while (nextN <= count && d.slides[nextN - 1].hidden) nextN++;
  if (n && stepsLeft > 0) {
    $('nextImg').src = thumbUrl(d, n);
    $('nextInfo').textContent = t('nextClick', { a: (show.click || 0) + 1, b: show.clicks });
    $('nextEnd').hidden = true;
  } else if (n && nextN <= count) {
    $('nextImg').src = thumbUrl(d, nextN);
    $('nextInfo').textContent = t('slideN', { n: nextN });
    $('nextEnd').hidden = true;
  } else {
    $('nextImg').removeAttribute('src');
    $('nextInfo').textContent = '';
    $('nextEnd').hidden = false;
  }
  $('notes').textContent = slide?.notes || '';
  $('notes').dataset.empty = t('noNotes');
  renderStrip(d);
  if (pvGridOpen) renderGrid($('pvGridBody'), d, { closeGrid: true });
}

// The current section's slides under the live slide, with the sections as chips.
let stripKey = '';
function renderStrip(d) {
  const sec = sectionOfSlide(d, show.slide || 1);
  const key = `${d.path}|${sec.index}|${show.slide}|${d.ready}`;
  if (key === stripKey) return;
  stripKey = key;
  const box = $('strip');
  box.innerHTML = '';
  const secs = sectionsOf(d);
  if (secs.length > 1) {
    for (const s of secs) {
      const chip = document.createElement('div');
      chip.className = 'sec-chip' + (s.index === sec.index ? ' current' : '');
      chip.textContent = s.name || t('untitledSection');
      chip.title = t('goToSection', { name: s.name });
      chip.onclick = () => api.showCmd({ action: 'go', n: s.first });
      box.appendChild(chip);
      if (s.index === sec.index) for (let n = s.first; n < s.first + s.count; n++) box.appendChild(slideCard(d, d.slides[n - 1], { strip: true }));
    }
  } else {
    for (const s of d.slides) box.appendChild(slideCard(d, s, { strip: true }));
  }
  box.querySelector('.card.current')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

function openPvGrid() { pvGridOpen = true; $('pvGrid').hidden = false; renderGrid($('pvGridBody'), activeDeck(), { closeGrid: true }); $('pvGridBody').querySelector('.card.current')?.scrollIntoView({ block: 'center' }); }
function closePvGrid() { pvGridOpen = false; $('pvGrid').hidden = true; }

// Click on the live slide → the same spot on the projector (links, buttons, videos, triggers).
$('current').addEventListener('click', e => {
  const d = activeDeck();
  if (!d || !isLive(d)) return;
  const box = $('current').getBoundingClientRect();
  // The slide sits letterboxed (object-fit: contain) inside the box: the show window has the screen's shape.
  // The slide's own shape when the live picture isn't there (the slide image is shown then).
  const v = $('live');
  const hasLive = $('current').classList.contains('has-live') && v.videoWidth && v.videoHeight;
  const slide = d.width / d.height;
  const ratio = hasLive ? v.videoWidth / v.videoHeight : slide;
  let w = box.width, h = box.width / ratio;
  if (h > box.height) { h = box.height; w = h * ratio; }
  const x0 = box.left + (box.width - w) / 2, y0 = box.top + (box.height - h) / 2;
  let sx = (e.clientX - x0) / w, sy = (e.clientY - y0) / h;
  // In the live picture, the slide sits letterboxed inside the screen's shape.
  if (ratio > slide) { const k = slide / ratio; sx = (sx - (1 - k) / 2) / k; } else if (ratio < slide) { const k = ratio / slide; sy = (sy - (1 - k) / 2) / k; }
  if (sx < 0 || sx > 1 || sy < 0 || sy > 1) return;
  api.showClick(sx, sy);
});

// ---------- timer and clock ----------
let timerStart = null, timerPaused = 0, timerPausedAt = null;
function timerText() {
  if (!timerStart) return '0:00';
  const now = timerPausedAt || Date.now();
  const s = Math.max(0, Math.floor((now - timerStart - timerPaused) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(sec).padStart(2, '0')}`;
}
setInterval(() => {
  $('elapsed').textContent = timerText();
  $('clock').textContent = new Date().toLocaleTimeString(LANG === 'ar' ? 'ar-EG' : [], { hour: 'numeric', minute: '2-digit' });
}, 500);
$('timerPause').onclick = () => {
  if (timerPausedAt) { timerPaused += Date.now() - timerPausedAt; timerPausedAt = null; }
  else timerPausedAt = Date.now();
  $('timerPause').querySelector('use').setAttribute('href', timerPausedAt ? '#i-play' : '#i-pause');
  $('elapsed').parentElement.classList.toggle('paused', !!timerPausedAt);
  window.pushRemote?.();
};
$('timerReset').onclick = () => { timerStart = Date.now(); timerPaused = 0; if (timerPausedAt) timerPausedAt = Date.now(); window.pushRemote?.(); };

// ---------- the show ----------
async function startShow(from) {
  const d = activeDeck();
  if (!d) return;
  toast(t('starting'));
  const r = await api.startShow(d.path, from || 1);
  $('toast').hidden = true;
  if (!r.ok) { toast(t('startFailed', { e: r.error })); return; }
  timerStart = Date.now(); timerPaused = 0; timerPausedAt = null;
  onShow(r.result);
}

function onShow(s) {
  const was = show;
  show = s;
  // The timer runs for the whole show, however it was started (here, the phone, PowerPoint).
  if (s.running && !timerStart) { timerStart = Date.now(); timerPaused = 0; timerPausedAt = null; }
  if (!s.running && was.running) timerStart = null;
  // The show moved to another open presentation (or one we haven't opened): follow it.
  if (s.running && s.path && !same(s.path, active)) {
    if (deckOf(s.path)) active = deckOf(s.path).path;
  }
  if (s.running) setLive(s.sourceId);
  else setLive(null);
  if (was.running !== s.running || !same(was.path, s.path)) render();
  else { renderPresenter(); }
  window.pushRemote?.();
}

function render() {
  const d = activeDeck();
  const live = isLive(d);
  $('empty').hidden = !!d;
  $('deckView').hidden = !d || live;
  $('presenter').hidden = !live;
  if (!live) closePvGrid();
  renderTabs();
  renderLibrary();
  if (d && !live) renderDeck();
  if (live) { stripKey = ''; renderPresenter(); }
  window.pushRemote?.();
}

const cmd = action => api.showCmd({ action });
$('nextBtn').onclick = () => cmd('next');
$('prevBtn').onclick = () => cmd('prev');
$('blackBtn').onclick = () => cmd('black');
$('whiteBtn').onclick = () => cmd('white');
$('endBtn').onclick = () => cmd('end');
$('gridBtn').onclick = () => (pvGridOpen ? closePvGrid() : openPvGrid());
$('pvGridClose').onclick = closePvGrid;
$('startBtn').onclick = () => startShow(1);
$('startHereBtn').onclick = () => startShow(selected);
$('showOnBtn').onclick = showOnMenu;
$('slideNo').addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') { const n = parseInt($('slideNo').value, 10); if (n > 0) api.showCmd({ action: 'go', n }); $('slideNo').blur(); }
  if (e.key === 'Escape') $('slideNo').blur();
});
$('slideNo').addEventListener('focus', () => $('slideNo').select());
$('slideNo').addEventListener('blur', () => renderPresenter());

function setNotesSize(px) {
  settings.notesSize = Math.max(12, Math.min(48, px));
  document.documentElement.style.setProperty('--notes-size', settings.notesSize + 'px');
  api.setSetting('notesSize', settings.notesSize);
}
$('notesUp').onclick = () => setNotesSize((settings.notesSize || 18) + 2);
$('notesDown').onclick = () => setNotesSize((settings.notesSize || 18) - 2);

$('gridSize').addEventListener('input', () => {
  document.documentElement.style.setProperty('--thumb', $('gridSize').value + 'px');
  api.setSetting('thumbSize', +$('gridSize').value);
});

// ---------- keyboard ----------
let typedNumber = '', typedTimer;
addEventListener('keydown', e => {
  if (!$('modal').hidden) { if (e.key === 'Escape') closeModal(); return; }
  if (e.target.matches('input, textarea, select')) return;
  if (!$('menu').hidden && e.key === 'Escape') { closeMenu(); return; }
  const d = activeDeck();
  const live = isLive(d);
  const k = e.key;
  if (e.ctrlKey && (k === 'o' || k === 'O')) { e.preventDefault(); $('openBtn').click(); return; }
  if (e.ctrlKey && (k === 'b' || k === 'B')) { e.preventDefault(); toggleSidebar(); return; }
  if (e.ctrlKey && k === 'Tab' && open.length > 1) {
    e.preventDefault();
    const i = open.findIndex(x => same(x.path, active));
    activate(open[(i + (e.shiftKey ? -1 : 1) + open.length) % open.length].path);
    return;
  }
  if (k === '?' ) { showKeys(); return; }
  if (k === 'F5') { e.preventDefault(); if (d && !live) startShow(e.shiftKey ? selected : 1); return; }
  if (!live) {
    if (!d) return;
    const n = d.slides.length;
    const move = to => { selected = Math.max(1, Math.min(n, to)); renderDeck(); $('grid').querySelector('.card.selected')?.scrollIntoView({ block: 'nearest' }); };
    if (k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); move(selected + 1); }
    else if (k === 'ArrowLeft' || k === 'ArrowUp') { e.preventDefault(); move(selected - 1); }
    else if (k === 'Home') move(1);
    else if (k === 'End') move(n);
    else if (k === 'Enter') startShow(selected);
    return;
  }
  // presenting
  if (/^\d$/.test(k)) { typedNumber += k; clearTimeout(typedTimer); typedTimer = setTimeout(() => { typedNumber = ''; }, 1500); return; }
  if (k === 'Enter' && typedNumber) { api.showCmd({ action: 'go', n: +typedNumber }); typedNumber = ''; return; }
  const fwd = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N'];
  const back = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'];
  if (fwd.includes(k)) { e.preventDefault(); cmd('next'); }
  else if (back.includes(k)) { e.preventDefault(); cmd('prev'); }
  else if (k === 'Home') cmd('first');
  else if (k === 'End') cmd('last');
  else if (k === 'b' || k === 'B' || k === '.') cmd('black');
  else if (k === 'w' || k === 'W' || k === ',') cmd('white');
  else if (k === 'g' || k === 'G' || k === '-') (pvGridOpen ? closePvGrid() : openPvGrid());
  else if (k === 'Escape') { if (pvGridOpen) closePvGrid(); else cmd('end'); }
});

function showKeys() {
  const row = (keys, text) => `<div>${keys.map(k => `<kbd>${esc(k)}</kbd>`).join(' ')}</div><div>${esc(text)}</div>`;
  modal(`<h3>${esc(t('shortcuts'))}</h3><div class="keys">
    ${row(['F5'], t('kStart'))}${row(['Shift', 'F5'], t('kStartHere'))}
    ${row(['→', 'Space', 'PgDn'], t('kNext'))}${row(['←', 'PgUp'], t('kPrev'))}
    ${row(['5', 'Enter'], t('kGoTo'))}${row(['Home', 'End'], t('kFirstLast'))}
    ${row(['G'], t('kGrid'))}${row(['B'], t('kBlack'))}${row(['W'], t('kWhite'))}${row(['Esc'], t('kEnd'))}
    ${row(['Ctrl', 'O'], t('kOpen'))}${row(['Ctrl', 'Tab'], t('kTabs'))}${row(['Ctrl', 'B'], t('kSidebar'))}
  </div><div class="actions"><button class="primary" id="mClose">${esc(t('ok'))}</button></div>`, c => { c.querySelector('#mClose').onclick = closeModal; });
}
$('keysBtn').onclick = showKeys;

// ---------- side panel: show/hide, resize ----------
function toggleSidebar() {
  settings.sidebarHidden = !settings.sidebarHidden;
  document.body.classList.toggle('side-hidden', settings.sidebarHidden);
  api.setSetting('sidebarHidden', settings.sidebarHidden);
}
$('sidebarBtn').onclick = toggleSidebar;
(() => {
  const grip = $('sideGrip');
  let startX = 0, startW = 0;
  const setW = w => { settings.sidebarWidth = Math.max(240, Math.min(520, w)); document.documentElement.style.setProperty('--side-w', settings.sidebarWidth + 'px'); };
  grip.addEventListener('pointerdown', e => {
    startX = e.clientX; startW = $('side').getBoundingClientRect().width;
    grip.setPointerCapture(e.pointerId);
    const move = ev => setW(startW + (document.documentElement.dir === 'rtl' ? startX - ev.clientX : ev.clientX - startX));
    const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); api.setSetting('sidebarWidth', settings.sidebarWidth); };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });
  grip.addEventListener('dblclick', () => { setW(300); api.setSetting('sidebarWidth', 300); });
})();

// ---------- open, drop ----------
$('openBtn').onclick = async () => { const files = await api.pickDecks(t('open')); if (files.length) openFiles(files); };
$('newListBtn').onclick = () => newList();
$('search').addEventListener('input', renderLibrary);
$('search').addEventListener('keydown', e => { if (e.key === 'Escape') { $('search').value = ''; renderLibrary(); $('search').blur(); } });

let dragDepth = 0;
const isFileDrag = e => [...(e.dataTransfer?.types || [])].includes('Files');
addEventListener('dragenter', e => { if (isFileDrag(e)) { dragDepth++; document.body.classList.add('dragging'); } });
addEventListener('dragleave', e => { if (isFileDrag(e) && --dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
addEventListener('dragover', e => { if (isFileDrag(e)) e.preventDefault(); });
addEventListener('drop', e => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth = 0; document.body.classList.remove('dragging');
  const files = [...e.dataTransfer.files].map(f => api.pathForFile(f)).filter(p => /\.(pptx|ppt|ppsx|pps|pptm|ppsm)$/i.test(p));
  if (files.length) openFiles(files); else toast(t('notPowerPoint'));
});

// ---------- settings, about, updates ----------
function settingsModal() {
  const seg = (name, options, value) => `<div class="seg" data-name="${name}">${options.map(([v, label]) => `<button data-v="${v}" class="${v === value ? 'on' : ''}">${esc(label)}</button>`).join('')}</div>`;
  modal(`<h3>${esc(t('settings'))}</h3>
    <div class="row"><span>${esc(t('language'))}</span>${seg('lang', [['en', 'English'], ['ar', 'العربية']], LANG)}</div>
    <div class="row"><span>${esc(t('theme'))}</span>${seg('theme', [['system', t('themeSystem')], ['light', t('themeLight')], ['dark', t('themeDark')]], settings.theme || 'system')}</div>
    <div class="actions"><button class="primary" id="mClose">${esc(t('ok'))}</button></div>`, c => {
    c.querySelector('#mClose').onclick = closeModal;
    c.querySelectorAll('.seg button').forEach(b => b.onclick = () => {
      const name = b.parentElement.dataset.name, v = b.dataset.v;
      b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      settings[name] = v; api.setSetting(name, v);
      if (name === 'lang') { applyLang(v); render(); settingsModal(); }
    });
  });
}
$('settingsBtn').onclick = settingsModal;

$('aboutBtn').onclick = async () => {
  const v = await api.appVersion();
  modal(`<h3><img src="assets/app-128.png" alt="">${esc(t('appName'))} <span class="muted" style="font-weight:400;font-size:13px">${esc(v)}</span></h3>
    <p>${esc(t('aboutName'))}</p>
    <p>${esc(t('aboutText'))}</p>
    <ul><li>${esc(t('aboutF1'))}</li><li>${esc(t('aboutF2'))}</li><li>${esc(t('aboutF3'))}</li><li>${esc(t('aboutF4'))}</li></ul>
    <div class="actions"><button id="mGithub" class="ghost">${esc(t('aboutGithub'))}</button><button class="primary" id="mClose">${esc(t('ok'))}</button></div>`, c => {
    c.querySelector('#mClose').onclick = closeModal;
    c.querySelector('#mGithub').onclick = () => window.open('https://github.com/michaelsaad/ma3madan-ppt');
  });
};

api.onUpdateAvailable(info => { $('updateBtn').hidden = false; $('updateBtn').title = t('updateTo', { v: info.version }); });
api.onUpdateProgress(p => { $('updateBtn').querySelector('span').textContent = `${Math.round(p * 100)}%`; });
$('updateBtn').onclick = async () => {
  if (show.running) { toast(t('updateLater')); return; }
  const r = await api.installUpdate();
  if (!r.ok) toast(r.error);
};

// ---------- events from main ----------
api.onShowState(onShow);
// A link in the slides opened another presentation: it joins the tabs, and the view follows the show.
api.onDeckOpened(d => {
  if (!d?.path) return;
  if (!deckOf(d.path)) open.push(d);
  if (show.running && same(show.path, d.path)) active = deckOf(d.path).path;
  api.loadLibrary().then(lib => { library = lib; render(); });
});
api.onNotice(n => toast(t(n.key, n)));
api.onThumbs(({ path: p, ready }) => {
  const d = deckOf(p);
  if (!d) return;
  d.ready = ready;
  if (ready >= 1) rememberThumb(d);
  if (same(p, active)) { if (isLive(d)) { stripKey = ''; renderPresenter(); } else renderDeck(); }
  if (ready === 1 || ready === d.slides.length) { renderLibrary(); }
  window.pushRemote?.();
});
api.onDisplays(info => { displays = info; if (activeDeck() && !isLive(activeDeck())) $('showOnLabel').textContent = showOnText(); });
api.onOpenFiles(openFiles);

// ---------- start ----------
// Start once every script on the page has loaded (remote.js comes after this file).
addEventListener('DOMContentLoaded', async () => {
  settings = await api.getSettings();
  applyLang(settings.lang || 'en');
  if (settings.sidebarHidden) document.body.classList.add('side-hidden');
  if (settings.sidebarWidth) document.documentElement.style.setProperty('--side-w', settings.sidebarWidth + 'px');
  document.documentElement.style.setProperty('--notes-size', (settings.notesSize || 18) + 'px');
  $('gridSize').value = settings.thumbSize || 220;
  document.documentElement.style.setProperty('--thumb', $('gridSize').value + 'px');
  library = await api.loadLibrary();
  displays = await api.getDisplays();
  render();
  const files = await api.takeOpenFiles();
  if (files.length) openFiles(files);
  const s = await api.showState();
  if (s.running) onShow(s);
  initRemote();
});
