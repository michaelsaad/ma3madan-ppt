// PowerPoint host: runs under Windows Script Host (cscript) and drives PowerPoint over COM.
//
// Why JScript: it talks to PowerPoint through plain late-bound COM (IDispatch), which works with
// any installed Office, 32- or 64-bit. PowerShell's typed Office binding fails on some machines.
//
// Protocol: one command per line on stdin, one reply per line on stdout:
//   in:  {"id":1,"cmd":"open","args":["C:\\deck.pptx"]}
//   out: {"id":1,"ok":true,"result":{...}}   or   {"id":1,"ok":false,"error":"..."}
// Both directions are plain ASCII: anything else travels as \uXXXX (the console code page would
// otherwise mangle Arabic titles and paths).

var pp = null;
var decks = {};
var namedFrom = 0; // the slide a custom show was started from // full path (lower case) → Presentation

function app() {
  if (pp) { try { pp.Name; return pp; } catch (e) { pp = null; decks = {}; } }
  pp = new ActiveXObject("PowerPoint.Application");
  return pp;
}

// ---------- JSON out (JScript 5.8 under cscript has no JSON object) ----------
function str(s) {
  var out = '"';
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i), ch = s.charAt(i);
    if (ch == '"') out += '\\"';
    else if (ch == '\\') out += '\\\\';
    else if (c < 32 || c > 126) { var h = c.toString(16); out += '\\u' + '0000'.substr(h.length) + h; }
    else out += ch;
  }
  return out + '"';
}
function json(v) {
  if (v === null || v === undefined) return 'null';
  var t = typeof v;
  if (t == 'number') return isFinite(v) ? String(v) : 'null';
  if (t == 'boolean') return v ? 'true' : 'false';
  if (t == 'string') return str(v);
  if (v instanceof Array) { var a = []; for (var i = 0; i < v.length; i++) a.push(json(v[i])); return '[' + a.join(',') + ']'; }
  var parts = [];
  for (var k in v) if (v.hasOwnProperty(k)) parts.push(str(k) + ':' + json(v[k]));
  return '{' + parts.join(',') + '}';
}

// ---------- presentations ----------
function key(path) { return String(path).toLowerCase(); }

function deck(path) {
  var d = decks[key(path)];
  if (d) { try { d.Name; return d; } catch (e) { delete decks[key(path)]; } }
  throw new Error("not open: " + path);
}

// A presentation opened without a window closes when its show ends: open it again when needed.
function ensure(path) {
  try { return deck(path); } catch (e) {}
  var d = alreadyOpen(path) || app().Presentations.Open(path, -1, 0, 0);
  decks[key(path)] = d;
  return d;
}

// Already open in PowerPoint (by the operator, or by a link during the show): use that one.
function alreadyOpen(path) {
  var ps = app().Presentations;
  for (var i = 1; i <= ps.Count; i++) {
    try { if (key(ps.Item(i).FullName) == key(path)) return ps.Item(i); } catch (e) {}
  }
  return null;
}

function open(path) {
  var a = app(), d = null;
  try { d = deck(path); } catch (e) {}
  if (!d) {
    // Read-only and without a window: the file stays untouched, and the operator can still open it
    // in PowerPoint to edit at the same time.
    d = alreadyOpen(path) || a.Presentations.Open(path, -1, 0, 0);
    decks[key(path)] = d;
  }
  return describe(d);
}

function text(shape) {
  try { if (shape.HasTextFrame && shape.TextFrame.HasText) return String(shape.TextFrame.TextRange.Text); } catch (e) {}
  return '';
}

function notesOf(slide) {
  try {
    var ph = slide.NotesPage.Shapes.Placeholders;
    for (var i = 1; i <= ph.Count; i++) {
      var s = ph.Item(i);
      if (s.PlaceholderFormat.Type == 2) return text(s); // ppPlaceholderBody
    }
  } catch (e) {}
  return '';
}

function titleOf(slide) {
  try { if (slide.Shapes.HasTitle) { var t = text(slide.Shapes.Title); if (t) return t; } } catch (e) {}
  // No title placeholder: the first text on the slide will do.
  try {
    for (var i = 1; i <= slide.Shapes.Count; i++) { var t2 = text(slide.Shapes.Item(i)); if (t2) return t2; }
  } catch (e) {}
  return '';
}

