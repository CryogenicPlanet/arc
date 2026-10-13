#!/usr/bin/env bun
// Explicit background browser control for an already-running Arc Mod agent session.
// No window selection, native focus changes, target URL matching or first-tab fallbacks.
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sessionIdentity } from "./agent-session";

export type CDPParams = Record<string, unknown>;
export type CDPResult = Record<string, unknown>;
export interface PageTarget { readonly id: string; readonly title: string; readonly url: string }
export interface Command { readonly name: string; readonly args: readonly string[] }
export interface CDPOptions { readonly agent: string; readonly port: number; readonly command: Command }
const timeoutMs = 10_000;

const parsePort = (value: string): number => {
  if (!/^[1-9][0-9]{3,4}$/.test(value) || Number(value) < 1024 || Number(value) > 65535) throw new Error("port must be an integer from 1024 to 65535");
  return Number(value);
};
const targetId = (id: string): string => {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("invalid target ID; use an explicit page ID from list");
  return id;
};
const navigationURL = (value: string): string => {
  const url = new URL(value);
  if (!["http:", "https:", "file:"].includes(url.protocol) && value !== "about:blank") throw new Error("navigation requires an http, https, file URL or about:blank; use evaluate for scripts");
  return value;
};
const coordinate = (value: string): number => {
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value) || !Number.isFinite(Number(value))) throw new Error("click coordinates must be finite nonnegative numbers");
  return Number(value);
};
export const parseCDPOptions = (args: readonly string[]): CDPOptions => {
  const values = new Map<string, string>();
  let index = 0;
  while (args[index]?.startsWith("--")) {
    const flag = args[index++]!;
    if (flag !== "--agent" && flag !== "--port") throw new Error(`unrecognized option: ${flag}`);
    if (values.has(flag)) throw new Error(`duplicate option: ${flag}`);
    const value = args[index++];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${flag}`);
    values.set(flag, value);
  }
  const agent = values.get("--agent");
  const port = values.get("--port");
  if (!agent || !port) throw new Error("usage: bun tools/agent-cdp.ts --agent <slug> --port <port> list|open URL|navigate TARGET URL|evaluate TARGET EXPRESSION|screenshot TARGET PATH|click TARGET X Y|type TARGET TEXT|close TARGET");
  sessionIdentity(false, agent);
  const name = args[index++];
  const commandArgs = args.slice(index);
  const counts: Record<string, number> = { list: 0, open: 1, navigate: 2, evaluate: 2, screenshot: 2, click: 3, type: 2, close: 1 };
  if (!name || !Object.hasOwn(counts, name)) throw new Error(`unrecognized command: ${name ?? "(missing)"}`);
  if (commandArgs.length !== counts[name]) throw new Error(`wrong argument count for ${name}`);
  if (name === "open") navigationURL(commandArgs[0]!);
  else if (name !== "list") targetId(commandArgs[0]!);
  if (name === "navigate") navigationURL(commandArgs[1]!);
  if (name === "click") { coordinate(commandArgs[1]!); coordinate(commandArgs[2]!); }
  if (name === "screenshot" && !commandArgs[1]) throw new Error("screenshot path is empty");
  return { agent, port: parsePort(port), command: { name, args: commandArgs } };
};

// lsof -F output contains one p field per owning process and one n field per listener.
export const verifyListener = (output: string, command: string, expectedExecutable: string, port: number): number => {
  const listeners: { pid: number; address: string }[] = [];
  let pid = 0;
  for (const line of output.trim().split("\n")) {
    if (line.startsWith("p")) {
      if (!/^p[1-9][0-9]*$/.test(line)) throw new Error("malformed listener process ID");
      pid = Number(line.slice(1));
    } else if (line.startsWith("n")) {
      if (!pid) throw new Error("listener has no owning process");
      listeners.push({ pid, address: line.slice(1) });
    }
  }
  if (listeners.length !== 1) throw new Error("CDP requires exactly one loopback listener");
  const listener = listeners[0]!;
  if (listener.address !== `127.0.0.1:${port}` && listener.address !== `[::1]:${port}`) throw new Error("CDP listener must bind only to loopback");
  const processCommand = command.trim();
  if (processCommand !== expectedExecutable && !processCommand.startsWith(`${expectedExecutable} `)) throw new Error("CDP listener is not owned by the requested Arc Mod agent executable");
  return listener.pid;
};
export const validateDebugSocket = (value: unknown, port: number, kind: "browser" | "page", id?: string): string => {
  if (typeof value !== "string") throw new Error("missing CDP websocket address");
  const url = new URL(value);
  if (url.href !== value) throw new Error("malformed CDP websocket address");
  if (url.protocol !== "ws:" || !["127.0.0.1", "[::1]"].includes(url.hostname) || url.port !== String(port) || url.username || url.password || url.search || url.hash) throw new Error("invalid CDP websocket address; expected this loopback port");
  const match = url.pathname.match(/^\/devtools\/(browser|page)\/([A-Za-z0-9_-]+)$/);
  if (!match || match[1] !== kind || (id !== undefined && match[2] !== id)) throw new Error("invalid CDP websocket target path");
  return url.href;
};
const processOutput = (args: readonly string[]): string => {
  const result = Bun.spawnSync([...args], { stdout: "pipe", stderr: "pipe" });
  if (!result.success) throw new Error(`process inspection failed: ${args[0]} ${result.stderr.toString().trim()}`);
  return result.stdout.toString();
};
export const verifyAgentEndpoint = (agent: string, port: number): void => {
  parsePort(String(port));
  const identity = sessionIdentity(false, agent);
  const executable = join(import.meta.dir, `../build/${identity.appName}.app/Contents/MacOS/Arc`);
  const output = processOutput(["/usr/sbin/lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpn"]);
  const pids = [...output.matchAll(/^p([1-9][0-9]*)$/gm)].map((match) => match[1]!);
  if (pids.length !== 1) throw new Error("CDP requires exactly one owning process");
  const command = processOutput(["/bin/ps", "-p", pids[0]!, "-o", "command="]);
  verifyListener(output, command, executable, port);
};
const object = (value: unknown): CDPResult => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("malformed CDP response");
  return value as CDPResult;
};
const endpointJSON = async (port: number, path: string): Promise<unknown> => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`CDP ${path} returned HTTP ${response.status}`);
  return response.json();
};
export const listAgentPages = async (agent: string, port: number): Promise<readonly PageTarget[]> => {
  verifyAgentEndpoint(agent, port);
  const result = await endpointJSON(port, "/json/list");
  if (!Array.isArray(result)) throw new Error("malformed CDP page list");
  return result.filter((entry: unknown) => object(entry).type === "page").map((entry: unknown) => {
    const page = object(entry);
    if (typeof page.id !== "string" || typeof page.title !== "string" || typeof page.url !== "string") throw new Error("malformed CDP page metadata");
    targetId(page.id);
    validateDebugSocket(page.webSocketDebuggerUrl, port, "page", page.id);
    return { id: page.id, title: page.title, url: page.url };
  });
};

interface Pending { resolve: (result: CDPResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
export class AgentCDP {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly sessions = new Map<string, string>();
  private closed = false;
  private constructor(private readonly socket: WebSocket, private readonly commandTimeoutMs: number) {
    socket.addEventListener("message", (event) => {
      try {
        const message = object(JSON.parse(String(event.data)));
        if (typeof message.id !== "number") return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        const result = message.error === undefined ? object(message.result) : undefined;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error !== undefined) pending.reject(new Error(`CDP error: ${JSON.stringify(message.error)}`));
        else pending.resolve(result!);
      } catch (error) { this.failAll(new Error(`invalid CDP websocket message: ${String(error)}`)); }
    });
    socket.addEventListener("close", () => this.failAll(new Error("CDP websocket disconnected")));
    socket.addEventListener("error", () => this.failAll(new Error("CDP websocket failed")));
  }
  // Tests may exercise protocol transport against a fake loopback endpoint; real callers use connectAgent.
  static async connectSocket(address: string, port: number, commandTimeoutMs = timeoutMs): Promise<AgentCDP> {
    validateDebugSocket(address, port, "browser");
    if (!Number.isFinite(commandTimeoutMs) || commandTimeoutMs <= 0) throw new Error("invalid CDP timeout");
    const socket = new WebSocket(address);
    const client = new AgentCDP(socket, commandTimeoutMs);
    await new Promise<void>((resolveReady, rejectReady) => {
      const timer = setTimeout(() => { cleanup(); client.close(); rejectReady(new Error("CDP connection timed out")); }, commandTimeoutMs);
      const ready = (): void => { cleanup(); resolveReady(); };
      const failed = (): void => { cleanup(); client.close(); rejectReady(new Error("CDP connection failed")); };
      const cleanup = (): void => { clearTimeout(timer); socket.removeEventListener("open", ready); socket.removeEventListener("error", failed); socket.removeEventListener("close", failed); };
      socket.addEventListener("open", ready);
      socket.addEventListener("error", failed);
      socket.addEventListener("close", failed);
    });
    return client;
  }
  static async connectAgent(agent: string, port: number): Promise<AgentCDP> {
    verifyAgentEndpoint(agent, port);
    const version = object(await endpointJSON(port, "/json/version"));
    const address = validateDebugSocket(version.webSocketDebuggerUrl, port, "browser");
    return AgentCDP.connectSocket(address, port);
  }
  request(method: string, params: CDPParams = {}, sessionId?: string): Promise<CDPResult> {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("CDP websocket is closed"));
    const id = this.nextId++;
    return new Promise((resolveResult, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP command timed out: ${method}`)); }, this.commandTimeoutMs);
      this.pending.set(id, { resolve: resolveResult, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(new Error(`CDP send failed: ${String(error)}`)); }
    });
  }
  async targetCommand(id: string, method: string, params: CDPParams = {}): Promise<CDPResult> {
    targetId(id);
    let session = this.sessions.get(id);
    if (!session) {
      const info = object((await this.request("Target.getTargetInfo", { targetId: id })).targetInfo);
      if (info.targetId !== id || info.type !== "page") throw new Error("requested target is not an existing page");
      const attached = await this.request("Target.attachToTarget", { targetId: id, flatten: true });
      if (typeof attached.sessionId !== "string" || !attached.sessionId) throw new Error("missing CDP target session");
      session = attached.sessionId;
      this.sessions.set(id, session);
    }
    return this.request(method, params, session);
  }
  private failAll(error: Error): void {
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    this.sessions.clear();
    if (this.socket.readyState !== WebSocket.CLOSED) this.socket.close();
  }
  close(): void { this.failAll(new Error("CDP connection closed")); }
}

