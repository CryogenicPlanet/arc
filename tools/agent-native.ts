import { existsSync, mkdirSync, statSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { acquireLease } from "./agent-lease";
import { join } from "node:path";
import { verifyAgentEndpoint } from "./agent-cdp";
import { BrowserError, record } from "./agent-browser";
const source = join(import.meta.dir, "agent-native.swift");
const helper = join(import.meta.dir, "../build/agent-native");
const run = (args: readonly string[]): Record<string, unknown> => {
  const result = Bun.spawnSync([...args], { stdout: "pipe", stderr: "pipe", timeout: 10000 });
  if (!result.success) throw new BrowserError("native_unavailable", result.stderr.toString().trim(), "Use the page tools for web content; obtain fresh native state for native controls.");
  return record(JSON.parse(result.stdout.toString()));
};
export const nativeState = (agent: string, port: number, action?: { path: string; fingerprint: string; pid?: number; kind: "press" | "set" | "perform"; value?: string }): Record<string, unknown> => {
  const pid = verifyAgentEndpoint(agent, port);
  if (action?.pid !== undefined && action.pid !== pid) throw new BrowserError("stale_native_element", "Native element belongs to an earlier agent process", "Use native_state in the current session.");
  if (!existsSync(helper) || statSync(helper).mtimeMs < statSync(source).mtimeMs) {
    mkdirSync(join(import.meta.dir, "../build"), { recursive: true });
    const lease = acquireLease("native", join(homedir(), ".arcmod", "build-locks"));
    const temporary = `${helper}.${crypto.randomUUID()}`;
    try {
      if (!existsSync(helper) || statSync(helper).mtimeMs < statSync(source).mtimeMs) {
        const result = Bun.spawnSync(["xcrun", "swiftc", "-O", source, "-o", temporary], { stdout: "pipe", stderr: "pipe", timeout: 10000 });
        if (!result.success) throw new BrowserError("native_build_failed", result.stderr.toString());
        renameSync(temporary, helper);
      }
    } finally { rmSync(temporary, { force: true }); lease.release(); }
  }
  return run([helper, String(pid), agent, action?.kind ?? "snapshot", ...(action ? [action.path, action.fingerprint, ...(action.kind === "set" || action.kind === "perform" ? [action.value ?? ""] : [])] : [])]);
};

// Opaque native handles are scoped to one controller and one fresh snapshot.
export class NativeController {
  private readonly elements = new Map<string, { path: string; fingerprint: string; pid: number }>();
  constructor(readonly agent: string, readonly port: number) {}
  state(): Record<string, unknown> {
    this.elements.clear(); const state = nativeState(this.agent, this.port);
    if (typeof state.pid !== "number" || !Number.isInteger(state.pid) || state.pid <= 0) throw new BrowserError("invalid_response", "Missing native agent PID");
    const pid = state.pid;
    const nodes = state.elements as Record<string, unknown>[];
    return { ...state, snapshot: crypto.randomUUID(), elements: nodes.map((node) => {
      const handle = `native-${crypto.randomUUID()}`;
      this.elements.set(handle, { path: String(node.path), fingerprint: String(node.fingerprint), pid });
      return { ...node, handle };
    }) };
  }
  action(handle: string, kind: "press" | "set" | "perform", value?: string): Record<string, unknown> {
    const element = this.elements.get(handle);
    if (!element) throw new BrowserError("stale_native_element", "Native element is foreign or from an earlier snapshot", "Use native_state in this session.");
    if (kind === "set" && value === undefined) throw new BrowserError("invalid_arguments", "set requires an explicit value");
    if (kind === "perform" && !value) throw new BrowserError("invalid_arguments", "perform requires an explicit advertised action name");
    const receipt = nativeState(this.agent, this.port, { ...element, kind, ...(value === undefined ? {} : { value }) });
    return { receipt, state: this.state() };
  }
}
