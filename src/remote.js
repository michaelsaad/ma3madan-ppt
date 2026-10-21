// Phone remote: the Ma3madan Remote app (ma3madan-remote.pages.dev, its "Ma3madan PPT" tab).
// The phone pairs once with the QR code (or asks from "Nearby computers" and is approved here),
// then talks to this window directly over the Wi-Fi (link-host.js, link.js).
//
// The pairing is this app's own, separate from Ma3madan Play's: the phone keeps one computer list
// per tab, and our id starts with "ppt-" so its Play tab never lists us.
let remoteOn = false;
let hostName = '';

function renderRemoteBtn() {
  $('remoteBtn').classList.toggle('on', remoteOn);
  $('remoteBtn').classList.toggle('linked', remoteOn && LinkHost.connected() > 0);
}

async function startLink() {
  if (!settings.linkKey) { settings.linkKey = MaLink.randomId(18); api.setSetting('linkKey', settings.linkKey); }
  if (!settings.linkHostId) { settings.linkHostId = 'ppt-' + MaLink.randomId(12); api.setSetting('linkHostId', settings.linkHostId); }
  if (!settings.linkLobby) { settings.linkLobby = MaLink.randomHex(16); api.setSetting('linkLobby', settings.linkLobby); }
  hostName ||= await api.hostName();
  await LinkHost.start(settings.linkKey, {
    name: hostName, hostId: settings.linkHostId, lobby: settings.linkLobby,
    onCommand: remoteCommand, thumb: remoteThumb,
    onRequest: askLinkRequest, onCancel: cancelLinkRequest,
    onChange: () => { renderRemoteBtn(); renderRemoteModal(); },
  });
  pushRemote();
}
const pairUrl = () => LinkHost.pairUrl(hostName) + '&app=ppt';

// ---------- a phone from "Nearby computers" asks to connect ----------
const linkRequests = [];
function askLinkRequest(req) {
  return new Promise(resolve => { linkRequests.push({ ...req, resolve }); renderLinkRequest(); });
}
function cancelLinkRequest(code) {
  const i = linkRequests.findIndex(r => r.code === code);
  if (i < 0) return;
  linkRequests.splice(i, 1)[0].resolve('deny');
  renderLinkRequest();
}
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
async function renderRemoteModal() {
  const body = $('remoteBody');
  if (!body) return;
  let html;
  if (!remoteOn) {
    html = `<h3><svg><use href="#i-phone"/></svg>${esc(t('remoteTitle'))}</h3>
      <p>${esc(t('remoteIntro'))}</p>
      <ul class="r-points"><li>${esc(t('remoteP1'))}</li><li>${esc(t('remoteP2'))}</li><li>${esc(t('remoteP3'))}</li></ul>
      <div class="actions"><button data-close>${esc(t('close'))}</button><button id="rOn" class="primary">${esc(t('remoteOn'))}</button></div>`;
  } else {
    const qr = LinkHost.isRunning() ? await api.qrSvg(pairUrl()) : '';
    const n = LinkHost.connected();
    html = `<h3><svg><use href="#i-phone"/></svg>${esc(t('remoteTitle'))}<span class="r-live">${esc(t('remoteIsOn'))}</span></h3>
      <div class="r-grid">
        <div class="qr">${qr || ''}</div>
        <div class="r-info">
          <b>${esc(t('appScan'))}</b>
          <ol class="r-steps"><li>${esc(t('appStep1'))}</li><li>${esc(t('appStep2'))}</li><li>${esc(t('appStep3'))}</li></ol>
          <p class="r-count">${esc(n ? t('remoteClients', { n }) : t('remoteNoClients'))}</p>
          ${LinkHost.isOnline() === false ? `<p class="warn-text">${esc(t('appOffline'))}</p>` : ''}
        </div>
      </div>
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
  $('rOn')?.addEventListener('click', async () => {
    remoteOn = true; api.setSetting('remoteOn', true);
    renderRemoteBtn();
    await startLink();
    renderRemoteModal();
  });
  $('rOff')?.addEventListener('click', () => {
    remoteOn = false; api.setSetting('remoteOn', false);
    LinkHost.stop(); renderRemoteBtn(); renderRemoteModal();
  });
  // A new code: every paired phone has to scan again.
  $('rNewKey')?.addEventListener('click', async () => {
    settings.linkKey = MaLink.randomId(18); api.setSetting('linkKey', settings.linkKey);
    await startLink();
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
  remoteTimer = setTimeout(() => LinkHost.broadcast(remoteState()), 60);
}
function remoteState() {
  const live = show.running ? deckOf(show.path) : null;
  const d = live || activeDeck();
  const item = p => ({ path: p, name: baseName(recentOf(p)?.name || p) });
  return {
    app: 'ppt', lang: LANG,
    open: open.map(x => ({ path: x.path, name: baseName(x.name), count: x.slides.length })),
    active: d?.path || null,
    deck: d ? {
      path: d.path, name: baseName(d.name), ratio: d.width / d.height, ready: d.ready, v: d.thumbs,
      sections: sectionsOf(d).map(s => ({ name: s.name, first: s.first, count: s.count })),
      slides: d.slides.map(s => ({ t: s.title, h: s.hidden ? 1 : 0 })),
    } : null,
    show: show.running ? { running: true, path: show.path, slide: show.slide, count: show.count, click: show.click, clicks: show.clicks, state: show.state } : { running: false },
    notes: live && show.slide ? live.slides[show.slide - 1]?.notes || '' : '',
    recents: library.recents.slice(0, 25).map(r => item(r.path)),
    lists: library.lists.map(l => ({ name: l.name, items: l.items.map(item) })),
    timer: timerStart ? { elapsed: (timerPausedAt || Date.now()) - timerStart - timerPaused, running: !timerPausedAt } : null,
  };
}

// Slide pictures, asked for by id "<n>|<size>|<path>": small for the lists, big for the live slide.
async function remoteThumb(id) {
  const [n, size, ...rest] = String(id).split('|');
  return api.thumbData(rest.join('|'), Number(n), size === 'big' ? 1280 : 320);
}

// The phone's buttons do what the same buttons here do.
async function remoteCommand(c) {
  const d = activeDeck();
  switch (c.action) {
    case 'next': case 'prev': case 'black': case 'white': case 'end': case 'first': case 'last':
      if (show.running) await api.showCmd({ action: c.action });
      break;
    case 'go':
      if (!Number.isInteger(c.n)) break;
      if (show.running && (!c.path || same(c.path, show.path))) await api.showCmd({ action: 'go', n: c.n });
      else if (c.path) { if (await openDeck(c.path)) await startShow(c.n); }
      break;
    case 'start':
      if (c.path && !(await openDeck(c.path))) break;
      if (activeDeck()) await startShow(Number.isInteger(c.n) ? c.n : 1);
      break;
    case 'open':
      if (typeof c.path === 'string') await openDeck(c.path);
      break;
    case 'click': // a spot on the slide (0..1)
      if (show.running && c.sx >= 0 && c.sx <= 1 && c.sy >= 0 && c.sy <= 1) await api.showClick(c.sx, c.sy);
      break;
    case 'timerReset': $('timerReset').click(); break;
    case 'timerPause': $('timerPause').click(); break;
  }
  pushRemote();
}

// Closing the app takes this computer off the phones' "nearby" list right away.
addEventListener('beforeunload', () => { if (LinkHost.isRunning()) LinkHost.stop(); });

async function initRemote() {
  remoteOn = !!settings.remoteOn;
  renderRemoteBtn();
  if (remoteOn) startLink().catch(e => console.warn('link', e));
}
