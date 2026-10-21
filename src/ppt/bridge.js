// Talks to the two helper processes that do the PowerPoint work:
// - host.js under cscript: PowerPoint itself, over COM (open, thumbnails, the slide show)
// - win.ps1 under PowerShell: the slide show window (place it on a screen, click inside it)
// Both are long-lived and answer one JSON line per command. If one dies (PowerPoint closed,
// crashed…), the next command starts it again.
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

// Inside the packaged app the scripts are unpacked next to app.asar (cscript can't read an asar).
const here = __dirname.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');

// Only ASCII crosses the pipe: everything else as \uXXXX (see host.js).
const ascii = s => s.replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

class Helper {
  constructor(name, command, args) {
    this.name = name; this.command = command; this.args = args;
    this.proc = null; this.pending = new Map(); this.nextId = 1; this.queue = Promise.resolve();
  }
  start() {
    const p = spawn(this.command, this.args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = p;
    readline.createInterface({ input: p.stdout }).on('line', line => {
      let m; try { m = JSON.parse(line); } catch { return; }
      const w = this.pending.get(m.id);
      if (!w) return;
      this.pending.delete(m.id);
      m.ok ? w.resolve(m.result) : w.reject(new Error(m.error));
    });
    let err = '';
    p.stderr.on('data', d => { err = (err + d).slice(-2000); });
    p.on('exit', code => {
      if (this.proc === p) this.proc = null;
      for (const w of this.pending.values()) w.reject(new Error(`${this.name} stopped (${code}) ${err.trim()}`));
      this.pending.clear();
    });
  }
  // Commands run one at a time, in order.
  call(cmd, ...args) {
    const run = () => new Promise((resolve, reject) => {
      if (!this.proc) this.start();
      const id = this.nextId++;
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`${this.name}: ${cmd} timed out`));
        this.kill(); // stuck (a PowerPoint dialog?): start fresh next time
      }, cmd === 'thumbs' || cmd === 'open' ? 120000 : 15000);
      this.pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
      this.proc.stdin.write(ascii(JSON.stringify({ id, cmd, args })) + '\n');
    });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }
  kill() { try { this.proc?.kill(); } catch {} this.proc = null; }
}

const host = new Helper('PowerPoint', 'cscript.exe', ['//nologo', '//E:jscript', path.join(here, 'host.js')]);
const win = new Helper('Window helper', 'powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'win.ps1')]);

module.exports = {
  ping: () => host.call('ping'),
  quit: closeApp => host.call('quit', closeApp),
  open: file => host.call('open', file),
  thumbs: (file, dir, w, h, from, to) => host.call('thumbs', file, dir, w, h, from, to),
  close: file => host.call('close', file),
  start: (file, slide, windowed) => host.call('start', file, slide, windowed),
  end: () => host.call('end'),
  state: () => host.call('state'),
  go: n => host.call('go', n),
  next: () => host.call('next'),
  prev: () => host.call('prev'),
  screen: s => host.call('screen', s),
  resume: () => host.call('resume'),
  pointer: t => host.call('pointer', t),
  erase: () => host.call('erase'),
  hit: (sx, sy) => host.call('hit', sx, sy),
  findShow: () => win.call('find'),
  place: rect => win.call('place', rect),
  click: (fx, fy, back) => win.call('click', { fx, fy, back }),
  focus: hwnd => win.call('focus', { hwnd }),
  dispose() { host.kill(); win.kill(); },
};