function describe(d) {
  var slides = [], sections = [];
  try {
    var sp = d.SectionProperties;
    for (var i = 1; i <= sp.Count; i++) sections.push({ name: String(sp.Name(i)), first: sp.FirstSlide(i), count: sp.SlidesCount(i) });
  } catch (e) {}
  for (var j = 1; j <= d.Slides.Count; j++) {
    var s = d.Slides.Item(j), hidden = false, section = 0;
    try { hidden = s.SlideShowTransition.Hidden == -1; } catch (e) {}
    try { section = s.sectionIndex; } catch (e) {}
    var clicks = 0;
    try { clicks = s.TimeLine.MainSequence.Count ? countClicks(s.TimeLine.MainSequence) : 0; } catch (e) {}
    slides.push({ index: j, id: s.SlideID, title: titleOf(s).replace(/[\r\n\u000b]+/g, ' ').substr(0, 200), notes: notesOf(s), hidden: hidden, section: section, clicks: clicks });
  }
  return {
    path: String(d.FullName), name: String(d.Name),
    width: d.PageSetup.SlideWidth, height: d.PageSetup.SlideHeight,
    slides: slides, sections: sections
  };
}

// Click steps on a slide (effects that start "On click").
function countClicks(seq) {
  var n = 0;
  for (var i = 1; i <= seq.Count; i++) if (seq.Item(i).Timing.TriggerType == 1) n++; // msoAnimTriggerOnPageClick
  return n;
}

function thumbs(path, dir, width, height, from, to) {
  var d = ensure(path), n = d.Slides.Count;
  from = from || 1; to = Math.min(to || n, n);
  for (var i = from; i <= to; i++) d.Slides.Item(i).Export(dir + "\\" + i + ".png", "PNG", width, height);
  return to - from + 1;
}

// One slide as a big picture (the phone's live slide).
function exportOne(path, n, file, width, height) {
  ensure(path).Slides.Item(n).Export(file, "PNG", width, height);
  return true;
}

// No "Save changes?" from PowerPoint for what the app did. Its own copies are read-only (nothing
// to save); a presentation the user opened in PowerPoint goes back to how it was before the show
// (still "unsaved" if it had changes of the user's own).
var cleanBefore = {}; // presentation → it had no unsaved changes before the show
function markClean(d) {
  try { if (d.ReadOnly || cleanBefore[key(d.FullName)]) d.Saved = -1; } catch (e) {}
}

function close(path) {
  var d = null;
  try { d = deck(path); } catch (e) { return false; }
  markClean(d);
  try { d.Close(); } catch (e) {}
  delete decks[key(path)];
  return true;
}

// ---------- the slide show ----------
function showWindow() {
  var a = app();
  var n = a.SlideShowWindows.Count;
  if (!n) return null;
  return a.SlideShowWindows.Item(n);
}

// PowerPoint opens a full-screen show on the monitor of its own "Slide Show > Monitor" setting.
// Point it at the chosen screen for this one start (then put the user's setting back), so the show
// opens there at the right size instead of being moved across screens with different scaling.
function withMonitor(device, run) {
  if (!device) return run();
  var sh = new ActiveXObject("WScript.Shell"), key = null, old = null, had = false;
  try { key = "HKCU\\Software\\Microsoft\\Office\\" + app().Version + "\\PowerPoint\\Options\\DisplayMonitor"; } catch (e) { return run(); }
  try { old = sh.RegRead(key); had = true; } catch (e) {}
  try { sh.RegWrite(key, device, "REG_SZ"); } catch (e) { return run(); }
  try { return run(); } finally {
    try { if (had) sh.RegWrite(key, old, "REG_SZ"); else sh.RegDelete(key); } catch (e) {}
  }
}

function start(path, slide, windowed, monitor) {
  // End what's showing first: ending a show closes a presentation opened without a window,
  // and it may be this very one.
  end();
  var d = ensure(path);
  try { cleanBefore[key(d.FullName)] = !!d.Saved; } catch (e) {}
  var ss = d.SlideShowSettings;
  ss.ShowType = windowed ? 2 : 1;        // ppShowTypeWindow : ppShowTypeSpeaker (full screen)
  try { ss.ShowPresenterView = 0; } catch (e) {} // our app is the presenter view
  ss.RangeType = 1;                       // ppShowAll
  ss.AdvanceMode = 2;                     // ppSlideShowUseSlideTimings
  forget();
  var w = withMonitor(windowed ? null : monitor, function () { return ss.Run(); });
  if (slide && slide > 1) { try { w.View.GotoSlide(slide); } catch (e) {} }
  markClean(d); // the show settings above count as a change for PowerPoint
  return state();
}

function end() {
  forget();
  var a = app();
  while (a.SlideShowWindows.Count) {
    var w = a.SlideShowWindows.Item(1), p = null;
    try { p = w.Presentation; } catch (e) {}
    // Pen marks would make PowerPoint ask "Keep your ink annotations?": wipe them first.
    try { w.View.EraseDrawing(); } catch (e) {}
    try { w.View.Exit(); } catch (e) { break; }
    if (p) markClean(p);
  }
  return true;
}

