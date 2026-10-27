// What's clickable on each slide, read straight from the .pptx file (a zip of XML files).
//
// Asking PowerPoint over COM while a show runs costs 30–150 ms per property, so finding the shape
// under a tap that way takes seconds. The file has the same information: every shape's box and its
// click action (go to a slide, next, end, a custom show, another file, a web page). Reading it once
// makes a tap instant.
//
// links(file) → { width, height, slides: [[{ x, y, w, h, act }]], shows: { id: name } }
//   boxes are 0..1 of the slide; act is one of
//   { go: n } · { jump: 'next'|'prev'|'first'|'last'|'lastviewed'|'end' } · { show: name, back }
//   · { file: path } · { url }
// Only .pptx/.ppsx/.pptm/.ppsm (zip) files can be read; for others, links() returns null.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------- a small zip reader ----------
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    files.set(name, { method, csize, local });
    p += 46 + nlen + elen + clen;
  }
  return name => {
    const f = files.get(name);
    if (!f) return null;
    const start = f.local + 30 + buf.readUInt16LE(f.local + 26) + buf.readUInt16LE(f.local + 28);
    const data = buf.subarray(start, start + f.csize);
    return (f.method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
  };
}

// ---------- a small XML reader (elements and attributes are all we need) ----------
function parseXml(text, keepText) {
  const root = { name: '#root', attrs: {}, kids: [] };
  const stack = [root];
  const re = /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>/g;
  let m, last = 0;
  while ((m = re.exec(text))) {
    if (keepText && m.index > last) { const top = stack[stack.length - 1]; top.text = (top.text || '') + decodeEntities(text.slice(last, m.index)); }
    last = re.lastIndex;
    if (!m[2]) continue;
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    const attrs = {};
    m[3].replace(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (_, k, a, b) => { attrs[k] = decodeEntities(a ?? b); });
    const el = { name: m[2], attrs, kids: [] };
    stack[stack.length - 1].kids.push(el);
    if (!m[4]) stack.push(el);
  }
  return root;
}
const decodeEntities = s => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e) =>
  ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e] ?? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))));
const local = name => name.replace(/^.*:/, '');
const child = (el, n) => el?.kids.find(k => local(k.name) === n);
const children = (el, n) => (el?.kids || []).filter(k => local(k.name) === n);
function* walk(el) { for (const k of el.kids) { yield k; yield* walk(k); } }

function rels(read, file) {
  const dir = path.posix.dirname(file);
  const relFile = `${dir}/_rels/${path.posix.basename(file)}.rels`;
  const xml = read(relFile);
  const out = {};
  if (!xml) return out;
  for (const r of walk(parseXml(xml))) {
    if (local(r.name) !== 'Relationship') continue;
    const external = r.attrs.TargetMode === 'External';
    out[r.attrs.Id] = { target: external ? r.attrs.Target : path.posix.normalize(path.posix.join(dir, r.attrs.Target)), external };
  }
  return out;
}

