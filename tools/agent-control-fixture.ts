#!/usr/bin/env bun
export {};
// Deterministic disposable fixture for complete browser-tool validation.
const server = Bun.serve({ hostname: "127.0.0.1", port: 8779, async fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === "/slow") { await Bun.sleep(200); return new Response('<!doctype html><title>Slow ready</title><h1>Slow document ready</h1><a href="/">Return</a>', { headers: { "Content-Type": "text/html" } }); }
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Agent tool fixture</title>
  <style>body{font:20px system-ui;margin:32px}input,button{font:inherit;padding:10px}label{display:block;margin:12px 0}</style></head><body><h1>Agent tool fixture</h1><a href="/slow">Slow document</a>
  <form><label>Worker note<input id="note" name="note" required></label><label>Password<input type="password" value="fixture-only-secret" aria-label="Password"></label><button>Save note</button></form><p id="result" role="status">Unsaved</p><button id="later">Delayed result</button><p id="delayed">Waiting</p>
  <script>window.events=[];for(const type of ['click','input','submit'])document.addEventListener(type,e=>events.push({type,trusted:e.isTrusted,id:e.target.id}));document.querySelector('form').onsubmit=e=>{e.preventDefault();document.querySelector('#result').textContent='Saved: '+document.querySelector('#note').value+' | Trusted events: '+events.every(e=>e.trusted)};document.querySelector('#later').onclick=()=>setTimeout(()=>document.querySelector('#delayed').textContent='Async complete',250)</script></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}});
console.log(`Agent tool fixture ${server.url}`);
