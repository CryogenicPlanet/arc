#!/usr/bin/env bun
// Opt-in end-to-end stdio MCP test; starts/stops only fresh controller-owned
// agent apps and disposable localhost tabs. Run agent-control-fixture.ts first.
import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
class Client {
  private id = 0;
  private buffer = "";
  private pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  readonly child = Bun.spawn([process.execPath, join(import.meta.dir, "agent-mcp.ts")], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  constructor() {
    void (async () => {
      const reader = this.child.stdout.getReader(); const decoder = new TextDecoder();
      for (;;) {
        const next = await reader.read(); if (next.done) break;
        this.buffer += decoder.decode(next.value, { stream: true }); let end: number;
        while ((end = this.buffer.indexOf("\n")) >= 0) {
          const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1); const message = JSON.parse(line);
          const work = this.pending.get(message.id); if (!work) continue; this.pending.delete(message.id); clearTimeout(work.timer);
          if (message.error) work.reject(new Error(JSON.stringify(message.error))); else work.resolve(message.result);
        }
      }
    })();
  }
  request(method: string, params: unknown = {}): Promise<Record<string, unknown>> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`MCP timeout: ${method}`)); }, 60000);
      this.pending.set(id, { resolve, reject, timer }); this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  async start(): Promise<void> { await this.request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "arcmod-live-test", version: "1" } }); this.child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n'); }
  async raw(name: string, args: unknown): Promise<Record<string, unknown>> { return this.request("tools/call", { name, arguments: args }); }
  async call(name: string, args: unknown): Promise<Record<string, unknown>> { const response = await this.raw(name, args); assert(!response.isError, JSON.stringify(response)); return response.structuredContent as Record<string, unknown>; }
  async stop(): Promise<void> { this.child.stdin.end(); await this.child.exited; }
}
interface State { page: string; elements: { handle: string; role: string; name: string; value?: unknown; actionable: boolean }[]; text: string }
const element = (state: State, name: string): string => {
  const found = state.elements.find((node) => node.actionable && node.name === name); assert(found, `Missing ${name}`); return found.handle;
};
const clients = [new Client(), new Client()]; const output = join(import.meta.dir, "../profiles/agent-control"); mkdirSync(output, { recursive: true });
const front = (): string => Bun.spawnSync(["/usr/bin/lsappinfo", "front"]).stdout.toString().trim();
const samples: { at: number; front: string }[] = []; const sample = setInterval(() => samples.push({ at: Date.now(), front: front() }), 100);
const reports: Record<string, unknown>[] = [];
try {
  await Promise.all(clients.map((client) => client.start()));
  const sessions = await Promise.all(clients.map((client) => client.call("open_session", {agent: `cu-test-${clients.indexOf(client)===0?"alpha":"beta"}`, port: clients.indexOf(client)===0?9241:9242})));
  console.log("Two independent MCP owners and signed agent apps started");
  assert.notEqual(sessions[0]!.agent, sessions[1]!.agent); assert.notEqual(sessions[0]!.port, sessions[1]!.port);
  const starts: number[] = []; const ends: number[] = [];
  await Promise.all(clients.map(async (client, index) => {
    const session = sessions[index]!.session as string; starts[index] = Date.now();
    let state = await client.call("open_tab", { session, url: "http://127.0.0.1:8779/" }) as unknown as State; const page = state.page;
    assert(state.elements.some((node) => node.name === "Password" && node.value === "[redacted]"));
    const old = element(state, "Worker note");
    state = await client.call("read_page", { session, page }) as unknown as State;
    assert((await client.raw("type", { session, page, element: old, text: "stale" })).isError);
    state = await client.call("type", { session, page, element: element(state, "Worker note"), text: "temporary" }) as unknown as State;
    state = await client.call("type", { session, page, element: element(state, "Worker note"), text: "", replace: false }) as unknown as State;
    assert.equal(state.elements.find((node)=>node.actionable && node.name==="Worker note")!.value,"temporary");
    state = await client.call("type", { session, page, element: element(state, "Worker note"), text: "" }) as unknown as State;
    assert.equal(state.elements.find((node)=>node.actionable && node.name==="Worker note")!.value,"");
    state = await client.call("type", { session, page, element: element(state, "Worker note"), text: `worker-${index}` }) as unknown as State;
    state = await client.call("click", { session, page, element: element(state, "Save note") }) as unknown as State;
    assert(state.text.includes(`Saved: worker-${index}`)); assert(state.text.includes("Trusted events: true"));
    state = await client.call("click", { session, page, element: element(state, "Delayed result") }) as unknown as State;
    state = await client.call("wait_for", { session, page, text: "Async complete", timeout_ms: 3000 }) as unknown as State;
    assert(state.text.includes("Async complete"));
    const shot = await client.raw("screenshot", { session, page }); assert(!shot.isError);
    const image = (shot.content as { type: string; data: string }[]).find((item) => item.type === "image")!;
    writeFileSync(join(output, `worker-${index}.png`), Buffer.from(image.data, "base64"));
    state = await client.call("click", { session, page, element: element(state, "Slow document") }) as unknown as State;
    assert(state.text.includes("Slow document ready"));
    state = await client.call("back", { session, page }) as unknown as State; assert(state.text.includes("Agent tool fixture"));
    state = await client.call("forward", { session, page }) as unknown as State; assert(state.text.includes("Slow document ready"));
    const native = await client.raw("native_state", { session });
    assert(!native.isError, JSON.stringify(native));
    const nativeElements = (native.structuredContent as { elements: { handle: string; identifier: string; label: string }[] }).elements;
    const badge = nativeElements.find((node) => node.identifier === "ArcModBadge"); assert(badge); assert(badge.label.includes(String(sessions[index]!.agent)));
    await client.call("native_state", { session });
    assert((await client.raw("native_action", { session, element: badge.handle, action: "press" })).isError);
    const contender = Bun.spawnSync([process.execPath, join(import.meta.dir, "agent-cdp.ts"), "--agent", String(sessions[index]!.agent), "--port", String(sessions[index]!.port), "list"]);
    assert(!contender.success && contender.stderr.toString().includes("session_busy"));
    ends[index] = Date.now(); reports.push({ worker: index, session: sessions[index], page, start: starts[index], end: ends[index], formPassed: true, asyncPassed: true, navigationHistoryPassed: true, oldElementsRejected: true, CLIContenderRejected: true, screenshot: shot.structuredContent, native });
  }));
  for (const [index, client] of clients.entries()) {
    const mine = sessions[index]!.session as string; const other = reports.find((report) => report.worker !== index)!;
    assert((await client.raw("read_page", { session: mine, page: other.page })).isError);
    const page = reports.find((report) => report.worker === index)!.page;
    await client.call("close_tab", { session: mine, page }); assert((await client.raw("read_page", { session: mine, page })).isError);
  }
  const overlapMs = Math.min(...ends) - Math.max(...starts); assert(overlapMs > 0);
  clearInterval(sample);
  // Resolve just the agent app identities to foreground ASNs, without user titles.
  const agentPids = new Set(sessions.map((session) => Number(session.pid)));
  let foregroundViolations = 0;
  for (const asn of new Set(samples.map((entry) => entry.front))) {
    const info = Bun.spawnSync(["/usr/bin/lsappinfo", "info", "-only", "pid", asn]).stdout.toString(); const pid = Number(info.match(/pid"?\s*=\s*(\d+)/i)?.[1]);
    if (agentPids.has(pid)) foregroundViolations += samples.filter((entry) => entry.front === asn).length;
  }
  assert.equal(foregroundViolations, 0);
  writeFileSync(join(output, "report.json"), JSON.stringify({ reports, overlapMs, foregroundSamples: samples.length, foregroundViolations }, null, 2));
  console.log(JSON.stringify({ workers: 2, overlapMs, foregroundSamples: samples.length, foregroundViolations, report: join(output, "report.json") }));
} finally { clearInterval(sample); for (const client of clients) await client.stop(); }
