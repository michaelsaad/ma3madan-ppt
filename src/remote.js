// Phone remote: the Ma3madan Remote app (ma3madan-remote.pages.dev, its "Ma3madan PPT" tab).
// The phone pairs once with the QR code (or asks from "Nearby computers" and is approved here),
// then talks to this computer directly over the Wi-Fi (link-host.js, link.js).
//
// One link for the computer, shared with Ma3madan Play when both are open (hub.js): one QR code,
// one "Trust", and the phone shows a tab for each app.
let remoteOn = false;
let link = { on: false };
let lanOpen = false;

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
    return `<li><svg><use href="#i-phone"/></svg><span dir="auto">${esc(d.name)}</span>
      <small class="${live ? 'live' : 'muted'}">${esc(live ? (live.route === 'relay' ? t('phoneRelay') : t('phoneConnected')) : t('phoneSeen', { d: ago(d.seen || d.added) }))}</small>
      <button class="ghost" data-forget="${esc(d.id)}">${esc(t('phoneForget'))}</button></li>`;
  }).join('')}</ul></div>`;
}
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
    const qr = link.pairUrl ? await api.qrSvg(link.pairUrl) : '';
    const n = (link.phones?.length || 0) + (link.wifiPages || 0);
    const lan = link.lan || {};
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
          <div class="qr">${lan.qr || ''}</div>
          <div class="r-info">
            <p class="muted">${esc(t('lanText'))}</p>
            ${lan.urls?.length ? `<code dir="ltr">${esc(lan.urls[0].replace(/\?k=.*/, ''))}</code>` : `<p class="warn-text">${esc(t('remoteNoNet'))}</p>`}
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
  $('rOn')?.addEventListener('click', () => {
    remoteOn = true; api.setSetting('remoteOn', true);
    renderRemoteBtn(); renderRemoteModal(); pushRemote();
  });
  $('rOff')?.addEventListener('click', () => {
    remoteOn = false; api.setSetting('remoteOn', false);
    renderRemoteBtn(); renderRemoteModal();
  });
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

// A phone may open only what's already here: the open presentations, the recent ones and the
// lists. Never any other path it sends.
const knownDeck = p => typeof p === 'string' && (open.some(x => same(x.path, p)) || library.recents.some(r => same(r.path, p)) || library.lists.some(l => l.items.some(x => same(x, p))));

// The phone's buttons do what the same buttons here do.
async function remoteCommand(c) {
  if (c.path != null && !knownDeck(c.path)) return;
  if (window.MP_DEBUG) console.log("remote", JSON.stringify(c));
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

// main.js turns the link back on if it was on.
async function initRemote() {
  remoteOn = !!settings.remoteOn;
  renderRemoteBtn();
  if (remoteOn) pushRemote();
}
