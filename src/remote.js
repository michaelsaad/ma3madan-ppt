// Phone remote: the Ma3madan Remote app (ma3madan-remote.pages.dev, its "Ma3madan PPT" tab).
// The phone pairs once with the QR code (or asks from "Nearby computers" and is approved here),
// then talks to this computer directly over the Wi-Fi (link-host.js, link.js).
//
// One link for the computer, shared with Ma3madan Play when both are open (hub.js): one QR code,
// one "Trust", and the phone shows a tab for each app.
let remoteOn = false;
let link = { on: false };
let lanOpen = false;
let lanNet = 0; // which network's code the Wi-Fi page shows

function renderRemoteBtn() {
  $('remoteBtn').classList.toggle('on', remoteOn);
  $('remoteBtn').classList.toggle('linked', remoteOn && ((link.phones?.length || 0) + (link.wifiPages || 0)) > 0);
}
LinkPage.onStatus = s => { link = s; renderRemoteBtn(); renderRemoteModal(); };
LinkPage.onMessage = async m => {
  if (m.type === 'cmd' && m.cmd && typeof m.cmd.action === 'string') remoteCommand(m.cmd);
  else if (m.type === 'thumb' && typeof m.id === 'string') {
    const data = await remoteThumb(m.id);
    if (data) LinkPage.send({ type: 'thumb', peer: m.peer, id: m.id, v: m.v, data });
  }
  // A phone looks at a presentation that isn't on the screen (its sections, to pick where to start):
  // just that phone gets it, and nothing changes here.
  else if (m.type === 'deck' && knownDeck(m.path)) {
    if (!(await openDeck(m.path, true))) return;
    LinkPage.send({ type: 'deck', peer: m.peer, path: m.path, deck: phoneDeck(deckOf(m.path)) });
  }
};

// ---------- a phone from "Nearby computers" asks to connect ----------
const linkRequests = [];
function askLinkRequest(req) {
  return new Promise(resolve => { linkRequests.push({ ...req, resolve }); renderLinkRequest(); api.flashWindow(); });
}
function cancelLinkRequest(code) {
  const i = linkRequests.findIndex(r => r.code === code);
  if (i < 0) return;
  linkRequests.splice(i, 1)[0].resolve('deny');
  renderLinkRequest();
}
LinkPage.onRequest = askLinkRequest;
LinkPage.onCancel = cancelLinkRequest;
function renderLinkRequest() {
  let box = $('linkRequest');
  const r = linkRequests[0];
  if (!r) { box?.remove(); return; }
  if (!box) { box = document.createElement('div'); box.id = 'linkRequest'; box.className = 'link-request'; document.body.appendChild(box); }
  box.innerHTML = `
    <div class="lr-top"><svg class="lr-ico"><use href="#i-phone"/></svg>
      <div class="lr-text"><b dir="auto">${esc(t('lrTitle', { d: r.device }))}</b><span>${esc(t('lrCode'))}</span></div>
      <code dir="ltr">${esc(r.code || '----')}</code></div>
    <div class="lr-actions">
      <button data-a="trust" class="primary">${esc(t('lrTrust'))}</button>
      <button data-a="once">${esc(t('lrOnce'))}</button>
      <button data-a="deny" class="ghost">${esc(t('lrDeny'))}</button>
    </div>`;
  for (const b of box.querySelectorAll('[data-a]')) b.onclick = () => { linkRequests.shift().resolve(b.dataset.a); renderLinkRequest(); };
}