// ---------- the slides ----------
function readLinks(file) {
  const read = unzip(fs.readFileSync(file));
  const pres = parseXml(read('ppt/presentation.xml') || '');
  const presRels = rels(read, 'ppt/presentation.xml');
  const sz = [...walk(pres)].find(e => local(e.name) === 'sldSz');
  const W = Number(sz?.attrs.cx) || 12192000, H = Number(sz?.attrs.cy) || 6858000;
  const order = [...walk(pres)].filter(e => local(e.name) === 'sldId').map(e => presRels[e.attrs['r:id']]?.target).filter(Boolean);
  const indexOf = {};
  order.forEach((t, i) => { indexOf[t] = i + 1; });
  const shows = {};
  for (const e of walk(pres)) if (local(e.name) === 'custShow') shows[e.attrs.id] = e.attrs.name;
  const docDir = path.dirname(file);

  const slides = order.map(slideFile => {
    const xml = read(slideFile);
    if (!xml) return [];
    const r = rels(read, slideFile);
    const tree = parseXml(xml);
    const spTree = [...walk(tree)].find(e => local(e.name) === 'spTree');
    const out = [];
    // A group maps its children's coordinates (chOff/chExt) onto its own box (off/ext).
    const shapes = (el, tf) => {
      for (const k of el.kids) {
        const n = local(k.name);
        if (n === 'AlternateContent') { const pick = child(k, 'Choice') || child(k, 'Fallback'); if (pick) shapes(pick, tf); continue; }
        if (n === 'grpSp') {
          const x = child(child(k, 'grpSpPr'), 'xfrm');
          const off = child(x, 'off'), ext = child(x, 'ext'), cho = child(x, 'chOff'), che = child(x, 'chExt');
          let t2 = tf;
          if (off && ext && cho && che && Number(che.attrs.cx) && Number(che.attrs.cy)) {
            const sx = Number(ext.attrs.cx) / Number(che.attrs.cx), sy = Number(ext.attrs.cy) / Number(che.attrs.cy);
            const ox = Number(off.attrs.x) - Number(cho.attrs.x) * sx, oy = Number(off.attrs.y) - Number(cho.attrs.y) * sy;
            t2 = { a: tf.a * sx, b: tf.b + tf.a * ox, c: tf.c * sy, d: tf.d + tf.c * oy };
          }
          const before = out.length;
          shapes(k, t2);
          // A link on the group itself covers all of it.
          const act = action(child(child(k, 'nvGrpSpPr'), 'cNvPr'), r, indexOf, shows, docDir);
          if (act && off && ext) out.splice(before, 0, box(off, ext, tf, act));
          continue;
        }
        if (!['sp', 'pic', 'cxnSp', 'graphicFrame'].includes(n)) continue;
        const pr = child(k, n === 'graphicFrame' ? 'xfrm' : 'spPr');
        const x = n === 'graphicFrame' ? pr : child(pr, 'xfrm');
        const off = child(x, 'off'), ext = child(x, 'ext');
        if (!off || !ext) continue;
        const nv = child(k, { sp: 'nvSpPr', pic: 'nvPicPr', cxnSp: 'nvCxnSpPr', graphicFrame: 'nvGraphicFramePr' }[n]);
        let act = action(child(nv, 'cNvPr'), r, indexOf, shows, docDir);
        // A link on words in the text: the whole shape counts (where the words are needs layout).
        if (!act) for (const e of walk(k)) if (local(e.name) === 'rPr' && (act = action(e, r, indexOf, shows, docDir))) break;
        if (act) out.push(box(off, ext, tf, act));
      }
    };
    if (spTree) shapes(spTree, { a: 1, b: 0, c: 1, d: 0 });
    return out.reverse(); // topmost first, like the mouse
    function box(off, ext, t, act) {
      const x = t.b + t.a * Number(off.attrs.x), y = t.d + t.c * Number(off.attrs.y);
      return { x: x / W, y: y / H, w: (t.a * Number(ext.attrs.cx)) / W, h: (t.c * Number(ext.attrs.cy)) / H, act };
    }
  });
  return { width: W, height: H, slides, shows };
}

