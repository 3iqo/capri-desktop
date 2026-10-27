'use strict';

// Finding your files when you ask her ("trouve mon CV", "where's my report"). Windows' search
// index first: your whole user folder, by name and by what's in the files, in a blink. If it's off,
// a walk through your usual folders, by name. Then a screenshot when you ask for one.

const fs = require('node:fs');
const path = require('node:path');
const { app, shell, desktopCapturer, screen } = require('electron');
const { powershell } = require('./apps');

const LIMIT = 8;
const found = new Set(); // what a search showed you: the only paths she opens from here

const words = (query) => String(query || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .split(/[^\p{L}\p{N}.]+/u).filter((w) => w.length >= 2).slice(0, 5);

// Windows Search: names first (every word in the name), then contents. null if the index can't be asked.
async function indexed(terms) {
  const safe = terms.map((t) => t.replace(/[^\p{L}\p{N}.]/gu, '')).filter(Boolean);
  if (!safe.length) return [];
  const scope = `file:${app.getPath('home')}`; // backslashes: with slashes the index finds nothing
  const byName = safe.map((t) => `System.FileName LIKE '%${t}%'`).join(' AND ');
  const byText = `CONTAINS(*, '${safe.map((t) => `"${t}"`).join(' AND ')}')`;
  // ItemUrl (file:C:/Users/…): the real path. ItemPathDisplay is translated (C:\Utilisateurs\…\Bureau)
  const query = (where) => `SELECT TOP ${LIMIT} System.ItemUrl FROM SYSTEMINDEX WHERE SCOPE='${scope}' AND ${where} ORDER BY System.DateModified DESC`;
  const script = [
    '$c = New-Object -ComObject ADODB.Connection',
    "$c.Open(\"Provider=Search.CollatorDSO;Extended Properties='Application=Windows';\")",
    // each query in a single-quoted PowerShell string (its own quotes doubled)
    ...[query(byName), query(byText)].map((q) => `$r = New-Object -ComObject ADODB.Recordset; $r.Open('${q.replace(/'/g, "''")}', $c); while (-not $r.EOF) { $r.Fields.Item('System.ItemUrl').Value; $r.MoveNext() }; $r.Close()`),
  ].join('; ');
  const out = await powershell(script, 10000).catch(() => null);
  if (out == null) return null;
  const paths = out.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^file:/i.test(l));
  return [...new Set(paths.map((l) => decodeURIComponent(l.slice(5)).replace(/\//g, '\\')))];
}

// The walk, when the index isn't there: your usual folders, a few levels down, by name.
function walked(terms) {
  const roots = ['desktop', 'documents', 'downloads', 'pictures', 'music', 'videos'].map((k) => app.getPath(k));
  const onedrive = process.env.OneDrive;
  if (onedrive) roots.push(onedrive);
  const hits = [];
  const queue = roots.map((dir) => [dir, 0]);
  let seen = 0;
  while (queue.length && hits.length < LIMIT * 3 && seen < 40000) {
    const [dir, depth] = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      seen++;
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      const name = words(e.name).join(' ');
      if (terms.every((t) => name.includes(t))) hits.push(full);
      if (e.isDirectory() && depth < 5) queue.push([full, depth + 1]);
    }
  }
  return hits;
}

// [{ path, name, folder }], the newest first, at most LIMIT
async function search(query) {
  const terms = words(query);
  if (!terms.length) return [];
  const paths = await indexed(terms);
  const results = listed(paths?.length ? paths : walked(terms));
  return results.length || !paths?.length ? results : listed(walked(terms));
}

function listed(paths) {
  const results = paths.slice(0, LIMIT).map((p) => {
    let time = 0;
    try {
      time = fs.statSync(p).mtimeMs;
    } catch {
      return null; // gone since
    }
    return { path: p, name: path.basename(p), folder: path.basename(path.dirname(p)), time };
  }).filter(Boolean);
  for (const r of results) found.add(r.path);
  return results;
}

// one of the files she found: opened, or shown in its folder
async function open(file, { reveal = false } = {}) {
  if (!found.has(file)) throw new Error('not one she found');
  if (reveal) {
    shell.showItemInFolder(file);
    return;
  }
  const err = await shell.openPath(file);
  if (err) throw new Error(err);
}

// A screenshot of the screen she's on, full size, saved in Pictures › Screenshots (made if needed).
async function screenshot(display) {
  const d = display || screen.getPrimaryDisplay();
  const k = d.scaleFactor || 1;
  const size = { width: Math.round(d.bounds.width * k), height: Math.round(d.bounds.height * k) };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  const src = sources.find((s) => s.display_id === String(d.id)) || sources[0];
  if (!src || src.thumbnail.isEmpty()) throw new Error('no picture of the screen');
  const dir = path.join(app.getPath('pictures'), 'Screenshots');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const file = path.join(dir, `Capri ${stamp}.png`);
  fs.writeFileSync(file, src.thumbnail.toPNG());
  found.add(file);
  return { path: file, name: path.basename(file) };
}

module.exports = { search, open, screenshot };
