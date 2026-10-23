// For trying the phone app against a real Ma3madan PPT: opens test/test.pptx, turns the phone
// remote on, prints the pairing link, and stays open. Run: npm run test:remote
// (MA3MADAN_BASE, MA3MADAN_PIPE, MA3MADAN_LINK_DIR: a test server, and a link shared with a test Ma3madan Play.)
const path = require('path');

module.exports = async function remoteHost(win) {
  const js = code => win.webContents.executeJavaScript(code);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  while (!(await js('typeof openDeck === "function" && typeof LinkPage === "object"'))) await wait(200);
  // MP_DECK=<file> tries it with another presentation.
  await js(`openDeck(${JSON.stringify(process.env.MP_DECK || path.join(__dirname, 'test.pptx'))})`);
  await js(`document.getElementById('remoteBtn').click()`);
  await wait(300);
  await js(`document.getElementById('rOn')?.click()`);
  while (!(await js('!!link.pairUrl'))) await wait(200);
  await js('window.MP_DEBUG = true');
  console.log('[remote-host] ROLE ' + await js('link.role'));
  console.log('[remote-host] PAIR ' + await js('link.pairUrl'));
  setInterval(async () => console.log('[remote-host] STATUS ' + await js('JSON.stringify({role: link.role, online: link.online, apps: link.apps, phones: (link.phones || []).length})')), 5000);
};