// The click action on an element holding <a:hlinkClick>.
function action(el, r, indexOf, shows, docDir) {
  const h = child(el, 'hlinkClick');
  if (!h) return null;
  const a = h.attrs.action || '', rel = r[h.attrs['r:id']];
  if (a.startsWith('ppaction://hlinkshowjump')) {
    const j = /jump=(\w+)/.exec(a)?.[1] || '';
    return { jump: { nextslide: 'next', previousslide: 'prev', firstslide: 'first', lastslide: 'last', lastslideviewed: 'lastviewed', endshow: 'end' }[j] || null };
  }
  if (a.startsWith('ppaction://customshow')) {
    const id = /id=(\d+)/.exec(a)?.[1];
    return shows[id] ? { show: shows[id], back: /return=true/.test(a) } : null;
  }
  if (a.startsWith('ppaction://hlinksldjump')) return rel && indexOf[rel.target] ? { go: indexOf[rel.target] } : null;
  if (a && !a.startsWith('ppaction://hlinkfile') && !a.startsWith('ppaction://hlinkpres')) return null; // programs, macros, OLE: PowerPoint itself
  if (!rel?.external) return null;
  const t = rel.target;
  if (/^(https?|mailto):/i.test(t)) return { url: t };
  let p = t.replace(/^file:\/\/\/?/i, '');
  try { p = decodeURIComponent(p); } catch {}
  p = p.replace(/[#?].*$/, '');
  if (!/^([a-z]:[\\/]|\\\\)/i.test(p)) p = path.resolve(docDir, p);
  return /\.(pptx|ppt|ppsx|pps|pptm|ppsm)$/i.test(p) ? { file: path.normalize(p) } : { open: path.normalize(p) };
}

// ---------- titles, notes, sections, hidden slides, animation clicks ----------
// The same as asking PowerPoint (host.js describe), without its 100 ms per question during a show.
const textOf = el => {
  const paras = [];
  for (const p of walk(el)) {
    if (local(p.name) !== 'p') continue;
    let line = '';
    for (const r of walk(p)) if (local(r.name) === 't') line += r.text || '';
    paras.push(line);
  }
  return paras.join('\n').trim();
};
const placeholder = (sp, types) => {
  const ph = [...walk(sp)].find(e => local(e.name) === 'ph');
  return ph && types.includes(ph.attrs.type || 'body');
};
function describe(file) {
  const read = unzip(fs.readFileSync(file));
  const presXml = read('ppt/presentation.xml') || '';
  const pres = parseXml(presXml, true);
  const presRels = rels(read, 'ppt/presentation.xml');
  const sz = [...walk(pres)].find(e => local(e.name) === 'sldSz');
  const ids = [...walk(pres)].filter(e => local(e.name) === 'sldId' && e.attrs['r:id']);
  const order = ids.map(e => presRels[e.attrs['r:id']]?.target);
  const indexById = {};
  ids.forEach((e, i) => { indexById[e.attrs.id] = i + 1; });
  const sectionOf = {};
  const sections = [];
  for (const sec of walk(pres)) {
    if (local(sec.name) !== 'section' || !sec.attrs.name) continue;
    const members = [...walk(sec)].filter(e => local(e.name) === 'sldId').map(e => indexById[e.attrs.id]).filter(Boolean);
    sections.push({ name: sec.attrs.name, first: members.length ? Math.min(...members) : 0, count: members.length });
    for (const n of members) sectionOf[n] = sections.length;
  }
  const slides = order.map((target, i) => {
    const n = i + 1, xml = target && read(target);
    const out = { index: n, id: Number(ids[i].attrs.id), title: '', notes: '', hidden: false, section: sectionOf[n] || 0, clicks: 0 };
    if (!xml) return out;
    const tree = parseXml(xml, true);
    const sld = tree.kids.find(k => local(k.name) === 'sld');
    out.hidden = sld?.attrs.show === '0';
    const sps = [...walk(tree)].filter(e => local(e.name) === 'sp');
    const title = sps.find(sp => placeholder(sp, ['title', 'ctrTitle']));
    out.title = textOf(title || { kids: [] }) || (sps.map(textOf).find(Boolean) || '');
    out.title = out.title.replace(/\s+/g, ' ').slice(0, 200);
    out.clicks = [...walk(tree)].filter(e => local(e.name) === 'cTn' && e.attrs.nodeType === 'clickEffect').length;
    const r = rels(read, target);
    const notesRel = Object.values(r).find(x => /notesSlide\d*\.xml$/.test(x.target));
    const notesXml = notesRel && read(notesRel.target);
    if (notesXml) {
      const body = [...walk(parseXml(notesXml, true))].filter(e => local(e.name) === 'sp').find(sp => placeholder(sp, ['body']));
      if (body) out.notes = textOf(body);
    }
    return out;
  });
  // Custom shows: their slides in their own order, so "next" inside one is right.
  const indexOfTarget = {};
  order.forEach((target, i) => { if (target) indexOfTarget[target] = i + 1; });
  const customShows = [...walk(pres)].filter(e => local(e.name) === 'custShow' && e.attrs.name).map(e => ({
    name: e.attrs.name,
    slides: [...walk(e)].filter(s => local(s.name) === 'sld').map(s => indexOfTarget[presRels[s.attrs['r:id']]?.target]).filter(Boolean),
  }));
  return {
    path: file, name: path.basename(file).replace(/\.[^.]+$/, ''),
    width: (Number(sz?.attrs.cx) || 12192000) / 12700, height: (Number(sz?.attrs.cy) || 6858000) / 12700,
    slides, sections: sections.filter(s => s.count), customShows,
  };
}

// Cached per file version.
const cache = new Map();
function links(file) {
  if (!/\.(pptx|ppsx|pptm|ppsm)$/i.test(file)) return null;
  try {
    const st = fs.statSync(file);
    const key = `${file.toLowerCase()}|${st.size}|${st.mtimeMs}`;
    if (!cache.has(key)) cache.set(key, readLinks(file));
    return cache.get(key);
  } catch (e) {
    console.warn('links', e.message);
    return null;
  }
}

// What's at (sx, sy) on slide n (1-based), if anything.
function hit(file, n, sx, sy) {
  const l = links(file);
  if (!l) return undefined; // unknown: ask PowerPoint
  for (const b of l.slides[n - 1] || []) {
    if (sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h) return b.act;
  }
  return null;
}

module.exports = { links, hit, describe };
