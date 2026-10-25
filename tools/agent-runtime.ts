import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { acquireLease, type Lease } from "./agent-lease";
import { agentToolsEnabled, sessionIdentity } from "./agent-session";
import { AgentCDP, verifyAgentEndpoint } from "./agent-cdp";
import { NativeController } from "./agent-native";
import { AgentBrowser, BrowserError } from "./agent-browser";
export interface RuntimeSession { readonly handle: string; readonly agent: string; readonly port: number; readonly pid: number; readonly browser: AgentBrowser; readonly lease: Lease; readonly launched: boolean; readonly native: NativeController; closing: boolean }
const command = async (args: readonly string[]): Promise<void> => {
  const child = Bun.spawn([...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new BrowserError("session_setup_failed", (stderr || stdout).slice(-4000), "Check agent session build/launch instructions.");
};
export class AgentRuntime {
  readonly sessions = new Map<string, RuntimeSession>();
  private stopping = false;
  private readonly opening = new Set<Promise<Record<string, unknown>>>();
  private stopOwned(agent: string): void {
    const executable = join(import.meta.dir, `../build/${sessionIdentity(false, agent).appName}.app/Contents/MacOS/Arc`);
    const processes = Bun.spawnSync(["/bin/ps", "-axo", "pid=,command="]).stdout.toString();
    for (const line of processes.split("\n")) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (match && (match[2] === executable || match[2]!.startsWith(`${executable} `))) {
        try { process.kill(Number(match[1]), "SIGTERM"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
      }
    }
  }
  async open(agent?: string, requestedPort?: number, attach = false): Promise<Record<string, unknown>> {
    if (this.stopping) throw new BrowserError("server_stopping", "Server is shutting down");
    const work = this.openOwned(agent, requestedPort, attach); this.opening.add(work);
    try { return await work; } finally { this.opening.delete(work); }
  }
  private async openOwned(agent?: string, requestedPort?: number, attach = false): Promise<Record<string, unknown>> {
    if (!agentToolsEnabled()) throw new BrowserError("agent_tools_off", "Agent browser tools are turned off in ArcMod", "Turn on Settings → ArcMod → Agent browser tools.");
    if (this.sessions.size + this.opening.size >= 8) throw new BrowserError("session_limit", "At most eight sessions per server");
    const slug = agent ?? `cu-${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`; const identity = sessionIdentity(false, slug);
    const lease = acquireLease(slug); let client: AgentCDP | undefined; let launched = false;
    try {
      let port = requestedPort;
      if (port === undefined) { const reserve = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() }); port = reserve.port!; reserve.stop(true); }
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new BrowserError("invalid_arguments", "port must be 1024..65535");
      if (!attach) {
        const app = join(import.meta.dir, `../build/${identity.appName}.app`);
        if (!existsSync(app)) {
          const deadline = Date.now() + 30000;
          for (;;) {
            try { await command([process.execPath, join(import.meta.dir, "build-mod.ts"), "--agent", slug]); break; }
            catch (error) { if (!String(error).includes("session_busy") || Date.now() >= deadline) throw error; await Bun.sleep(100); }
          }
        }
        await command([join(import.meta.dir, "run-mod.sh"), "--agent", slug, "--background", "--cdp-port", String(port)]);
        launched = true;
        if (this.stopping) throw new BrowserError("server_stopping", "Server stopped during launch");
      }
      const end = Date.now() + 20000; let pid = 0; let last: unknown;
      while (Date.now() < end && !this.stopping) {
        try {
          pid = verifyAgentEndpoint(slug, port);
          const ready = JSON.parse(readFileSync(join(homedir(), "Library/Application Support", identity.appName, "ArcModAgentReady.json"), "utf8"));
          if (ready.pid !== pid || ready.agent !== slug || ready.ready !== true) throw new BrowserError("native_not_ready", "Native browser window is not ready yet");
          client = await AgentCDP.connectAgent(slug, port); break;
        }
        catch (error) { last = error; if (attach) throw error; await Bun.sleep(100); }
      }
      if (!client) throw new BrowserError("session_start_timeout", String(last));
      if (this.stopping) { client.close(); throw new BrowserError("server_stopping", "Server stopped during connection"); }
      const session: RuntimeSession = { handle: `session-${crypto.randomUUID()}`, agent: slug, port, pid, browser: new AgentBrowser(client), lease, launched, native: new NativeController(slug, port), closing: false };
      this.sessions.set(session.handle, session);
      return { session: session.handle, agent: slug, port, pid, bundleId: identity.bundleId, background: true, ownership: "exclusive cooperative controller", nativeUI: "separate native_state/native_action tools; no app activation requested" };
    } catch (error) { try { client?.close(); if (launched) this.stopOwned(slug); } finally { lease.release(); } throw error; }
  }
  get(handle: string): RuntimeSession {
    const session = this.sessions.get(handle);
    if (!session) throw new BrowserError("stale_session", "Session is closed or belongs to another server", "Use open_session.");
    if (session.closing) throw new BrowserError("session_closing", "Session is stopping; retry close_session");
    if (verifyAgentEndpoint(session.agent, session.port) !== session.pid) throw new BrowserError("session_restarted", "Agent process changed", "Close this session and reconnect.");
    return session;
  }
  async close(handle: string): Promise<Record<string, unknown>> {
    const session = this.sessions.get(handle);
    if (!session) throw new BrowserError("stale_session", "Session already closed");
    session.closing = true; let stopped = !session.launched;
    if (session.launched) {
      try { if (verifyAgentEndpoint(session.agent, session.port) !== session.pid) throw new BrowserError("session_restarted", "Agent process changed"); process.kill(session.pid, "SIGTERM"); }
      catch (error) {
        try { process.kill(session.pid, 0); } catch { stopped = true; }
        if (!stopped) { session.closing = false; throw error; }
      }
      const deadline = Date.now() + 5000;
      while (!stopped && Date.now() < deadline) { try { process.kill(session.pid, 0); } catch { stopped = true; } if (!stopped) await Bun.sleep(50); }
      if (!stopped) throw new BrowserError("close_timeout", "Agent is still stopping; exclusive ownership retained", "Retry close_session.");
    }
    this.sessions.delete(handle); session.browser.disposeConnection(); session.lease.release();
    return { session: handle, closed: true, appStopped: session.launched && stopped };
  }

  async shutdown(): Promise<void> {
    this.stopping = true; await Promise.allSettled(this.opening);
    // One unresponsive app must not prevent the other owned apps from stopping.
    await Promise.allSettled(Array.from(this.sessions.keys(), (handle) => this.close(handle)));
  }
}