// ---------- the dialog ----------
const ago = ms => {
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 2 ? t('agoNow') : m < 60 ? t('agoMin', { n: m }) : m < 48 * 60 ? t('agoHour', { n: Math.round(m / 60) }) : t('agoDay', { n: Math.round(m / 1440) });
};
// The phones this computer trusts (for both apps): each can be forgotten on its own.
function devicesHtml() {
  const list = link.devices || [];
  if (!list.length) return '';
  return `<div class="r-devices"><b>${esc(t('phonesTitle'))}</b><ul>${list.sort((a, b) => (b.seen || 0) - (a.seen || 0)).map(d => {
    const live = (link.phones || []).find(p => p.deviceId === d.id);
    return `<li><svg><use href="#i-phone"/></svg><span dir="auto" data-rename="${esc(d.id)}" title="${esc(t('phoneRename'))}">${esc(d.name)}</span>
      <small class="${live ? 'live' : 'muted'}">${esc(live ? (live.route === 'relay' ? t('phoneRelay') : t('phoneConnected')) : t('phoneSeen', { d: ago(d.seen || d.added) }))}</small>
      <button class="ghost" data-forget="${esc(d.id)}">${esc(t('phoneForget'))}</button></li>`;
  }).join('')}</ul></div>`;
}
async function renderRemoteModal() {
  if (document.activeElement?.classList?.contains('dev-rename')) return; // renaming a phone: don't redraw under the typing
  const body = $('remoteBody');
  if (!body) return;
  let html;
  if (!remoteOn) {
    html = `<h3><svg><use href="#i-phone"/></svg>${esc(t('remoteTitle'))}</h3>
      <p>${esc(t('remoteIntro'))}</p>
      <ul class="r-points"><li>${esc(t('remoteP1'))}</li><li>${esc(t('remoteP2'))}</li><li>${esc(t('remoteP3'))}</li></ul>
      <div class="actions"><button data-close>${esc(t('close'))}</button><button id="rOn" class="primary">${esc(t('remoteOn'))}</button></div>`;
  } else {
    const qr = link.pairUrl ? await api.qrSvg(link.pairUrl) : '';
    const n = (link.phones?.length || 0) + (link.wifiPages || 0);
  const lan = link.lan || {};
  const nets = lan.nets || [];
  if (lanNet >= nets.length) lanNet = 0;
  const net = nets[lanNet];
  const netName = n => (n.hotspot ? t('lanHotspot') : n.name) + ' · ' + n.address;
  const netChips = nets.length > 1 ? `<div class="lan-nets">${nets.map((n, i) => `<button class="${i === lanNet ? 'on' : ''}" data-net="${i}" dir="ltr">${esc(netName(n))}</button>`).join('')}</div>` : '';
    const shared = (link.apps || []).includes('play');
    html = `<h3><svg><use href="#i-phone"/></svg>${esc(t('remoteTitle'))}<span class="r-live">${esc(t('remoteIsOn'))}</span></h3>
      <div class="r-grid">
        <div class="qr">${qr || ''}</div>
        <div class="r-info">
          <b>${esc(t('appScan'))}</b>
          <ol class="r-steps"><li>${esc(t('appStep1'))}</li><li>${esc(t('appStep2'))}</li><li>${esc(t('appStep3'))}</li></ol>
          <p class="r-count">${esc(n ? t('remoteClients', { n }) : t('remoteNoClients'))}</p>
          ${shared ? `<p class="muted">${esc(t('linkShared'))}</p>` : ''}
          ${link.online === false ? `<p class="warn-text">${esc(t('appOffline'))}</p>` : ''}
        </div>
      </div>
      ${devicesHtml()}
      <details class="r-lan" ${lanOpen ? 'open' : ''}>
        <summary>${esc(t('lanTitle'))}</summary>
        <div class="r-grid">
          <div class="qr">${net?.qr || ''}</div>
          <div class="r-info">
            <p class="muted">${esc(t(nets.length > 1 ? 'lanTextNets' : 'lanText'))}</p>
            ${netChips}
            ${net ? `<code dir="ltr">${esc(net.url.replace(/\?k=.*/, ''))}</code>` : `<p class="warn-text">${esc(t('remoteNoNet'))}</p>`}
            <p class="muted">${esc(t('remoteFirewall'))}</p>
          </div>
        </div>
      </details>
      <div class="actions">
        <button id="rOff" class="danger-btn">${esc(t('remoteOff'))}</button>
        <button id="rNewKey" class="ghost" title="${esc(t('remoteNewKeyTip'))}">${esc(t('remoteNewKey'))}</button>
        <span class="grow"></span>
        <button class="primary" data-close>${esc(t('ok'))}</button>
      </div>`;
  }
  if (!$('remoteBody') || body.dataset.html === html) return;
  body.dataset.html = html;
  body.innerHTML = html;
  for (const b of body.querySelectorAll('[data-close]')) b.onclick = closeModal;
  body.querySelector('details')?.addEventListener('toggle', e => { lanOpen = e.target.open; });
  for (const b of body.querySelectorAll('[data-net]')) b.onclick = () => { lanNet = Number(b.dataset.net); renderRemoteModal(); };
  $('rOn')?.addEventListener('click', () => {
    remoteOn = true; api.setSetting('remoteOn', true);
    renderRemoteBtn(); renderRemoteModal(); pushRemote();
  });
  $('rOff')?.addEventListener('click', () => {
    remoteOn = false; api.setSetting('remoteOn', false);
    renderRemoteBtn(); renderRemoteModal();
  });
  // Tap a phone's name to rename it ("Mina's iPhone"): Enter or leaving the box saves it.
  for (const n of body.querySelectorAll('[data-rename]')) n.onclick = () => {
    const d = (link.devices || []).find(x => x.id === n.dataset.rename);
    if (!d) return;
    const input = document.createElement('input');
    input.className = 'dev-rename'; input.value = d.name; input.maxLength = 24; input.dir = 'auto';
    n.replaceWith(input); input.focus(); input.select();
    let done = false;
    const save = () => { if (done) return; done = true; input.blur(); body.dataset.html = ''; const v = input.value.trim(); if (v && v !== d.name) LinkPage.op({ op: 'rename', id: d.id, name: v }); else renderRemoteModal(); };
    input.onkeydown = e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { done = true; body.dataset.html = ''; renderRemoteModal(); } };
    input.onblur = save;
  };
  for (const b of body.querySelectorAll('[data-forget]')) b.onclick = () => {
    const d = (link.devices || []).find(x => x.id === b.dataset.forget);
    if (d && confirm(t('phoneForgetQ', { n: d.name }))) LinkPage.op({ op: 'forget', id: d.id });
  };
  // Start over: every phone has to scan again.
  $('rNewKey')?.addEventListener('click', async () => {
    if (!confirm(t('remoteNewKeyQ'))) return;
    await LinkPage.op({ op: 'forgetAll' });
    renderRemoteModal();
  });
}
$('remoteBtn').onclick = () => { modal('<div id="remoteBody"></div>'); $('modalCard').classList.add('wide'); renderRemoteModal(); };

