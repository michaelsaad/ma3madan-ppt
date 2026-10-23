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
const LOW = new Set(['thumbs']); // background work
const ascii = s => s.replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

class Helper {
  constructor(name, command, args) {
    this.name = name; this.command = command; this.args = args;
    this.proc = null; this.pending = new Map(); this.nextId = 1; this.high = []; this.low = []; this.busy = false;
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
  // Commands run one at a time. Background work (slide pictures) waits while anything the
  // operator did is waiting, so a tap never queues behind a batch of thumbnails.
  call(cmd, ...args) {
    return new Promise((resolve, reject) => {
      (LOW.has(cmd) ? this.low : this.high).push({ cmd, args, resolve, reject });
      this.pump();
    });
  }
  pump() {
    if (this.busy) return;
    const job = this.high.shift() || this.low.shift();
    if (!job) return;
    this.busy = true;
    const done = () => { this.busy = false; this.pump(); };
    if (!this.proc) this.start();
    const id = this.nextId++;
    const timer = setTimeout(() => {
      if (!this.pending.has(id)) return;
      this.pending.delete(id);
      job.reject(new Error(`${this.name}: ${job.cmd} timed out`));
      this.kill(); // stuck (a PowerPoint dialog?): start fresh next time
      done();
    }, job.cmd === 'thumbs' || job.cmd === 'open' ? 120000 : 15000);
    this.pending.set(id, {
      resolve: v => { clearTimeout(timer); job.resolve(v); done(); },
      reject: e => { clearTimeout(timer); job.reject(e); done(); },
    });
    this.proc.stdin.write(ascii(JSON.stringify({ id, cmd: job.cmd, args: job.args })) + '\n');
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
  exportOne: (file, n, out, w, h) => host.call('exportOne', file, n, out, w, h),
  close: file => host.call('close', file),
  start: (file, slide, windowed, monitor) => host.call('start', file, slide, windowed, monitor || null),
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
  jump: kind => host.call('jump', kind),
  namedShow: (name, from, at) => host.call('namedShow', name, from, at),
  findShow: () => win.call('find'),
  place: at => win.call('place', at),
  monitor: at => win.call('monitor', at),
  warm: () => win.call('ping'),
  click: (fx, fy, back) => win.call('click', { fx, fy, back }),
  focus: hwnd => win.call('focus', { hwnd }),
  dispose() { host.kill(); win.kill(); },
};
