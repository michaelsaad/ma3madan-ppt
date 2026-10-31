// Drives the real app: opens test/test.pptx, checks sections and thumbnails, runs a full-screen
// show, moves through it, clicks through a button on a slide, and saves screenshots to test/out/.
// Run with: npm test
const fs = require('fs');
const path = require('path');
const assert = require('assert');

module.exports = async function selftest(win, { app, ppt }) {
  const finish = async code => { await Promise.race([ppt.quit(false).catch(() => {}), new Promise(r => setTimeout(r, 4000))]); ppt.dispose(); app.exit(code); };
  const out = path.join(__dirname, 'out');
  fs.mkdirSync(out, { recursive: true });
  const js = code => win.webContents.executeJavaScript(code);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async (code, ms = 20000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await js(code)) return; await wait(150); }
    throw new Error('timed out waiting for: ' + code + ' — show: ' + JSON.stringify(await js('show')));
  };
  const shot = async name => fs.writeFileSync(path.join(out, name + '.png'), (await win.webContents.capturePage()).toPNG());
  const log = (...a) => console.log('[selftest]', ...a);
  const deck = path.join(__dirname, 'test.pptx');
  const fail = async e => { console.error('[selftest] FAIL', e.stack || e); try { await shot('fail'); } catch {} await finish(1); };

  try {
    await until('document.readyState === "complete" && typeof openDeck === "function"');
    if (process.env.MP_LANG) await js(`applyLang(${JSON.stringify(process.env.MP_LANG)}); render()`);
    // MP_NARROW=1: a small window (the side panels float over the middle).
    if (process.env.MP_NARROW) { win.unmaximize(); win.setSize(960, 1000); await wait(400); }
    await js(`openFiles([${JSON.stringify(deck)}])`);
    await until('activeDeck() && activeDeck().ready === activeDeck().slides.length');
    assert.strictEqual(await js('library.program.length'), 1); // opened on purpose: it joins the program
    await wait(400);
    const secs = await js('[...document.querySelectorAll("#grid .sec-head b")].map(b => b.textContent)');
    assert.deepStrictEqual(secs, ['Opening', 'Sermon', 'Hymns']);
    assert.strictEqual(await js('document.querySelectorAll("#grid .card").length'), 7);
    await shot('1-deck');
    // Next slide: hidden ones are skipped, except from a hidden one (a link took the show there).
    assert.deepStrictEqual(await js(`(() => { const d = { slides: [{}, { hidden: 1 }, { hidden: 1 }, {}, {}] };
      return [nextSlideOf(d, 1), nextSlideOf(d, 2), nextSlideOf(d, 3), nextSlideOf(d, 5)]; })()`), [4, 3, 4, 0]);
    log('deck view ok');
    if (process.env.MP_NARROW) {
      // Too small for both panels: the sections float over the middle, opened by their button.
      assert.ok(await js('document.body.classList.contains("sec-hidden") && !document.body.classList.contains("sec-float")'));
      await js('document.getElementById("sectionsBtn").click()');
      assert.ok(await js('document.body.classList.contains("sec-float") && getComputedStyle(document.getElementById("secSide")).position === "fixed"'));
      await shot('1b-sections-floating');
      await js('document.getElementById("main").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))');
      assert.ok(await js('!document.body.classList.contains("sec-float")'));
      log('floating sections ok');
    }

    // Sections start closed: open one, and it's open in the sections panel too; then close it.
    assert.strictEqual(await js('document.querySelectorAll("#secList .srow").length'), 3);
    await js('document.querySelectorAll("#grid .sec-head")[1].click()');
    assert.ok(!(await js('document.querySelectorAll("#grid .sec")[1].classList.contains("collapsed")')));
    assert.ok(await js('document.querySelectorAll("#secList .srow")[1].classList.contains("open")'));
    await shot('2-section-open');
    await js('document.querySelectorAll("#grid .sec-head")[1].click()');

    // The show, on slide 2.
    await js('startShow(2)');
    await until('show.running && show.slide === 2');
    await until('document.getElementById("current").classList.contains("has-live")', 8000).catch(() => log('no live view'));
    await wait(800);
    await shot('3-presenter');
    log('show started, live view:', await js('document.getElementById("current").classList.contains("has-live")'));

    await js('cmd("next")');
    await until('show.slide === 3');
    await js('cmd("next")');
    await until('show.slide === 3 && show.click === 1');
    await wait(300);
    await shot('4-animation-step');
    log('next / animation step ok');
    // The phone's picture of the projector, with the animation as far as it has gone.
    if (await js('document.getElementById("current").classList.contains("has-live")')) {
      assert.ok((await js('liveShot()') || '').startsWith('data:image/jpeg'));
      assert.strictEqual((await js('projectorSignature()') || '').length, 32 * 18); // tells when the projector changes
    }
    // With a phone connected, a picture goes out when the projector changes (here: a step back).
    if (await js('document.getElementById("current").classList.contains("has-live")')) {
      await js(`window.__send = LinkPage.send; window.__shots = []; LinkPage.send = m => { if (m.type === 'thumb') __shots.push(m.id); };
        remoteOn = true; link = { ...link, phones: [{ peer: 'test' }] }; scheduleLiveShots();`);
      await js('cmd("prev")');
      await until('__shots.length > 0', 4000);
      log('projector pictures for the phone:', await js('__shots.join(", ")'));
      // A phone through the relay (no direct path): smaller pictures.
      await js(`__shots = []; LinkPage.send = m => { if (m.type === 'thumb') __shots.push(m.data.length); };
        link = { ...link, phones: [{ peer: 'test', route: 'relay' }] }; scheduleLiveShots();`);
      await js('cmd("next")');
      await until('__shots.length > 0', 5000);
      assert.ok(await js('__shots.every(n => n < 50000)'), 'relay pictures: ' + await js('__shots.join(", ")'));
      log('relay pictures (bytes):', await js('__shots.join(", ")'));
      await js('LinkPage.send = __send; remoteOn = false; link = { ...link, phones: [] }; scheduleLiveShots();');
    }

    await js('openPvGrid()');
    await wait(300);
    await shot('5-all-slides');
    assert.strictEqual(await js('document.querySelectorAll("#pvGridBody .sec.collapsed").length'), 0); // every section open
    await js('document.querySelector("#pvGridBody .card[data-n=\'2\']").click()');
    await until('show.slide === 2');
    assert.ok(await js('document.getElementById("pvGrid").hidden'));
    log('grid jump ok');

    // Click-through: the "Last slide" button on slide 2 (left part, near the bottom).
    await js(`(() => { const b = document.getElementById('current').getBoundingClientRect(); const v = document.getElementById('live');
      const r = v.videoWidth ? v.videoWidth / v.videoHeight : 16/9; let w = b.width, h = w / r; if (h > b.height) { h = b.height; w = h * r; }
      const x = b.left + (b.width - w) / 2 + w * 0.22, y = b.top + (b.height - h) / 2 + h * 0.78;
      document.getElementById('current').dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true })); })()`);
    await until('show.slide === 7', 6000);
    // A link to another slide: the "Go to 5" button on slide 2 (right part, near the bottom).
    await js('api.showCmd({ action: "go", n: 2 })');
    await until('show.slide === 2');
    await js('api.showClick(0.74, 0.78)');
    await until('show.slide === 5', 6000);
    log('link to a slide ok');

    // A link to another presentation (slide 6 → test2.pptx): the app follows it, then comes back.
    await js('api.showCmd({ action: "go", n: 6 })');
    await until('show.slide === 6');
    await js('api.showClick(0.74, 0.78)');
    await until('show.running && /test2\\.pptx$/i.test(show.path)', 15000);
    await until('/test2\\.pptx$/i.test(active) && !document.getElementById("presenter").hidden', 10000);
    assert.deepStrictEqual(await js('activeDeck().sections.map(s => s.name)'), ['Linked']);
    assert.strictEqual(await js('open.length'), 2);
    assert.strictEqual((await js('remoteState()')).deck.sections[0].name, 'Linked');
    assert.ok(!(await js('document.getElementById("chainBtn").hidden'))); // "Back to test"
    await shot('4b-linked');
    log('followed the link to another presentation');
    await js('cmd("last")');
    await until('show.slide === 3');
    await js('cmd("next")'); // past the end: back to the first presentation, where it was
    await until('show.running && /test\\.pptx$/i.test(show.path) && show.slide === 6', 15000);
    log('came back after it');
    log('click-through ok, state', await js('show.state'));

    // One Esc never ends the show.
    await js('document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
    await wait(600);
    assert.ok(await js('show.running'));
    await wait(2600); // disarmed again
    // Looking at another presentation doesn't change the screen, and the keys still drive the show.
    await js(`openDeck(${JSON.stringify(path.join(__dirname, 'test2.pptx'))})`);
    await until('/test2\.pptx$/i.test(active) && !document.getElementById("deckView").hidden');
    assert.ok(await js('/test\.pptx$/i.test(show.path) && document.body.classList.contains("previewing")'));
    await shot('6a-previewing');
    await js('document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))');
    await until('show.slide === 7');
    await js('document.getElementById("onAirBtn").click()');
    await until('/test\.pptx$/i.test(active) && !document.getElementById("presenter").hidden');
    log('preview while showing ok');

    await js('cmd("black")');
    await until('show.state === 3');
    await wait(300);
    await shot('6-black');
    // PowerPoint's own black: moving to another slide clears it.
    await js('api.showCmd({ action: "go", n: 2 })');
    await until('show.slide === 2 && show.state === 1', 4000);
    log('black cleared by moving');

    await js('cmd("end")');
    await until('!show.running');
    await wait(300);
    await shot('7-after');
    log('end ok');

    // Library: a list with the deck in it.
    await js(`library.lists.push({ id: 'x', name: 'Sunday', items: [${JSON.stringify(deck)}] }); saveLibrary(); renderLibrary()`);
    await wait(200);
    await shot('8-library');
    // Phone remote: the state the phone gets, a slide picture, a command, and the pairing dialog.
    const st = await js('remoteState()');
    assert.strictEqual(st.app, 'ppt');
    assert.deepStrictEqual(st.deck.sections.map(s => s.name), ['Opening', 'Sermon', 'Hymns']);
    assert.strictEqual(st.deck.slides.length, 7);
    assert.ok(st.caps.includes('program') && st.program.length === 1);
    assert.ok((await js(`remoteThumb('3|big|' + ${JSON.stringify(deck)})`)).startsWith('data:image/jpeg;base64,'));
    await js(`remoteCommand({ action: 'start', n: 4 })`);
    log('toast:', await js("document.getElementById('toast').textContent"), await js('!!activeDeck()'));
    await until('show.running && show.slide === 4');
    assert.strictEqual((await js('remoteState()')).notes, 'Notes for slide 4');
    await js(`remoteCommand({ action: 'next' })`);
    await until('show.slide === 5');
    await js(`remoteCommand({ action: 'end' })`);
    await until('!show.running');
    log('remote commands ok');
    if (!process.env.MP_NO_NET) {
      await js(`document.getElementById('remoteBtn').click()`);
      await wait(300);
      await js(`document.getElementById('rOn').click()`);
      await until('!!document.querySelector("#remoteBody .qr svg")', 15000);
      await wait(300);
      await shot('9-remote');
      const url = await js('link.pairUrl');
      assert.ok(/^https:\/\/([\w-]+\.)?ma3madan-remote\.pages\.dev\/#pair=[\w-]+\.[\w-]+&name=.+$/.test(url), url);
      log('trusted phones:', await js('JSON.stringify(link.devices)'), '| Wi-Fi page:', await js('!!link.lan?.urls?.length'));
      await js(`document.getElementById('rOff').click()`);
      log('remote dialog ok');
    }
    log('ALL OK');
    await finish(0);
  } catch (e) { await fail(e); }
};
