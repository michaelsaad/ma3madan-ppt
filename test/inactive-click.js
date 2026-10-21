// Click-through when the show window is NOT the active window (as when the operator works in our app).
const b = require('../src/ppt/bridge');
const { spawn } = require('child_process');
const path = require('path');
const f = path.join(__dirname, 'test.pptx');
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await b.open(f);
  await b.start(f, 2, false);
  await b.findShow();
  const np = spawn('notepad.exe'); await wait(1500); // takes the foreground, over the show
  console.log('click', await b.click(0.22, 0.78, 0));
  await wait(600);
  console.log('state', await b.state());
  np.kill();
  await b.end(); await b.close(f); b.dispose();
})().catch(e => { console.error(e); b.dispose(); });
