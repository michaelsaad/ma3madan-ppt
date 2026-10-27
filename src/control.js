// The operator's window: the program and the library on one side, the sections on the other, and
// in the middle a presentation's slides, or the presenter view while it's on the screen.
//
// What's on the screen (the show) and what's looked at here (`active`) are kept apart: looking at
// another presentation never changes what the audience sees, the keys always drive the show, and
// only "Show" (with a question when another one is on) puts something else on the screen.
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const baseName = p => p.split(/[\\/]/).pop().replace(/\.(pptx|ppt|ppsx|pps|pptm|ppsm)$/i, '');
const folderOf = p => p.split(/[\\/]/).slice(-2, -1)[0] || '';

let settings = {};
let library = { recents: [], lists: [], program: [] };
const open = [];          // presentations read so far: deck info from main (+ ready thumbs)
let active = null;        // path of the presentation looked at here (the live one, or another)
let selected = 1;         // selected slide in the grid
let show = { running: false };
let displays = { displays: [], showOn: 'auto' };
let pvGridOpen = false;
// Sections start closed, the one on the projector marked; open them by hand. Open is open
// everywhere: the sections panel, the slide grid and "All slides" (per presentation).
const expandedSecs = new Set();
try { localStorage.removeItem('collapsedSections'); } catch {}

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
let onModalClose = null;
function closeModal() {
  $('modal').hidden = true; $('modalCard').classList.remove('wide');
  const f = onModalClose; onModalClose = null; f?.();
}
$('modal').addEventListener('mousedown', e => { if (e.target === $('modal')) closeModal(); });

// A yes/no question; Esc, a click outside or Cancel are "no".
function confirmAsk(title, text, okText, danger) {
  return new Promise(resolve => {
    modal(`<h3>${esc(title)}</h3><p>${esc(text)}</p>
      <div class="actions"><button id="cNo">${esc(t('cancel'))}</button><button id="cYes" class="${danger ? 'danger-fill' : 'primary'}">${esc(okText)}</button></div>`, c => {
      onModalClose = () => resolve(false);
      c.querySelector('#cNo').onclick = closeModal;
      c.querySelector('#cYes').onclick = () => { onModalClose = null; closeModal(); resolve(true); };
      c.querySelector('#cYes').focus();
    });
  });
}
// Putting another presentation on the screen while one is showing: ask first.
function confirmReplace(p) {
  if (!show.running || same(show.path, p)) return Promise.resolve(true);
  return confirmAsk(t('replaceTitle'), t('replaceQ', { a: baseName(show.path), b: baseName(p) }), t('showIt'));
}

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

// ---------- the program: tonight's presentations, in order ----------
const inProgram = p => library.program.some(x => same(x, p));
function addToProgram(p, quiet) {
  if (inProgram(p)) return;
  library.program.push(p);
  saveLibrary(); renderLibrary();
  if (!quiet) toast(t('addedToProgram', { name: baseName(p) }));
}
// The one after the live presentation in the program: "next".
function upNext() {
  if (!show.running) return null;
  const i = library.program.findIndex(x => same(x, show.path));
  return i >= 0 ? library.program[i + 1] || null : null;
}
async function removeFromProgram(p) {
  if (show.running && same(show.path, p)) {
    if (!(await confirmAsk(t('removeLiveTitle'), t('removeLiveQ', { name: baseName(p) }), t('endAndRemove'), true))) return;
    await api.showCmd({ action: 'end' });
  }
  const i = library.program.findIndex(x => same(x, p));
  if (i >= 0) library.program.splice(i, 1);
  saveLibrary();
  // Closed in PowerPoint too (it's read again, quickly, if it's opened later).
  const k = open.findIndex(d => same(d.path, p));
  if (k >= 0 && !(show.running && same(show.path, p))) { open.splice(k, 1); api.closeDeck(p); }
  if (same(active, p)) active = (show.running && deckOf(show.path)?.path) || library.program[Math.min(i, library.program.length - 1)] || null;
  if (active && !deckOf(active)) { const a = active; active = null; openDeck(a); }
  render();
}
function moveInProgram(p, before) {
  const from = library.program.findIndex(x => same(x, p));
  if (from < 0 || same(p, before)) return;
  library.program.splice(from, 1);
  const to = before ? library.program.findIndex(x => same(x, before)) : -1;
  library.program.splice(to < 0 ? library.program.length : to, 0, p);
  saveLibrary(); renderLibrary();
}
function programMenu(x, y) {
  openMenu(x, y, [
    { text: t('saveProgramAsList'), icon: 'i-list', run: async () => {
      if (!library.program.length) return;
      const name = await ask(t('newList'), '', t('create'));
      if (name) { library.lists.push({ id: Date.now().toString(36), name, items: [...library.program] }); saveLibrary(); renderLibrary(); }
    } },
    '-',
    { text: t('clearProgram'), icon: 'i-x', danger: true, run: async () => {
      if (!library.program.length || !(await confirmAsk(t('clearProgram'), t('clearProgramQ'), t('clearProgram'), true))) return;
      for (const p of [...library.program]) if (!(show.running && same(show.path, p))) await removeFromProgram(p);
    } },
  ]);
}
// A saved list becomes tonight's program (the one on the screen stays in it).
async function useAsProgram(l) {
  if (library.program.length && !(await confirmAsk(t('useAsProgram'), t('useAsProgramQ', { name: l.name }), t('useAsProgram')))) return;
  const keep = show.running ? library.program.filter(p => same(p, show.path)) : [];
  library.program = [...keep, ...l.items.filter(p => !keep.some(k => same(k, p)))];
  saveLibrary();
  if (!active || !inProgram(active)) { if (library.program[0]) await openDeck(library.program[0]); }
  render();
}

