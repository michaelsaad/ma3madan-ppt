// Builds the logo options for Ma3madan PPT (same family as Ma3madan Play's icon) and renders a
// comparison sheet: run with Ma3madan Play's electron:
//   "../video-presenter/node_modules/.bin/electron" build/icon-options/make-options.js
const fs = require('fs');
const path = require('path');

const defs = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#17306b"/><stop offset="1" stop-color="#0a1534"/></linearGradient>
    <linearGradient id="disc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5aa2ff"/><stop offset="1" stop-color="#2a63de"/></linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#f5b82e"/></linearGradient>
  </defs>`;

const tile = `<rect width="100" height="100" rx="23.3" fill="url(#bg)"/>`;
const waves = `
    <path d="M10 79 q10 -6 20 0 t20 0 t20 0 t20 0" stroke="#7dd3fc" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M10 89 q10 -6 20 0 t20 0 t20 0 t20 0" stroke="#3d8bff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".75"/>`;
const dove = (x = 50, y = 15.6, s = 0.29) => `
    <g fill="url(#gold)" transform="translate(${x} ${y}) scale(${s})">
      <path d="M0 12 C -8 2 -28 -2 -46 -20 C -26 -18 -14 -13 -6 -7 C -4 -16 -2 -22 0 -28 C 2 -22 4 -16 6 -7 C 14 -13 26 -18 46 -20 C 28 -2 8 2 0 12 Z"/>
      <circle cx="0" cy="17" r="6"/>
    </g>`;

// John (left, on the bank) baptising Christ (right, standing in the Jordan). Drawn in a 40×26 box.
const baptism = (color, op = 1) => `
    <g fill="${color}" fill-opacity="${op}">
      <circle cx="14" cy="6.6" r="2.5"/>
      <rect x="12.2" y="10.2" width="3.6" height="11.8" rx="1.8"/>
      <circle cx="27" cy="9.4" r="2.5"/>
      <rect x="25.2" y="13" width="3.6" height="8.6" rx="1.8"/>
    </g>
    <g fill="none" stroke="${color}" stroke-opacity="${op}" stroke-linecap="round">
      <path d="M15.4 12.2 L 20.5 7.6 L 25.6 5.4" stroke-width="2" stroke-linejoin="round"/>
      <path d="M6 22 q 2.5 -2 5 0 t 5 0 t 5 0 t 5 0 t 5 0 t 5 0" stroke-width="1.7"/>
    </g>`;

const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${defs}
  <g transform="translate(24 24) scale(4.64)">
    ${tile}${body}${waves}${dove()}
  </g>
</svg>
`;

const options = {
  // A — one slide, the baptism is what's on it.
  A: svg(`
    <rect x="17" y="32" width="66" height="40" rx="5" fill="url(#disc)"/>
    <rect x="17" y="32" width="66" height="40" rx="5" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width="2.4"/>
    <g transform="translate(26 39) scale(1.2)">${baptism('#fff')}</g>`),

  // B — presenter view: the slide the audience sees + the next slide and notes beside it.
  B: svg(`
    <rect x="11" y="33" width="52" height="36" rx="4.5" fill="url(#disc)"/>
    <rect x="11" y="33" width="52" height="36" rx="4.5" fill="none" stroke="#fff" stroke-width="2.2"/>
    <g transform="translate(15 38.5) scale(1.12)">${baptism('#fff')}</g>
    <rect x="67" y="33" width="22" height="15" rx="3" fill="#5aa2ff" fill-opacity=".55" stroke="#fff" stroke-opacity=".7" stroke-width="1.6"/>
    <g stroke="#fde68a" stroke-width="3" stroke-linecap="round" opacity=".9">
      <path d="M68 55 H88"/><path d="M68 62 H83"/>
    </g>`),

  // C — Ma3madan Play's blue disc kept, with a white slide in it instead of the play triangle.
  C: svg(`
    <circle cx="50" cy="52" r="29" fill="url(#disc)"/>
    <rect x="31" y="40" width="38" height="25" rx="3.5" fill="#fff"/>
    <g transform="translate(32 40.5) scale(0.92)">${baptism('#2a63de')}</g>`),

  // D — a deck: slides stacked behind each other, the front one shows the baptism.
  D: svg(`
    <rect x="27" y="26" width="58" height="36" rx="4.5" fill="#2a63de" opacity=".35"/>
    <rect x="22" y="30" width="58" height="36" rx="4.5" fill="#3d8bff" opacity=".6"/>
    <rect x="15" y="35" width="60" height="38" rx="5" fill="url(#disc)"/>
    <rect x="15" y="35" width="60" height="38" rx="5" fill="none" stroke="#fff" stroke-width="2.3"/>
    <g transform="translate(21 41.5) scale(1.2)">${baptism('#fff')}</g>`),
};

for (const [k, s] of Object.entries(options)) fs.writeFileSync(path.join(__dirname, `icon-${k}.svg`), s);
const play = fs.readFileSync(path.join(__dirname, '../../../video-presenter/build/icon.svg'), 'utf8');

// Sheet: each option big, then at taskbar/explorer sizes, next to Ma3madan Play's icon.
const img = (s, size) => `<img width="${size}" height="${size}" src="data:image/svg+xml;base64,${Buffer.from(s).toString('base64')}">`;
const card = (label, s) => `<div class="c"><div class="l">${label}</div>${img(s, 300)}<div class="sm">${img(s, 64)}${img(s, 48)}${img(s, 32)}${img(s, 16)}</div><div class="pair">${img(play, 48)}${img(s, 48)}</div></div>`;
const html = `<html><body style="margin:0;background:#e9edf5;font:600 22px Segoe UI;padding:20px;width:1400px">
<style>.c{display:inline-block;background:#fff;border-radius:16px;padding:16px;margin:8px;text-align:center;width:300px}
.sm,.pair{display:flex;gap:12px;justify-content:center;align-items:end;margin-top:12px}.pair{background:#202a3c;padding:8px;border-radius:8px}.l{margin-bottom:8px}</style>
${Object.entries(options).map(([k, s]) => card(k, s)).join('')}</body></html>`;
fs.writeFileSync(path.join(__dirname, 'sheet.html'), html);

if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  app.disableHardwareAcceleration();
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ width: 1440, height: 640, show: false, webPreferences: { offscreen: true } });
    await win.loadFile(path.join(__dirname, 'sheet.html'));
    await new Promise(r => setTimeout(r, 600));
    fs.writeFileSync(path.join(__dirname, 'sheet.png'), (await win.webContents.capturePage()).toPNG());
    app.quit();
  });
}
