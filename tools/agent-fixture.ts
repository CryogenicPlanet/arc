#!/usr/bin/env bun
// Disposable localhost pages for checking agent target ownership and background input.
// No user browsing data or remote resources. Run before the live agent probe.
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 8767,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (!/^\/(a|b)$/.test(path)) return new Response("Not found", { status: 404 });
    const page = path.slice(1).toUpperCase();
    return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
      <title>ArcMod agent probe ${page}</title>
      <style>body{font:20px system-ui;margin:48px}button,input{font:inherit;padding:12px}#result{padding:16px;background:#eee}</style>
      </head><body><h1>Agent target ${page}</h1>
      <p>This local fixture is disposable.</p>
      <label>Target ${page} text <input id="text" aria-label="Target ${page} text" value="initial ${page}"></label>
      <button id="increment">Increment ${page}</button>
      <p id="result">Count: 0</p><a href="/${page === "A" ? "b" : "a"}">Other target</a>
      <script>let count=0;document.querySelector('#increment').addEventListener('click',()=>{
        document.querySelector('#result').textContent='Count: '+(++count);
      });window.agentProbe={page:${JSON.stringify(page)},instance:crypto.randomUUID()};</script>
      </body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  },
});
console.log(`ArcMod agent fixture: ${server.url}a and ${server.url}b`);