function renderLibrary() {
  const q = $('search').value.trim().toLowerCase();
  const match = p => !q || baseName(p).toLowerCase().includes(q) || p.toLowerCase().includes(q);
  const box = $('library');
  box.innerHTML = '';
  const group = (id, title, icon, paths, opts = {}) => {
    const g = document.createElement('div');
    g.className = 'group' + (opts.program ? ' program' : '') + (collapsedGroups.has(id) && !q ? ' collapsed' : '');
    const head = document.createElement('div');
    head.className = 'group-head';
    head.innerHTML = `<svg class="caret"><use href="#i-caret"/></svg><svg><use href="#${icon}"/></svg><span>${esc(title)}</span><span class="count">${paths.length}</span>` +
      (opts.list || opts.program ? `<button class="icon ghost more"><svg><use href="#i-more"/></svg></button>` : '');
    head.onclick = e => {
      if (e.target.closest('.more')) return;
      collapsedGroups.has(id) ? collapsedGroups.delete(id) : collapsedGroups.add(id);
      localStorage.setItem('collapsedGroups', JSON.stringify([...collapsedGroups]));
      renderLibrary();
    };
    if (opts.program) {
      head.querySelector('.more').onclick = e => { e.stopPropagation(); programMenu(e.clientX, e.clientY); };
      // Drop a presentation from the recents or a list on the program's title: it joins at the end.
      head.addEventListener('dragover', e => { if (dragPath) { e.preventDefault(); g.classList.add('drop-target'); } });
      head.addEventListener('dragleave', () => g.classList.remove('drop-target'));
      head.addEventListener('drop', e => { e.preventDefault(); g.classList.remove('drop-target'); if (dragPath) { inProgram(dragPath) ? moveInProgram(dragPath, null) : addToProgram(dragPath); } });
    }
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
      e.textContent = q ? t('noMatch') : opts.program ? t('programEmpty') : (opts.list ? t('listEmpty') : t('noRecents'));
      body.appendChild(e);
    }
    shown.forEach((p, i) => body.appendChild(itemRow(p, opts.list, opts.program ? i + 1 : 0)));
    g.appendChild(body);
    box.appendChild(g);
  };
  group('program', t('program'), 'i-play', library.program, { program: true });
  group('recents', t('recents'), 'i-recent', library.recents.map(r => r.path));
  for (const l of library.lists) group('list:' + l.id, l.name, 'i-list', l.items, { list: l });
}

