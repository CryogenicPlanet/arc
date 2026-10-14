import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLease } from "./agent-lease";
import { AgentBrowser } from "./agent-browser";
import { AgentCDP, type CDPEvent, type CDPResult } from "./agent-cdp";
import { AgentRuntime, type RuntimeSession } from "./agent-runtime";
import { MCPAdapter, validateArguments } from "./agent-mcp";
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
describe("exclusive controller ownership", () => {
  test("same slug contends across processes; distinct slugs succeed and release is idempotent", () => {
    const dir = mkdtempSync(join(tmpdir(), "arcmod-lease-")); directories.push(dir);
    const one = acquireLease("alpha", dir); const two = acquireLease("beta", dir);
    const code = `import {acquireLease} from ${JSON.stringify(join(import.meta.dir,"agent-lease.ts"))};acquireLease('alpha',${JSON.stringify(dir)});`;
    const child = Bun.spawnSync([process.execPath, "--eval", code], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    expect(child.exitCode).not.toBe(0); expect(child.stderr.toString()).toContain("session_busy");
    one.release(); one.release(); const replacement = acquireLease("alpha", dir); replacement.release(); two.release();
  });
  test("SIGKILL releases kernel ownership without deleting/replacing the lock inode", async () => {
    const dir = mkdtempSync(join(tmpdir(), "arcmod-lease-")); directories.push(dir);
    const code = `import {acquireLease} from ${JSON.stringify(join(import.meta.dir,"agent-lease.ts"))};const l=acquireLease('alpha',${JSON.stringify(dir)});console.log('held');setInterval(()=>{},1000);`;
    const child = Bun.spawn([process.execPath, "--eval", code], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const reader = child.stdout.getReader(); const first = await reader.read(); expect(new TextDecoder().decode(first.value)).toContain("held");
    expect(() => acquireLease("alpha", dir)).toThrow("session_busy"); child.kill("SIGKILL"); await child.exited;
    const replacement = acquireLease("alpha", dir); replacement.release(); reader.releaseLock();
  });
});
class FakeCDP {
  listener: ((event: CDPEvent) => void) | undefined; calls: string[] = []; loader = "old"; href = "https://old.example/"; ready = "complete"; pendingLoader = ""; polls = 0;
  onEvent(callback: (event: CDPEvent) => void) { this.listener = callback; return () => { this.listener = undefined; }; }
  close() {}
  async request(method: string): Promise<CDPResult> { this.calls.push(method); if (method === "Target.createTarget") return { targetId: "PAGE" }; if (method === "Target.closeTarget") return { success: true }; return { targetInfos: [{ type: "page", targetId: "PAGE", url: this.href, title: "Fixture" }] }; }
  async targetCommand(_id: string, method: string, params: CDPResult = {}): Promise<CDPResult> {
    this.calls.push(method);
    if (method === "Page.navigate") { this.pendingLoader = "new"; return { loaderId: "new" }; }
    if (method === "Page.getFrameTree") { if (this.pendingLoader && ++this.polls >= 3) { this.loader = this.pendingLoader; this.href = "https://new.example/"; } return { frameTree: { frame: { id: "main", loaderId: this.loader, url: this.href } } }; }
    if (method === "Runtime.evaluate") {
      const expression = String(params.expression);
      if (expression.includes("ready:")) return { result: { value: { ready: this.ready, url: this.href } } };
      return { result: { value: { url: this.href, title: "Fixture", text: "loaded", viewport: { width: 100, height: 100, devicePixelRatio: 2 } } } };
    }
    if (method === "Accessibility.getFullAXTree") return { nodes: [{ nodeId: "1", role: { value: "button" }, name: { value: "Save" }, backendDOMNodeId: 42 }] };
    if (method === "DOM.resolveNode") return { object: { objectId: "node42" } };
    if (method === "Runtime.callFunctionOn") return { result: { value: { connected: true, x: 10, y: 10, width: 20, height: 20 } } };
    return {};
  }
}
const browser = (): { client: FakeCDP; browser: AgentBrowser } => { const client = new FakeCDP(); return { client, browser: new AgentBrowser(client as unknown as AgentCDP) }; };
describe("browser handles and readiness", () => {
  test("foreign pages fail before any browser input", async () => { const b = browser(); await expect(b.browser.read("foreign")).rejects.toThrow("Page handle"); expect(b.client.calls).toEqual([]); });
  test("new loader must arrive even when departing document is complete", async () => {
    const b = browser(); const [page] = await b.browser.list(); const state = await b.browser.navigate(page!.page as string, "https://new.example/", 1000);
    expect(state.url).toBe("https://new.example/"); expect(b.client.polls).toBeGreaterThanOrEqual(3);
  });
  test("fresh snapshots and document changes invalidate old element handles before input", async () => {
    const b = browser(); const [page] = await b.browser.list(); const handle = page!.page as string;
    const state = await b.browser.read(handle); const old = state.elements[0]!.handle;
    await b.browser.read(handle); await expect(b.browser.click(handle, old)).rejects.toThrow("Element is foreign, stale");
    const next = await b.browser.read(handle); b.client.loader = "other";
    await expect(b.browser.click(handle, next.elements[0]!.handle)).rejects.toThrow("Element is foreign, stale"); expect(b.client.calls.some((call) => call.startsWith("Input."))).toBe(false);
  });
  test("empty append never dispatches deletion or other input", async () => {
    const b = browser(); const [page] = await b.browser.list(); const handle = page!.page as string;
    const state = await b.browser.read(handle); await b.browser.type(handle, state.elements[0]!.handle, "", false);
    expect(b.client.calls.some((call) => call.startsWith("Input."))).toBe(false);
  });
  test("closed targets and disconnected generations cannot be reused", async () => {
    const b = browser(); const [page] = await b.browser.list(); const handle = page!.page as string;
    await b.browser.close(handle); await expect(b.browser.read(handle)).rejects.toThrow("Page handle");
    const [next] = await b.browser.list(); b.client.listener!({ method: "ArcMod.disconnected", params: {} }); await expect(b.browser.read(next!.page as string)).rejects.toThrow("Browser connection closed");
  });
});
test("shutdown still closes remaining sessions after one close failure", async () => {
  const runtime = new AgentRuntime(); runtime.sessions.set("one", {} as RuntimeSession); runtime.sessions.set("two", {} as RuntimeSession);
  const closed: string[] = []; runtime.close = async (handle) => { closed.push(handle); if(handle==="one")throw new Error("timeout"); return {closed:true}; };
  await runtime.shutdown(); expect(closed).toEqual(["one","two"]);
});
describe("MCP framing and argument contract", () => {
  test("preserves request id zero, responds to handshake/list, ignores notifications", async () => {
    const adapter = new MCPAdapter(); const init = await adapter.message({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-11-25" } }); expect(init!.id).toBe(0);
    expect(await adapter.message({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeUndefined();
    const list = await adapter.message({ jsonrpc: "2.0", id: "list", method: "tools/list" }); expect((list!.result as { tools: unknown[] }).tools.length).toBe(15);
  });
  test("unknown/extra/malformed tool arguments produce contextual errors", async () => {
    for (const [name, args] of [["click", { session: "s", page: "p", element: "e", x: 1 }], ["type", { session: "s", page: "p", element: "e", text: 42 }], ["wait_for", { session: "s", page: "p", text: "ok", timeout_ms: 0 }], ["open_session", { attach: true }]] as const) expect(() => validateArguments(name, args)).toThrow();
    const response = await new MCPAdapter().call("unknown", {}); expect(response.isError).toBe(true); expect(JSON.stringify(response)).toContain("unknown_tool");
  });
  test("same-session calls serialize while independent session calls overlap", async () => {
    const events: string[] = []; let active = 0; let peak = 0;
    const fake = { get: (session: string) => ({ browser: { read: async () => { events.push(`start-${session}`); active++; peak=Math.max(peak,active); await Bun.sleep(20); active--; events.push(`end-${session}`); return { session }; } } }) };
    const adapter = new MCPAdapter(fake as unknown as import("./agent-runtime").AgentRuntime);
    await Promise.all([adapter.call("read_page",{session:"a",page:"p"}),adapter.call("read_page",{session:"a",page:"p"}),adapter.call("read_page",{session:"b",page:"p"})]);
    expect(peak).toBe(2); expect(events.filter((event)=>event.endsWith("-a"))).toEqual(["start-a","end-a","start-a","end-a"]);
  });
  test("stdio accepts chunked messages and emits only JSON-RPC", async () => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir,"agent-mcp.ts")], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    child.stdin.write('{"jsonrpc":"2.0","id":0,"method":"initialize","params":'); child.stdin.write('{"protocolVersion":"2025-11-25"}}\n');
    child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n'); child.stdin.end();
    const output = await new Response(child.stdout).text(); expect(await child.exited).toBe(0); const replies = output.trim().split("\n").map((line) => JSON.parse(line)); expect(replies.map((reply) => reply.id)).toEqual([0,1]);
  });
});