// ---------- what the phone sees ----------
// The library, the open presentations, the one on screen with its sections and slide titles, and
// the show. Sent on every change; the phone fetches slide pictures separately (remoteThumb).
let remoteTimer = null;
function pushRemote() {
  if (!remoteOn) return;
  clearTimeout(remoteTimer);
  remoteTimer = setTimeout(() => LinkPage.send({ type: 'state', state: remoteState() }), 60);
  scheduleLiveShots();
}

// What the audience sees, as a picture for the phones: the slide with its animations as far as
// they've gone (the slide pictures show the finished slide). Taken from the live view of the show a
// moment after each step, and again once a longer animation has played. Not while it's black or
// white: the phone shows the slide then, with a band.
let shotKey = '', shotTimers = [];
function scheduleLiveShots() {
  if (!show.running) { shotKey = ''; return; }
  if (!((link.phones?.length || 0) + (link.wifiPages || 0))) return; // no phone to send it to
  const key = [show.path, show.slide, show.click || 0, show.state].join('|');
  if (key === shotKey) return;
  shotKey = key;
  for (const tm of shotTimers) clearTimeout(tm);
  if (show.state === 3 || show.state === 4) return;
  shotTimers = [450, 1400].map(ms => setTimeout(() => {
    if (key !== shotKey) return;
    const data = liveShot();
    if (data) LinkPage.send({ type: 'thumb', id: `live|${show.slide}|${show.click || 0}|${show.path}`, v: Date.now(), data });
  }, ms));
}
// The slide out of the live view (the show window has the screen's shape, the slide sits inside).
function liveShot() {
  const v = $('live'), d = deckOf(show.path);
  if (!d || !$('current').classList.contains('has-live') || !v.videoWidth || !v.videoHeight) return null;
  const vr = v.videoWidth / v.videoHeight, sr = d.width / d.height;
  let sw = v.videoWidth, sh = v.videoHeight, sx = 0, sy = 0;
  if (vr > sr) { sw = sh * sr; sx = (v.videoWidth - sw) / 2; } else if (vr < sr) { sh = sw / sr; sy = (v.videoHeight - sh) / 2; }
  const w = Math.min(960, Math.round(sw)), h = Math.round(w / sr);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, w, h);
  // A data channel message holds about 256 KB: a lighter picture when the slide is busy.
  for (const q of [0.72, 0.55, 0.4]) { const data = c.toDataURL('image/jpeg', q); if (data.length < 200000 || q === 0.4) return data; }
}
// What the phone can do with this version (a phone app newer or older than this one adapts).
const REMOTE_CAPS = ['program', 'preview', 'back', 'screen', 'resume'];
const phoneDeck = d => ({
  path: d.path, name: baseName(d.name), ratio: d.width / d.height, ready: d.ready, v: d.thumbs,
  sections: sectionsOf(d).map(s => ({ name: s.name, first: s.first, count: s.count })),
  slides: d.slides.map(s => ({ t: s.title, h: s.hidden ? 1 : 0 })),
});
function remoteState() {
  const live = show.running ? deckOf(show.path) : null;
  const d = live || activeDeck();
  // slide: where it was left (to continue from there).
  const item = p => ({ path: p, name: baseName(recentOf(p)?.name || p), slide: recentOf(p)?.slide || 1 });
  // A link just started another presentation and its slides aren't read yet: say it's live
  // anyway (its name and slide count), never "not presenting" while the show runs.
  const loading = show.running && !live && show.path ? {
    path: show.path, name: baseName(show.path), ratio: 16 / 9, ready: 0, v: 'loading',
    sections: [{ name: '', first: 1, count: show.count || 1 }],
    slides: Array.from({ length: show.count || 1 }, () => ({ t: '', h: 0 })),
  } : null;
  return {
    app: 'ppt', lang: LANG,
    open: open.map(x => ({ path: x.path, name: baseName(x.name), count: x.slides.length })),
    active: loading ? loading.path : d?.path || null,
    deck: loading || (d ? phoneDeck(d) : null),
    show: show.running ? { running: true, path: show.path, slide: show.slide, count: show.count, click: show.click, clicks: show.clicks, state: show.state } : { running: false },
    notes: live && show.slide ? live.slides[show.slide - 1]?.notes || '' : '',
    recents: library.recents.slice(0, 60).map(r => item(r.path)),
    lists: library.lists.map(l => ({ name: l.name, items: l.items.map(item) })),
    caps: REMOTE_CAPS,
    program: library.program.map(item),
    upNext: upNext(),
    // Where the show is: a custom show's name, and the presentations a link came from.
    named: show.running ? show.named || null : null,
    chain: show.running ? (show.chain || []).map(c => ({ path: c.path, name: baseName(c.path), slide: c.slide })) : [],
    timer: timerStart ? { elapsed: (timerPausedAt || Date.now()) - timerStart - timerPaused, running: !timerPausedAt } : null,
  };
}