function view() {
  var w = showWindow();
  if (!w) throw new Error("no show");
  return w.View;
}

// Every property read is a round trip into PowerPoint (30–150 ms while a show runs), and this is
// asked several times a second: keep the window, view and file name between calls, and read the
// slide's details only when the slide changed.
var seen = { count: -1, w: null, v: null, path: '', total: 0, slide: -1, clicks: 0 };
function state() {
  var a = app(), n = 0;
  try { n = a.SlideShowWindows.Count; } catch (e) { return { running: false, error: String(e.message) }; }
  if (!n) { seen.count = 0; seen.w = null; return { running: false }; }
  if (n != seen.count || !seen.w) {
    seen.count = n; seen.w = a.SlideShowWindows.Item(n); seen.v = seen.w.View;
    seen.path = String(seen.w.Presentation.FullName); seen.total = seen.w.Presentation.Slides.Count; seen.slide = -1;
  }
  var v = seen.v, r = { running: true, path: seen.path, count: seen.total };
  try { r.slide = v.Slide.SlideIndex; } catch (e) { r.slide = 0; } // 0 = the "end of show" screen
  try { r.state = v.State; } catch (e) { seen.w = null; }           // 1 running, 2 paused, 3 black, 4 white, 5 done
  try {
    if (r.slide != seen.slide) { seen.slide = r.slide; seen.clicks = r.slide ? v.GetClickCount() : 0; }
    r.clicks = seen.clicks;
    r.click = seen.clicks ? v.GetClickIndex() : 0;
  } catch (e) {}
  return r;
}
function forget() { seen.w = null; seen.count = -1; }

function go(n) { view().GotoSlide(n); return state(); }
function next() { view().Next(); return state(); }
function prev() { view().Previous(); return state(); }
// 1 normal, 3 black, 4 white (pressing the same again goes back to the slide; exact: just that)
function screen(s, exact) { var v = view(); v.State = exact ? s : (v.State == s) ? 1 : s; return state(); }
// Paused (2) happens when the show loses the focus on some setups: carry on.
function resume() { var v = view(); if (v.State == 2) v.State = 1; return state(); }
function pointer(t) { view().PointerType = t; return state(); } // 1 arrow, 2 pen, 5 eraser… (ppSlideShowPointerType)
function erase() { view().EraseDrawing(); return true; }