// Chromium ignores trusted input to hidden Arc targets unless renderer focus is emulated.
// This changes only the target's focus emulation, never the native application's activation.
const frameBarrier = async (client: AgentCDP, id: string, expression: string): Promise<void> => {
  const result = await client.targetCommand(id, "Runtime.evaluate", { expression, awaitPromise: true });
  if (result.exceptionDetails !== undefined) throw new Error(`input frame synchronization failed: ${JSON.stringify(result.exceptionDetails)}`);
};

const withTargetFocus = async <T>(client: AgentCDP, id: string, action: () => Promise<T>): Promise<T> => {
  let result: T | undefined;
  let failed = false;
  let failure: unknown;
  let cleanupFailed = false;
  let cleanupFailure: unknown;
  try {
    await client.targetCommand(id, "Emulation.setFocusEmulationEnabled", { enabled: true });
    // A focus-emulation ACK does not establish compositor readiness. Two frames
    // let renderer focus and hit-testing settle before trusted input dispatch.
    await frameBarrier(client, id, "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    result = await action();
    // Drain queued input and its rendering before restoring hidden-page focus.
    await frameBarrier(client, id, "new Promise(resolve => requestAnimationFrame(resolve))");
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    try { await client.targetCommand(id, "Emulation.setFocusEmulationEnabled", { enabled: false }); }
    catch (error) { cleanupFailed = true; cleanupFailure = error; }
  }
  if (failed && cleanupFailed) throw new AggregateError([failure, cleanupFailure], "input failed and target focus emulation could not be reset");
  if (failed) throw failure;
  if (cleanupFailed) throw cleanupFailure;
  return result as T;
};

export const executeCommand = async (client: AgentCDP, command: Command): Promise<CDPResult> => {
  const [id, value, y] = command.args;
  switch (command.name) {
    case "open": return client.request("Target.createTarget", { url: navigationURL(id!), background: true });
    case "navigate": return client.targetCommand(id!, "Page.navigate", { url: navigationURL(value!) });
    case "evaluate": {
      const result = await client.targetCommand(id!, "Runtime.evaluate", { expression: value!, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails !== undefined) throw new Error(`page evaluation failed: ${JSON.stringify(result.exceptionDetails)}`);
      return result;
    }
    case "screenshot": {
      const result = await client.targetCommand(id!, "Page.captureScreenshot", { format: "png" });
      if (typeof result.data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(result.data)) throw new Error("missing PNG screenshot data");
      const image = Buffer.from(result.data, "base64");
      if (!image.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) throw new Error("screenshot response is not PNG");
      const path = resolve(value!);
      writeFileSync(path, image);
      return { targetId: id, path, bytes: image.length };
    }
    case "click": {
      const params = { x: coordinate(value!), y: coordinate(y!), button: "left", clickCount: 1 };
      await withTargetFocus(client, id!, async () => {
        await client.targetCommand(id!, "Input.dispatchMouseEvent", { ...params, type: "mousePressed", buttons: 1 });
        const release = (): Promise<CDPResult> => client.targetCommand(id!, "Input.dispatchMouseEvent", { ...params, type: "mouseReleased", buttons: 0 });
        try { await release(); }
        catch (error) {
          // A successful press must not leave the target with a held button.
          // Retry only release as cleanup; never replay the press or mask failure.
          try { await release(); } catch { /* Target/session may already be gone. */ }
          throw error;
        }
      });
      return { targetId: id, x: params.x, y: params.y };
    }
    case "type": await withTargetFocus(client, id!, () => client.targetCommand(id!, "Input.insertText", { text: value! })); return { targetId: id };
    case "close": {
      // getTargetInfo validates that the exact ID is still an existing page.
      await client.targetCommand(id!, "Runtime.enable");
      const result = await client.request("Target.closeTarget", { targetId: id! });
      if (result.success !== true) throw new Error("target did not close");
      return { targetId: id, ...result };
    }
    default: throw new Error(`unsupported connected command: ${command.name}`);
  }
};

if (import.meta.main) {
  let client: AgentCDP | undefined;
  try {
    const options = parseCDPOptions(Bun.argv.slice(2));
    let result: unknown;
    if (options.command.name === "list") result = await listAgentPages(options.agent, options.port);
    else { client = await AgentCDP.connectAgent(options.agent, options.port); result = await executeCommand(client, options.command); }
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
  finally { client?.close(); }
}
