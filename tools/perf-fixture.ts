#!/usr/bin/env bun
// Local-only Back/Forward cache probe. No user browsing data is collected.
// Open /baseline/a or /optimized/a in ArcModValidation, click Next, then Back.
import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const output = join(import.meta.dir, "../profiles/perf-pass-20261013/navigation.jsonl");
mkdirSync(join(import.meta.dir, "../profiles/perf-pass-20261013"), { recursive: true });
const server = Bun.serve({
  hostname: "127.0.0.1", port: 8766,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/event" && request.method === "POST") {
      const event: unknown = await request.json();
      appendFileSync(output, `${JSON.stringify(event)}\n`);
      return new Response(null, { status: 204 });
    }
    const match = /^\/(baseline|optimized)\/(a|b)$/.exec(url.pathname);
    if (!match) return new Response("Not found", { status: 404 });
    const phase = match[1], page = match[2];
    // Deliberately slow document response makes a reload distinguishable from a restore.
    await Bun.sleep(300);
    return new Response(`<!doctype html><html><head><title>ArcMod performance probe ${page}</title></head>
      <body><h1>ArcMod performance probe ${page}</h1>
      <p id="result">Waiting for page show</p><a href="/${phase}/${page === "a" ? "b" : "a"}?rev=3">Next page</a>
      <button onclick="history.back()">Back through browser history</button>
      <input placeholder="State should survive Back" value="kept state">
      <script>
      const marker = crypto.randomUUID();
      addEventListener('pageshow', event => {
        const result = { phase: ${JSON.stringify(phase)}, page: ${JSON.stringify(page)}, persisted: event.persisted,
          marker, documentAgeMs: performance.now(), navigation: performance.getEntriesByType('navigation')[0].type };
        document.getElementById('result').textContent = 'Back/Forward cache: ' + event.persisted;
        fetch('/event', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(result), keepalive:true});
      });
      </script></body></html>`, { headers: { "Content-Type": "text/html", "Cache-Control": "no-cache" } });
  },
});
console.log(`ArcMod local performance fixture: ${server.url}baseline/a`);