// A presentation in the side panel. A click looks at it (never changes the screen), a double
// click shows it (asking first when another one is showing). In the program: its place in the
// order, "next" after the live one, drag to reorder, × to take it out.
let dragPath = null;
function itemRow(p, list, order) {
  const el = document.createElement('div');
  const live = show.running && same(show.path, p);
  el.className = 'item' + (order ? ' prog' : '') + (live ? ' live-row' : '') + (same(p, active) ? ' active' : '');
  el.draggable = true;
  const r = recentOf(p);
  const thumb = itemThumb(p);
  const next = order && same(upNext(), p);
  el.innerHTML = `${order ? `<span class="order">${order}</span>` : ''}<div class="thumb" ${thumb ? `style="background-image:url('${thumb.replace(/'/g, '%27')}')"` : ''}></div>
    <div class="meta"><div class="name">${live ? '<span class="live-dot"></span>' : ''}${esc(r?.name ? baseName(r.name) : baseName(p))}${next ? `<span class="badge next">${esc(t('upNext'))}</span>` : ''}</div>
    <div class="sub">${esc(folderOf(p))}${r?.slide > 1 ? ' · ' + esc(t('slideN', { n: r.slide })) : ''}</div></div>
    <span class="acts">${order ? `<button class="icon ghost add x-prog" title="${esc(t('removeFromProgram'))}"><svg><use href="#i-x"/></svg></button>`
      : !inProgram(p) ? `<button class="icon ghost add to-prog" title="${esc(t('addToProgram'))}"><svg><use href="#i-add"/></svg></button>` : ''}<button class="icon ghost more"><svg><use href="#i-more"/></svg></button></span>`;
  el.title = p;
  el.onclick = e => { if (!e.target.closest('.acts')) openDeck(p); };
  el.ondblclick = e => { if (!e.target.closest('.acts')) openDeck(p).then(ok => ok && startShow(recentOf(p)?.slide || 1, p)); };
  el.querySelector('.x-prog')?.addEventListener('click', e => { e.stopPropagation(); removeFromProgram(p); });
  el.querySelector('.to-prog')?.addEventListener('click', e => { e.stopPropagation(); addToProgram(p); });
  el.querySelector('.more').onclick = e => { e.stopPropagation(); itemMenu(p, list, e.clientX, e.clientY); };
  el.oncontextmenu = e => { e.preventDefault(); itemMenu(p, list, e.clientX, e.clientY); };
  el.ondragstart = e => { dragPath = p; e.dataTransfer.effectAllowed = 'copyMove'; };
  el.ondragend = () => { dragPath = null; };
  if (order) {
    // Reorder: drop on a row puts the dragged one before it.
    el.addEventListener('dragover', e => { if (dragPath && !same(dragPath, p)) { e.preventDefault(); el.classList.add('drop-before'); } });
    el.addEventListener('dragleave', () => el.classList.remove('drop-before'));
    el.addEventListener('drop', e => {
      e.preventDefault(); el.classList.remove('drop-before');
      if (!dragPath) return;
      if (!inProgram(dragPath)) library.program.push(dragPath);
      moveInProgram(dragPath, p);
    });
  }
  api.fileExists(p).then(ok => { if (!ok) { el.classList.add('missing'); el.querySelector('.sub').textContent = t('fileMissing'); } });
  return el;
}

