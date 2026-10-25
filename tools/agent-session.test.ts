import { describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { parseBuildOptions, sessionIdentity, validateAgentSlug } from "./agent-session";

describe("agent build identity", () => {
  test("normal and validation keep existing identities", () => {
    expect(sessionIdentity().appName).toBe("ArcMod");
    expect(sessionIdentity().bundleId).toBe("company.thebrowser.Browser.mod");
    expect(sessionIdentity(true).appName).toBe("ArcModValidation");
    expect(sessionIdentity(true).bundleId).toBe("company.thebrowser.Browser.mod.validation");
  });

  test("agents have disjoint app, preference and data identities", () => {
    const one = sessionIdentity(false, "research-1");
    const two = sessionIdentity(false, "research-2");
    expect(one).toEqual({ appName: "ArcModAgent-research-1", bundleId: "company.thebrowser.Browser.mod.agent.research-1", displayName: "Arc Mod · research-1", agent: "research-1" });
    expect(new Set([one.appName, two.appName, sessionIdentity().appName]).size).toBe(3);
    expect(new Set([one.bundleId, two.bundleId, sessionIdentity().bundleId]).size).toBe(3);
  });

  test("rejects unsafe or ambiguous names", () => {
    for (const slug of ["", "Agent", "1agent", "../arc", "a.b", "a_b", "a b", "-a", "a-", "a--b", "a".repeat(33)]) {
      expect(() => validateAgentSlug(slug)).toThrow("agent slug");
    }
    expect(validateAgentSlug("a".repeat(32))).toHaveLength(32);
  });

  test("accepts arbitrary option order and source paths containing spaces", () => {
    expect(parseBuildOptions(["--agent", "scout", "--source", "/tmp/My Arc.app"])).toEqual({ source: "/tmp/My Arc.app", session: sessionIdentity(false, "scout") });
    expect(parseBuildOptions([]).source).toBe("/Applications/Arc.app");
    expect(parseBuildOptions(["--engine", "/tmp/out/ArcCore.framework"]).engine).toBe("/tmp/out/ArcCore.framework");
    expect(parseBuildOptions([]).engine).toBeUndefined();
  });

  test("rejects conflicting, duplicate, incomplete and unknown arguments", () => {
    for (const args of [["--validation", "--agent", "scout"], ["--agent"], ["--source"], ["--source", "--validation"], ["--agent", "scout", "--agent", "scout"], ["--validation", "--validation"], ["--source", "x", "--source", "y"], ["--engine"], ["--engine", "a", "--engine", "b"], ["--unknown"], ["positional"], ["--agent=scout"]]) {
      expect(() => parseBuildOptions(args)).toThrow();
    }
  });
});

// Real Bash/PlistBuddy parsing, with every launch/prefs/data mutation replaced by a recording stub.
const launch = (args: readonly string[], options: { readonly running?: string; readonly plistAgent?: string } = {}) => {
  const root = mkdtempSync(join(tmpdir(), "arc-agent-launch-"));
  try {
    mkdirSync(join(root, "tools"));
    mkdirSync(join(root, "stubs"));
    copyFileSync(join(import.meta.dir, "run-mod.sh"), join(root, "tools/run-mod.sh"));
    for (const [name, agent] of [["ArcMod", ""], ["ArcModValidation", ""], ["ArcModAgent-scout", options.plistAgent ?? "scout"]]) {
      const contents = join(root, `build/${name}.app/Contents`);
      mkdirSync(join(contents, "MacOS"), { recursive: true });
      writeFileSync(join(contents, "MacOS/Arc"), "#!/bin/sh\nexit 99\n");
      chmodSync(join(contents, "MacOS/Arc"), 0o755);
      writeFileSync(join(contents, "Info.plist"), `<?xml version="1.0"?><plist version="1.0"><dict><key>ArcModAgentSession</key><string>${agent}</string><key>ArcModHostResolverRules</key><string>MAP *.arc.net ~NOTFOUND</string></dict></plist>`);
    }
    for (const command of ["open", "defaults", "mkdir", "chmod", "pgrep"]) {
      const path = join(root, "stubs", command);
      writeFileSync(path, `#!/bin/bash\nprintf '%s\\0' "$@" >> "$ARC_TEST_TRACE/${command}"\n${command === "pgrep" ? 'if [[ -n "$ARC_TEST_RUNNING" ]]; then echo "$ARC_TEST_RUNNING"; else exit 1; fi' : "exit 0"}\n`);
      chmodSync(path, 0o755);
    }
    const result = Bun.spawnSync(["/bin/bash", join(root, "tools/run-mod.sh"), ...args], { env: { ...process.env, PATH: `${root}/stubs:/usr/bin:/bin`, ARC_TEST_TRACE: root, ARC_TEST_RUNNING: options.running ?? "" }, stdout: "pipe", stderr: "pipe" });
    const recorded = (command: string): string[] => existsSync(join(root, command)) ? readFileSync(join(root, command), "utf8").split("\0").slice(0, -1) : [];
    return { success: result.success, stderr: result.stderr.toString(), stdout: result.stdout.toString(), open: recorded("open"), defaults: recorded("defaults"), mkdir: recorded("mkdir"), pgrep: recorded("pgrep"), root };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

describe("launcher argument semantics", () => {
  test("default and validation launches preserve their isolation", () => {
    // --debug: the everyday ArcMod may also be installed in Applications, which run-mod.sh prefers otherwise.
    for (const [args, name, domain] of [[["--debug"], "ArcMod", "company.thebrowser.Browser.mod"], [["--validation"], "ArcModValidation", "company.thebrowser.Browser.mod.validation"]] as const) {
      const result = launch(args);
      expect(result.success).toBe(true);
      expect(result.open).toContain(`${result.root}/build/${name}.app`);
      expect(result.defaults).toContain(domain);
      expect(result.open).not.toContain("-g");
    }
  });

  test("background/CDP switches remain separate arguments and request a background launch", () => {
    const result = launch(["--cdp-port", "9222", "--background", "--agent", "scout", "--custom=value with spaces"]);
    expect(result.success).toBe(true);
    expect(result.open).toContain("-g");
    expect(result.open).toContain("--custom=value with spaces");
    expect(result.open).toContain("--remote-debugging-address=127.0.0.1");
    expect(result.open).toContain("--remote-debugging-port=9222");
    const chromium = join(homedir(), "Library/Application Support/ArcModAgent-scout/Agent Chromium Data");
    expect(result.open).toContain(`--user-data-dir=${chromium}`);
    expect(result.mkdir).toEqual(["-p", chromium]);
    expect(result.defaults).toContain("company.thebrowser.Browser.mod.agent.scout");
    expect(result.open).toContain(`${result.root}/build/ArcModAgent-scout-run.log`);
  });

  test("agent starts without optional flags on macOS Bash 3.2", () => {
    const result = launch(["--agent", "scout"]);
    expect(result.success).toBe(true);
    expect(result.open.some((arg) => arg.startsWith("--remote-debugging"))).toBe(false);
  });

  test("invalid and isolation-overriding arguments fail before preferences or launch", () => {
    for (const args of [["--agent"], ["--agent", "../Arc"], ["--agent", "scout", "--validation"], ["--agent", "scout", "--agent", "scout"], ["--background", "--background"], ["--cdp-port", "9222"], ["--agent", "scout", "--cdp-port", "1023"], ["--agent", "scout", "--cdp-port", "65536"], ["--agent", "scout", "--cdp-port", "0009222"], ["--agent", "scout", "--user-data-dir=/tmp/shared"], ["--agent", "scout", "--", "--remote-debugging-address=0.0.0.0"], ["--guard", "--background"]]) {
      const result = launch(args);
      expect(result.success).toBe(false);
      expect(result.defaults).toEqual([]);
      expect(result.open).toEqual([]);
    }
  });

  test("a running session and a mismatched agent bundle are refused", () => {
    for (const options of [{ running: "12345" }, { plistAgent: "someone-else" }]) {
      const result = launch(["--agent", "scout"], options);
      expect(result.success).toBe(false);
      expect(result.defaults).toEqual([]);
      expect(result.open).toEqual([]);
    }
  });

  test("Chromium single-dash overrides and forwarded terminators are rejected", () => {
    for (const extra of ["-remote-debugging-port=9222", "-remote-debugging-pipe", "-user-data-dir=/tmp/shared", "--"]) {
      const result = launch(["--agent", "scout", "--", extra]);
      expect(result.success).toBe(false);
      expect(result.defaults).toEqual([]);
      expect(result.open).toEqual([]);
    }
  });
});
