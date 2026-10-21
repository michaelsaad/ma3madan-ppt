// Quick check of the PowerPoint bridge without the app: node test/bridge.js
// Runs a real full-screen slide show of test/test.pptx for a few seconds.
const b = require('../src/ppt/bridge');
const path = require('path');
const assert = require('assert');
const f = path.join(__dirname, 'test.pptx');
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('PowerPoint', await b.ping());
  const d = await b.open(f);
  assert.deepStrictEqual(d.sections.map(s => s.name), ['Opening', 'Sermon', 'Hymns']);
  assert.strictEqual(d.slides.length, 7);
  assert.strictEqual(d.slides[2].clicks, 2);
  assert.strictEqual(d.slides[1].notes, 'Notes for slide 2');
  console.log('open ok:', d.slides.map(s => `${s.index}:${s.title}`).join(' '));

  let s = await b.start(f, 2, false);
  assert.strictEqual(s.slide, 2);
  await b.findShow();
  await b.click(0.22, 0.78, 0); // the "Last slide" button on slide 2
  await wait(500);
  s = await b.state();
  assert.strictEqual(s.slide, 7, 'click-through reached the last slide');
  console.log('click-through ok');

  s = await b.go(3); assert.strictEqual(s.slide, 3);
  s = await b.next(); assert.strictEqual(s.click, 1);
  s = await b.screen(3); assert.strictEqual(s.state, 3);
  s = await b.screen(3); assert.strictEqual(s.state, 1);
  await b.end();
  s = await b.state(); assert.strictEqual(s.running, false);
  console.log('show control ok');
  await b.close(f);
  b.dispose();
})().catch(e => { console.error('FAIL', e.message); b.end().catch(() => {}).finally(() => { b.dispose(); process.exit(1); }); });