// ---------- clicking on the slide ----------
// sx, sy: a spot on the current slide (0..1). If it's on a shape (or a piece of text) with a click
// action — a link, "go to slide", next, previous, end — do that action here and say so. Anything
// else (animation triggers, video buttons) is left to a real mouse click.
function hit(sx, sy) {
  var w = showWindow();
  if (!w) return { done: false };
  var v = w.View, d = w.Presentation, slide = v.Slide;
  var x = sx * d.PageSetup.SlideWidth, y = sy * d.PageSetup.SlideHeight;
  var found = findAction(slide.Shapes, x, y);
  if (!found) return { done: false };
  var a = found.action, act = a.Action;
  if (act == 1) v.Next();
  else if (act == 2) v.Previous();
  else if (act == 3) v.First();
  else if (act == 4) v.Last();
  else if (act == 5) v.GotoSlide(v.LastSlideViewed.SlideIndex);
  else if (act == 6) {
    // "End show" inside a custom show: back to the slide that opened it, like PowerPoint.
    var inNamed = ''; try { inNamed = String(v.SlideShowName || ''); } catch (e) {}
    if (inNamed && namedFrom) { v.EndNamedShow(); v.GotoSlide(namedFrom); namedFrom = 0; }
    else v.Exit();
  }
  else if (act == 7) {
    var h = a.Hyperlink, sub = String(h.SubAddress || ''), addr = String(h.Address || '');
    // A link to another presentation: the app opens it and runs its show (and comes back after),
    // like PowerPoint does, so the presenter view and the phone follow along.
    if (addr && /\.(pptx|ppt|ppsx|pps|pptm|ppsm)$/i.test(addr.replace(/[?#].*$/, '')) && !/^(?!file:)[a-z][a-z0-9+.-]*:\/\//i.test(addr)) {
      var file = addr.replace(/^file:\/\/\/?/i, '');
      try { file = decodeURIComponent(file); } catch (e) {}
      file = file.replace(/\//g, '\\');
      if (!/^([a-z]:\\|\\\\)/i.test(file)) file = d.Path + '\\' + file; // relative to this presentation
      var at = 0;
      if (sub) { var sp = sub.split(','); at = parseInt(sp.length > 1 ? sp[1] : sp[0], 10) || 0; }
      return { done: false, file: file, slide: at };
    }
    if (addr) h.Follow();
    else if (sub) {
      // "<slide id>,<slide index>,<title>": the id is what stays right if slides moved.
      var parts = sub.split(','), n = 0;
      try { n = d.Slides.FindBySlideID(parseInt(parts[0], 10)).SlideIndex; } catch (e) { n = parseInt(parts[1], 10) || 0; }
      if (n) v.GotoSlide(n); else return { done: false };
    } else return { done: false };
  } else if (act == 10) {
    // A custom show inside this presentation ("-1,-1,<name>"): PowerPoint plays it.
    var name = String(a.SlideShowName || '') || String(a.Hyperlink.SubAddress || '').split(',').slice(2).join(',');
    if (!name) return { done: false };
    namedFrom = v.Slide.SlideIndex;
    v.GotoNamedShow(name);
  } else return { done: false, kind: act };
  return { done: true, action: act };
}

function inside(s, x, y) {
  return x >= s.Left && x <= s.Left + s.Width && y >= s.Top && y <= s.Top + s.Height;
}
// Topmost first, like the mouse: shapes later in the list are drawn over earlier ones.
function findAction(shapes, x, y) {
  for (var i = shapes.Count; i >= 1; i--) {
    var s = shapes.Item(i);
    try { if (!s.Visible) continue; } catch (e) {}
    if (!inside(s, x, y)) continue;
    try { if (s.Type == 6) { var g = findAction(s.GroupItems, x, y); if (g) return g; } } catch (e) {} // msoGroup
    // A link on a few words inside the text: only where those words are.
    try {
      if (s.HasTextFrame && s.TextFrame.HasText) {
        var runs = s.TextFrame.TextRange.Runs();
        for (var r = 1; r <= runs.Count; r++) {
          var run = runs.Item(r), ra = run.ActionSettings.Item(1);
          if (ra.Action == 0) continue;
          if (x >= run.BoundLeft && x <= run.BoundLeft + run.BoundWidth && y >= run.BoundTop && y <= run.BoundTop + run.BoundHeight) return { action: ra };
        }
      }
    } catch (e) {}
    try { var sa = s.ActionSettings.Item(1); if (sa.Action != 0) return { action: sa }; } catch (e) {}
  }
  return null;
}

// Click actions found in the file by the app (see links.js).
function jump(kind) {
  var v = view();
  if (kind == 'next') v.Next();
  else if (kind == 'prev') v.Previous();
  else if (kind == 'first') v.First();
  else if (kind == 'last') v.Last();
  else if (kind == 'lastviewed') v.GotoSlide(v.LastSlideViewed.SlideIndex);
  else if (kind == 'end') {
    // "End show" inside a custom show: back to the slide that opened it, like PowerPoint.
    var inNamed = ''; try { inNamed = String(v.SlideShowName || ''); } catch (e) {}
    if (inNamed && namedFrom) { v.EndNamedShow(); v.GotoSlide(namedFrom); namedFrom = 0; }
    else { forget(); v.Exit(); }
  }
  return state();
}
// A custom show; `from` is the slide its "end show" goes back to, `at` a slide inside it to go to.
function namedShow(name, from, at) {
  var v = view();
  namedFrom = from || v.Slide.SlideIndex;
  v.GotoNamedShow(name);
  if (at) v.GotoSlide(at);
  return state();
}

// On exit: close what we opened, and PowerPoint too if nothing else is open in it.
function quit(closeApp) {
  end();
  for (var k in decks) if (decks.hasOwnProperty(k)) { markClean(decks[k]); try { decks[k].Close(); } catch (e) {} }
  decks = {};
  if (closeApp && pp && pp.Presentations.Count == 0) { try { pp.Quit(); } catch (e) {} }
  return true;
}

var commands = {
  quit: quit,
  ping: function () { return String(app().Version); },
  open: open, thumbs: thumbs, exportOne: exportOne, close: close,
  hit: hit, jump: jump, namedShow: namedShow, start: start, end: end, state: state, go: go, next: next, prev: prev,
  screen: screen, resume: resume, pointer: pointer, erase: erase
};

while (!WScript.StdIn.AtEndOfStream) {
  var line = WScript.StdIn.ReadLine(), msg = null;
  if (!line) continue;
  try {
    msg = eval('(' + line + ')');
    var fn = commands[msg.cmd];
    if (!fn) throw new Error("unknown command " + msg.cmd);
    var result = fn.apply(null, msg.args || []);
    WScript.StdOut.WriteLine(json({ id: msg.id, ok: true, result: result === undefined ? null : result }));
  } catch (e) {
    WScript.StdOut.WriteLine(json({ id: msg ? msg.id : 0, ok: false, error: String(e.message || e.description || ("error " + (e.number >>> 0).toString(16))) }));
  }
}