function itemMenu(p, list, x, y) {
  const items = [
    { text: t('look'), icon: 'i-folder', run: () => openDeck(p) },
    { text: t('showFromStart'), icon: 'i-play', run: () => openDeck(p).then(ok => ok && startShow(1, p)) },
    inProgram(p)
      ? { text: t('removeFromProgram'), icon: 'i-x', run: () => removeFromProgram(p) }
      : { text: t('addToProgram'), icon: 'i-add', run: () => addToProgram(p) },
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
    { text: t('useAsProgram'), icon: 'i-play', run: () => useAsProgram(l) },
    { text: t('addAllToProgram'), icon: 'i-add', run: () => { for (const p of l.items) addToProgram(p, true); toast(t('addedToProgram', { name: l.name })); } },
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
// Opening reads a presentation and shows it here (unless `background`); it never changes the screen.
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
  const program = library.program;
  library = await api.loadLibrary(); // main added it to the recents
  library.program = program;
  if (!background) { selected = recentOf(p)?.slide || 1; activate(r.result.path); }
  else renderLibrary();
  return true;
}

function activate(p) {
  active = p;
  pvGridOpen = false;
  render();
}

// Files opened on purpose (Open, dropped, from Explorer) join the program.
async function openFiles(paths) {
  let first = true;
  for (const p of paths) { if (await openDeck(p, !first)) addToProgram(p, true); first = false; }
}

// ---------- "On screen": what the audience sees, from anywhere in the window ----------
function renderOnAir() {
  $('blackPill').hidden = !(show.black || (show.running && show.state === 3));
  const on = show.running;
  $('onAir').hidden = !on;
  document.body.classList.toggle('previewing', on && !same(active, show.path));
  if (!on) return;
  const d = deckOf(show.path);
  const parts = [`<b>${esc(d ? baseName(d.name) : baseName(show.path || ''))}</b>`];
  if (show.named) parts.push(`<span class="named">${esc(show.named)}</span>`);
  const sec = d && show.slide && d.sections.length ? sectionOfSlide(d, show.slide) : null;
  if (sec?.name) parts.push(esc(sec.name));
  parts.push(esc(show.slide ? t('slideOf', { n: show.slide, c: show.count || d?.slides.length || '' }) : t('endScreen')));
  if (show.state === 4) parts.push(`<span class="named">${esc(show.state === 4 ? t('whiteOn') : t('blackOn'))}</span>`);
  $('crumb').innerHTML = parts.join('<span class="sep">›</span>');
  // The way back: out of a custom show, or to the presentation a link came from.
  const back = show.named ? t('leaveNamed', { name: show.named }) : show.chain?.length ? t('backTo', { name: baseName(show.chain[show.chain.length - 1].path) }) : '';
  $('chainBtn').hidden = !back;
  $('chainBtn').querySelector('span').textContent = back;
  $('chainBtn').title = back;
}
$('onAirBtn').onclick = () => { if (show.running && deckOf(show.path)) activate(deckOf(show.path).path); };
$('chainBtn').onclick = () => api.showCmd({ action: 'back' });

// ---------- sections and slides ----------
// Sections as [{ name, first, count, index }]; a presentation without sections is one unnamed section.
function sectionsOf(d) {
  if (d.sections.length) return d.sections.map((s, i) => ({ ...s, index: i + 1 }));
  return [{ name: '', first: 1, count: d.slides.length, index: 1 }];
}
const sectionOfSlide = (d, n) => sectionsOf(d).find(s => n >= s.first && n < s.first + s.count) || sectionsOf(d)[0];
const secKey = (d, sec) => d.path.toLowerCase() + '|' + sec.index;

// ---------- the sections panel ----------
// The sections of the presentation in the middle, the same everywhere: a click on a section (or
// a slide) goes there when it's on the screen, or picks it when it's only looked at; the arrow
// opens the section's slides. The live section is marked.
let secSideKey = '';
function renderSections() {
  const d = activeDeck(), box = $('secList');
  const live = isLive(d);
  const here = live ? show.slide : selected;
  const key = d ? [d.path, live, here, d.ready, [...expandedSecs].join(','), LANG].join('|') : LANG;
  if (key === secSideKey) return;
  secSideKey = key;
  const keep = box.scrollTop;
  box.innerHTML = '';
  $('secSideDeck').textContent = d ? baseName(d.name) : '';
  $('secSideTag').textContent = d ? (live ? t('liveTag') : show.running ? t('previewTag') : '') : '';
  $('secSideTag').className = 'tag' + (live ? ' live' : '');
  $('secSideTag').hidden = !$('secSideTag').textContent;
  if (!d) { box.innerHTML = `<div class="sec-empty">${esc(t('noDeckSections'))}</div>`; return; }
  box.style.setProperty('--ratio', `${d.width}/${d.height}`);
  const secs = sectionsOf(d);
  const act = n => (live ? api.showCmd({ action: 'go', n }) : pick(d, n));
  for (const sec of secs) {
    const k = secKey(d, sec);
    const single = secs.length === 1 && !sec.name;
    const has = here >= sec.first && here < sec.first + sec.count;
    const row = document.createElement('div');
    row.className = 'srow' + (single || expandedSecs.has(k) ? ' open' : '') + (has && !single ? (live ? ' current' : ' picked') : '');
    if (!single) {
      const head = document.createElement('div');
      head.className = 'srow-head';
      head.innerHTML = `<button class="caret-btn" title="${esc(t('tOpenSection'))}"><svg><use href="#i-caret"/></svg></button>
        <button class="go" title="${esc(live ? t('goToSection', { name: sec.name }) : '')}"><b>${esc(sec.name || t('untitledSection'))}</b><span class="count">${sec.count}</span></button>`;
      head.querySelector('.caret-btn').onclick = () => { expandedSecs.has(k) ? expandedSecs.delete(k) : expandedSecs.add(k); renderSections(); if (!live) renderDeck(); };
      head.querySelector('.go').onclick = () => act(sec.first);
      head.querySelector('.go').ondblclick = () => { if (!live) startShow(sec.first); };
      row.appendChild(head);
    }
    const list = document.createElement('div');
    list.className = 'srow-slides';
    if (single || expandedSecs.has(k)) {
      for (let n = sec.first; n < sec.first + sec.count; n++) {
        const s = d.slides[n - 1], src = thumbUrl(d, n);
        const el = document.createElement('div');
        el.className = 'sslide' + (n === here ? (live ? ' current' : ' picked') : '') + (s.hidden ? ' hidden-slide' : '');
        el.innerHTML = `<div class="pic" ${src ? `style="background-image:url('${src.replace(/'/g, '%27')}')"` : ''}><span class="no">${n}</span></div><div class="t">${esc(s.title || t('slideN', { n }))}</div>`;
        el.onclick = () => act(n);
        el.ondblclick = () => { if (!live) startShow(n); };
        list.appendChild(el);
      }
    }
    row.appendChild(list);
    box.appendChild(row);
  }
  box.scrollTop = keep;
}
// Pick a slide of a presentation that's only looked at: selected in the grid, its section open.
function pick(d, n) {
  selected = n;
  expandedSecs.add(secKey(d, sectionOfSlide(d, n)));
  renderDeck(); renderSections();
  $('grid').querySelector('.card.selected')?.scrollIntoView({ block: 'nearest' });
}

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
    renderSections(); renderStartButtons();
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
    const key = secKey(d, sec);
    const named = !!(sec.name || secs.length > 1);
    const wrap = document.createElement('div');
    wrap.className = 'sec' + (named && !expandedSecs.has(key) ? ' collapsed' : '') + (curSec === sec || curSec?.index === sec.index ? ' current-sec' : '');
    if (named) {
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
        expandedSecs.has(key) ? expandedSecs.delete(key) : expandedSecs.add(key);
        wrap.classList.toggle('collapsed', !expandedSecs.has(key));
        renderSections();
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
  renderStartButtons();
  renderGrid($('grid'), d);
}
// "From the beginning", "Continue from slide N" (where it was left), "From this slide".
function renderStartButtons() {
  const d = activeDeck();
  if (!d) return;
  const resume = recentOf(d.path)?.slide || 1;
  $('resumeBtn').hidden = !(resume > 1 && resume <= d.slides.length);
  $('resumeBtn').querySelector('span').textContent = t('resumeAt', { n: resume });
  $('startHereBtn').hidden = selected === 1 || selected === resume;
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

// Inside a custom show its own slide order counts, not the presentation's.
// (Only when the slide on screen is in its list, else the presentation's order.)
const customShowOf = d => (show.named && d.customShows?.find(c => c.name === show.named && c.slides.includes(show.slide))) || null;
function nextSlideOf(d, n) {
  const cs = customShowOf(d);
  if (cs) { const i = cs.slides.indexOf(n); return i + 1 < cs.slides.length ? cs.slides[i + 1] : 0; }
  let m = n + 1;
  while (m <= d.slides.length && d.slides[m - 1].hidden) m++;
  return m <= d.slides.length ? m : 0;
}

function renderPresenter() {
  const d = activeDeck();
  if (!d || !isLive(d)) return;
  const n = show.slide || 0, count = d.slides.length;
  const slide = d.slides[n - 1];
  $('currentImg').src = n ? thumbUrl(d, n) : '';
  if (document.activeElement !== $('slideNo')) $('slideNo').value = n || '—';
  $('slideCount').textContent = `/ ${count}`;
  // Black / white screen
  const badge = $('screenBadge');
  const black = show.black || show.state === 3;
  badge.hidden = !(black || show.state === 4);
  badge.className = 'screen-badge' + (show.state === 4 ? ' white' : ' black');
  badge.textContent = show.state === 4 ? t('whiteOn') : t('blackHeldLong');
  $('blackBtn').classList.toggle('on', black);
  // While black, the slide's own picture here (the projector's live picture would be black too).
  $('current').classList.toggle('show-img', black);
  $('whiteBtn').classList.toggle('on', show.state === 4);
  // Next: another animation step on this slide, or the next slide of the show.
  const stepsLeft = (show.clicks || 0) - (show.click || 0);
  const nextN = n ? nextSlideOf(d, n) : 0;
  if (n && stepsLeft > 0) {
    $('nextImg').src = thumbUrl(d, n);
    $('nextInfo').textContent = t('nextClick', { a: (show.click || 0) + 1, b: show.clicks });
    $('nextEnd').hidden = true;
  } else if (nextN) {
    $('nextImg').src = thumbUrl(d, nextN);
    $('nextInfo').textContent = t('slideN', { n: nextN });
    $('nextEnd').hidden = true;
  } else {
    $('nextImg').removeAttribute('src');
    $('nextInfo').textContent = '';
    $('nextEnd').textContent = customShowOf(d) ? t('endOfNamed') : t('endOfShow');
    $('nextEnd').hidden = false;
  }
  $('notes').textContent = slide?.notes || '';
  $('notes').dataset.empty = t('noNotes');
  renderStrip(d);
  if (pvGridOpen) renderGrid($('pvGridBody'), d, { closeGrid: true });
}

// The current section's slides under the live slide (the sections themselves are in their panel).
let stripKey = '';
function renderStrip(d) {
  const sec = sectionOfSlide(d, show.slide || 1);
  const key = `${d.path}|${sec.index}|${show.slide}|${d.ready}`;
  if (key === stripKey) return;
  stripKey = key;
  const box = $('strip');
  box.innerHTML = '';
  for (let n = sec.first; n < sec.first + sec.count; n++) box.appendChild(slideCard(d, d.slides[n - 1], { strip: true }));
  box.querySelector('.card.current')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

function openPvGrid() {
  pvGridOpen = true;
  $('pvGrid').hidden = false; renderGrid($('pvGridBody'), activeDeck(), { closeGrid: true });
  $('pvGridBody').querySelector('.current-sec')?.scrollIntoView({ block: 'center' });
}
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
// The timer survives closing the app during a show (kept here until the show ends).
const saveTimer = () => { try { localStorage.setItem('showTimer', JSON.stringify(timerStart ? { timerStart, timerPaused, timerPausedAt } : null)); } catch {} };
function setTimerPaused() {
  $('timerPause').querySelector('use').setAttribute('href', timerPausedAt ? '#i-play' : '#i-pause');
  $('elapsed').parentElement.classList.toggle('paused', !!timerPausedAt);
}
$('timerPause').onclick = () => {
  if (timerPausedAt) { timerPaused += Date.now() - timerPausedAt; timerPausedAt = null; }
  else timerPausedAt = Date.now();
  setTimerPaused(); saveTimer();
  window.pushRemote?.();
};
$('timerReset').onclick = () => { timerStart = Date.now(); timerPaused = 0; if (timerPausedAt) timerPausedAt = Date.now(); saveTimer(); window.pushRemote?.(); };

// ---------- the show ----------
// Put a presentation on the screen (the one looked at, unless told). Asks first when another one
// is showing (`ask: false` when the phone already asked). It joins the program.
async function startShow(from, p = active, opts = {}) {
  const d = deckOf(p);
  if (!d) return false;
  if (opts.ask !== false && !(await confirmReplace(d.path))) return false;
  addToProgram(d.path, true);
  toast(t('starting'));
  const r = await api.startShow(d.path, from || 1);
  $('toast').hidden = true;
  if (!r.ok) { console.warn('start failed', r.error); toast(t('startFailed', { e: r.error })); return false; }
  timerStart = Date.now(); timerPaused = 0; timerPausedAt = null; saveTimer(); setTimerPaused();
  if (opts.follow !== false) active = d.path;
  onShow(r.result);
  return true;
}

// The window follows the show to another presentation (a link, the phone) only when it was
// showing the live one, or nothing was on: never while the operator looks at something else.
let followShow = false;
function onShow(s) {
  const was = show;
  show = s;
  // The timer runs for the whole show, however it was started (here, the phone, PowerPoint).
  if (s.running && !timerStart) { timerStart = Date.now(); timerPaused = 0; timerPausedAt = null; saveTimer(); }
  if (!s.running && was.running) { timerStart = null; saveTimer(); }
  let moved = false;
  if (s.running && s.path && !same(s.path, active) && (!was.running || !active || same(active, was.path) || followShow)) {
    if (deckOf(s.path)) { active = deckOf(s.path).path; moved = true; followShow = false; }
    else followShow = true; // a link to one not read yet: follow it once it is (onDeckOpened)
  }
  if (s.running) setLive(s.sourceId);
  else setLive(null);
  if (moved || was.running !== s.running || !same(was.path, s.path)) render();
  else { renderPresenter(); renderOnAir(); renderSections(); }
  window.pushRemote?.();
}

function render() {
  const d = activeDeck();
  const live = isLive(d);
  $('empty').hidden = !!d;
  $('deckView').hidden = !d || live;
  $('presenter').hidden = !live;
  if (!live) closePvGrid();
  renderOnAir();
  renderLibrary();
  if (d && !live) renderDeck();
  if (live) { stripKey = ''; renderPresenter(); }
  renderSections();
  window.pushRemote?.();
}

// Ending the show takes two presses (the button, or Esc), so a stray one never ends it.
let endArmedUntil = 0, endArmTimer;
function disarmEnd() { endArmedUntil = 0; $('endBtn').classList.remove('armed'); $('endBtn').querySelector('span').textContent = t('endShow'); }
function endShowSafely(byKey) {
  if (Date.now() < endArmedUntil) { clearTimeout(endArmTimer); disarmEnd(); cmd('end'); return; }
  endArmedUntil = Date.now() + 2500;
  $('endBtn').classList.add('armed');
  $('endBtn').querySelector('span').textContent = t('endAgainBtn');
  toast(byKey ? t('escAgain') : t('endAgain'));
  clearTimeout(endArmTimer); endArmTimer = setTimeout(disarmEnd, 2500);
}

const cmd = action => api.showCmd({ action });
$('nextBtn').onclick = () => cmd('next');
$('prevBtn').onclick = () => cmd('prev');
$('blackBtn').onclick = () => cmd('black');
$('blackPill').onclick = () => cmd('black');
$('whiteBtn').onclick = () => cmd('white');
$('endBtn').onclick = () => endShowSafely(false);
$('gridBtn').onclick = () => (pvGridOpen ? closePvGrid() : openPvGrid());
$('pvGridClose').onclick = closePvGrid;
$('startBtn').onclick = () => startShow(1);
$('resumeBtn').onclick = () => startShow(recentOf(active)?.slide || 1);
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
  if (e.ctrlKey && e.shiftKey && (k === 'b' || k === 'B')) { e.preventDefault(); toggleSections(); return; }
  if (e.ctrlKey && (k === 'b' || k === 'B')) { e.preventDefault(); toggleSidebar(); return; }
  // Ctrl+Tab: look at the next presentation of the program (the screen doesn't change).
  if (e.ctrlKey && k === 'Tab' && library.program.length) {
    e.preventDefault();
    const list = library.program, i = list.findIndex(x => same(x, active));
    openDeck(list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length]);
    return;
  }
  if (k === '?' ) { showKeys(); return; }
  if (k === 'F5') { e.preventDefault(); if (d && !live) startShow(e.shiftKey ? selected : 1); return; }
  // Black, on or off: any time (to get the next presentation ready behind it).
  if ((k === 'b' || k === 'B' || k === '.') && !e.ctrlKey) { cmd('black'); return; }
  // While a show runs, the keys drive it, whatever is looked at here.
  if (!show.running) {
    if (!d) return;
    const n = d.slides.length;
    // The selected slide's section opens, so the selection is never hidden in a closed one.
    const move = to => {
      selected = Math.max(1, Math.min(n, to));
      expandedSecs.add(d.path.toLowerCase() + '|' + sectionOfSlide(d, selected).index);
      renderDeck(); $('grid').querySelector('.card.selected')?.scrollIntoView({ block: 'nearest' });
    };
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
  else if ((k === 'g' || k === 'G' || k === '-') && live) (pvGridOpen ? closePvGrid() : openPvGrid());
  else if (k === 'Escape') { if (pvGridOpen) closePvGrid(); else endShowSafely(true); }
});

function showKeys() {
  const row = (keys, text) => `<div>${keys.map(k => `<kbd>${esc(k)}</kbd>`).join(' ')}</div><div>${esc(text)}</div>`;
  modal(`<h3>${esc(t('shortcuts'))}</h3><div class="keys">
    ${row(['F5'], t('kStart'))}${row(['Shift', 'F5'], t('kStartHere'))}
    ${row(['→', 'Space', 'PgDn'], t('kNext'))}${row(['←', 'PgUp'], t('kPrev'))}
    ${row(['5', 'Enter'], t('kGoTo'))}${row(['Home', 'End'], t('kFirstLast'))}
    ${row(['G'], t('kGrid'))}${row(['B'], t('kBlack'))}${row(['W'], t('kWhite'))}${row(['Esc', 'Esc'], t('kEnd'))}
    ${row(['Ctrl', 'O'], t('kOpen'))}${row(['Ctrl', 'Tab'], t('kTabs'))}${row(['Ctrl', 'B'], t('kSidebar'))}${row(['Ctrl', 'Shift', 'B'], t('kSections'))}
  </div><div class="actions"><button class="primary" id="mClose">${esc(t('ok'))}</button></div>`, c => { c.querySelector('#mClose').onclick = closeModal; });
}
$('keysBtn').onclick = showKeys;

// ---------- the two side panels: show/hide, resize ----------
// The program and library on the start side, the sections on the end side (they swap in Arabic).
function setPanels() {
  document.body.classList.toggle('side-hidden', !!settings.sidebarHidden);
  document.body.classList.toggle('sec-hidden', !!settings.sectionsHidden);
  $('sidebarBtn').classList.toggle('on', !settings.sidebarHidden);
  $('sectionsBtn').classList.toggle('on', !settings.sectionsHidden);
}
function toggleSidebar() { settings.sidebarHidden = !settings.sidebarHidden; api.setSetting('sidebarHidden', settings.sidebarHidden); setPanels(); }
function toggleSections() { settings.sectionsHidden = !settings.sectionsHidden; api.setSetting('sectionsHidden', settings.sectionsHidden); setPanels(); }
$('sidebarBtn').onclick = toggleSidebar;
$('sectionsBtn').onclick = toggleSections;
function resizer(gripId, panelId, setting, cssVar, def, endSide) {
  const grip = $(gripId);
  let startX = 0, startW = 0;
  const setW = w => { settings[setting] = Math.max(220, Math.min(520, w)); document.documentElement.style.setProperty(cssVar, settings[setting] + 'px'); };
  grip.addEventListener('pointerdown', e => {
    startX = e.clientX; startW = $(panelId).getBoundingClientRect().width;
    grip.setPointerCapture(e.pointerId);
    // Dragging away from the panel's own side makes it wider.
    const sign = (document.documentElement.dir === 'rtl') !== endSide ? -1 : 1;
    const move = ev => setW(startW + sign * (ev.clientX - startX));
    const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); api.setSetting(setting, settings[setting]); };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });
  grip.addEventListener('dblclick', () => { setW(def); api.setSetting(setting, def); });
}
resizer('sideGrip', 'side', 'sidebarWidth', '--side-w', 300, false);
resizer('secGrip', 'secSide', 'sectionsWidth', '--sec-w', 280, true);

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
    ${t('aboutName').split('\n').map(l => `<p>${esc(l)}</p>`).join('')}
    <p>${esc(t('aboutText'))}</p>
    <ul><li>${esc(t('aboutF1'))}</li><li>${esc(t('aboutF2'))}</li><li>${esc(t('aboutF3'))}</li><li>${esc(t('aboutF4'))}</li></ul>
    <p id="mUpdateStatus" class="muted" aria-live="polite"></p>
    <div class="actions"><button id="mGithub" class="ghost">${esc(t('aboutGithub'))}</button><button id="mCheck" class="ghost">${esc(t('checkUpdates'))}</button><span class="grow"></span><button class="primary" id="mClose">${esc(t('ok'))}</button></div>`, c => {
    c.querySelector('#mClose').onclick = closeModal;
    c.querySelector('#mGithub').onclick = () => window.open('https://github.com/michaelsaad/ma3madan-ppt');
    // Look for a new version now (it's also checked by itself a little after start, then every 6 hours).
    c.querySelector('#mCheck').onclick = async () => {
      const b = c.querySelector('#mCheck'), status = c.querySelector('#mUpdateStatus');
      b.disabled = true; status.textContent = t('checking');
      const r = await api.checkForUpdate();
      b.disabled = false;
      status.textContent = !r.ok ? t('checkFailed') : r.info ? t('updateFound', { v: r.info.version }) : t('upToDate');
    };
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
// A link in the slides opened another presentation (it's not added to the program: "On screen"
// shows where it came from). The view follows it if it was following the show.
api.onDeckOpened(d => {
  if (!d?.path) return;
  if (!deckOf(d.path)) open.push(d);
  if (show.running && same(show.path, d.path) && (followShow || !active)) { active = deckOf(d.path).path; followShow = false; }
  api.loadLibrary().then(lib => { library = lib; render(); });
});
api.onNotice(n => toast(t(n.key, n)));
api.onThumbs(({ path: p, ready }) => {
  const d = deckOf(p);
  if (!d) return;
  d.ready = ready;
  if (ready >= 1) rememberThumb(d);
  if (same(p, active)) { if (isLive(d)) { stripKey = ''; renderPresenter(); } else renderDeck(); renderSections(); }
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
  setPanels();
  if (settings.sidebarWidth) document.documentElement.style.setProperty('--side-w', settings.sidebarWidth + 'px');
  if (settings.sectionsWidth) document.documentElement.style.setProperty('--sec-w', settings.sectionsWidth + 'px');
  document.documentElement.style.setProperty('--notes-size', (settings.notesSize || 18) + 'px');
  $('gridSize').value = settings.thumbSize || 220;
  document.documentElement.style.setProperty('--thumb', $('gridSize').value + 'px');
  library = await api.loadLibrary();
  library.program ||= [];
  displays = await api.getDisplays();
  render();
  const files = await api.takeOpenFiles();
  if (files.length) openFiles(files);
  const s = await api.showState();
  if (s.running) {
    // Back after a restart during a show: the same timer.
    try { const saved = JSON.parse(localStorage.getItem('showTimer') || 'null'); if (saved?.timerStart) ({ timerStart, timerPaused, timerPausedAt } = saved); setTimerPaused(); } catch {}
    onShow(s);
  } else if (!files.length && library.program[0]) openDeck(library.program[0]); // tonight's first one, ready to look at
  initRemote();
});
