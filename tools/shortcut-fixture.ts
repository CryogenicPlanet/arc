#!/usr/bin/env bun
export {};
// Disposable, local-only keyboard regression pages. No user browsing data.
let loads = 0;
const server = Bun.serve({
  hostname: "127.0.0.1", port: 8768,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/download") return new Response("ArcMod shortcut audit fixture\n", {
      headers: { "Content-Type": "text/plain", "Content-Disposition": 'attachment; filename="arcmod-shortcut-audit.txt"' },
    });
    if (!/^\/(a|b)$/.test(path)) return new Response("Not found", { status: 404 });
    const page = path.slice(1).toUpperCase();
    return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
      <title>ArcMod shortcut audit ${page}</title>
      <style>body{font:18px system-ui;margin:40px;max-width:900px}input,textarea,button{font:inherit;padding:10px}textarea{display:block;width:650px;height:90px}a{margin-right:22px}</style>
      </head><body><h1>Shortcut audit ${page}</h1><p>Disposable localhost page. Load marker: ${++loads}</p>
      <label>Single-line editor <input id="single" aria-label="Single-line editor" value="alpha beta gamma"></label>
      <label>Multiline editor <textarea id="multi" aria-label="Multiline editor">first line\nsecond line</textarea></label>
      <p id="rich" contenteditable="true" role="textbox" aria-label="Rich-text editor">formatting audit</p>
      <p id="format-status">Bold: false; Italic: false; Underline: false</p>
      <p>ORCHID-AUDIT one. ORCHID-AUDIT two. ORCHID-AUDIT three.</p>
      <a href="/${page === "A" ? "b" : "a"}">Go to page ${page === "A" ? "B" : "A"}</a>
      <a href="/download">Download disposable fixture</a>
      <button id="count">Increment count</button><output id="result">Count: 0</output>
      <script>window.shortcutAudit={page:${JSON.stringify(page)},count:0};document.querySelector('#count').onclick=()=>{
        document.querySelector('#result').textContent='Count: '+(++window.shortcutAudit.count);
      };document.addEventListener('keyup',()=>document.querySelector('#format-status').textContent=
        ['Bold','Italic','Underline'].map(k=>k+': '+document.queryCommandState(k.toLowerCase())).join('; '));
      </script></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  },
});
console.log(`Shortcut audit fixture: ${server.url}a and ${server.url}b`);
