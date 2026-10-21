// The README's screenshots, made with the real app and docs/demo.pptx: npm run shots
const fs = require('fs');
const path = require('path');

module.exports = async function readmeShots(win, { app, ppt }) {
  const js = code => win.webContents.executeJavaScript(code);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async (code, ms = 30000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await js(code)) return; await wait(150); }
    throw new Error('timed out: ' + code);
  };
  const docs = path.join(__dirname, '..', 'docs');
  const shot = async name => fs.writeFileSync(path.join(docs, name), (await win.webContents.capturePage()).toPNG());
  const deck = path.join(docs, 'demo.pptx');
  try {
    await until('typeof openDeck === "function" && typeof initRemote === "function"');
    if (process.env.MP_LANG) await js(`applyLang(${JSON.stringify(process.env.MP_LANG)})`);
    await js(`library.lists.push({ id: 'sun', name: 'Sunday service', items: [${JSON.stringify(deck)}] }); saveLibrary()`);
    await js(`openDeck(${JSON.stringify(deck)})`);
    await until('activeDeck() && activeDeck().ready === activeDeck().slides.length');
    await js(`selected = 6; document.getElementById('gridSize').value = 230; document.documentElement.style.setProperty('--thumb', '230px'); render()`);
    await wait(800);
    await shot(process.env.MP_LANG === 'ar' ? 'slides-ar.png' : 'slides.png');

    await js('startShow(7)');
    await until('show.running && show.slide === 7');
    await js('cmd("next")');
    await until('show.click === 1');
    await until('document.getElementById("current").classList.contains("has-live")', 8000).catch(() => {});
    await js('timerStart = Date.now() - (12 * 60 + 34) * 1000');
    await wait(1500);
    await shot(process.env.MP_LANG === 'ar' ? 'screenshot-ar.png' : 'screenshot.png');
    await js('cmd("end")');
    await until('!show.running');
    console.log('[shots] done');
  } catch (e) { console.error('[shots] FAIL', e.message); }
  await Promise.race([ppt.quit(false).catch(() => {}), wait(4000)]);
  ppt.dispose();
  app.exit(0);
};