// Slide pictures, asked for by id "<n>|<size>|<path>": small for the lists, big for the live slide.
async function remoteThumb(id) {
  const [n, size, ...rest] = String(id).split('|');
  return api.thumbData(rest.join('|'), Number(n), size === 'big' ? 1280 : 320);
}

// A phone may open only what's already here: the program, the open presentations, the recent
// ones and the lists. Never any other path it sends.
const knownDeck = p => typeof p === 'string' && (library.program.some(x => same(x, p)) || open.some(x => same(x.path, p)) || library.recents.some(r => same(r.path, p)) || library.lists.some(l => l.items.some(x => same(x, p))));

// The phone's buttons do what the same buttons here do. They never change what's looked at on
// this computer: only the screen (the phone asks before replacing a show).
async function remoteCommand(c) {
  if (c.path != null && !knownDeck(c.path)) return;
  if (window.MP_DEBUG) console.log("remote", JSON.stringify(c));
  const startOn = async (p, n) => { if (await openDeck(p, true)) await startShow(Number.isInteger(n) && n > 0 ? n : 1, p, { ask: false, follow: false }); };
  switch (c.action) {
    case 'next': case 'prev': case 'black': case 'white': case 'end': case 'first': case 'last': case 'back':
      if (show.running) await api.showCmd({ action: c.action });
      break;
    case 'screen': // exactly this: 1 the slide, 3 black, 4 white
      if (show.running && [1, 3, 4].includes(c.s)) await api.showCmd({ action: 'screen', s: c.s });
      break;
    case 'go':
      if (!Number.isInteger(c.n)) break;
      if (show.running && (!c.path || same(c.path, show.path))) await api.showCmd({ action: 'go', n: c.n });
      else if (c.path) await startOn(c.path, c.n);
      break;
    case 'start':
      if (c.path) await startOn(c.path, c.n);
      else if (activeDeck()) await startShow(Number.isInteger(c.n) ? c.n : 1, active, { ask: false });
      break;
    case 'open': // older phone apps: it joins the program
      if (typeof c.path === 'string' && await openDeck(c.path, true)) addToProgram(c.path, true);
      break;
    case 'click': // a spot on the slide (0..1)
      if (show.running && c.sx >= 0 && c.sx <= 1 && c.sy >= 0 && c.sy <= 1) await api.showClick(c.sx, c.sy);
      break;
    case 'timerReset': $('timerReset').click(); break;
    case 'timerPause': $('timerPause').click(); break;
  }
  pushRemote();
}

// main.js turns the link back on if it was on.
async function initRemote() {
  remoteOn = !!settings.remoteOn;
  renderRemoteBtn();
  if (remoteOn) pushRemote();
}
