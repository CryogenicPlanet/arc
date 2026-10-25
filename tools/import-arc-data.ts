// Import stock Arc's Chromium profile (logins, site storage, extensions, history,
// permissions) into the everyday ArcMod so sites stay signed in.
//   bun tools/import-arc-data.ts [--staging-only] [--quit-arcmod] [--relaunch [--app <ArcMod.app>]]
// --quit-arcmod asks ArcMod to quit after the checks pass and waits for you to quit Arc, instead of failing
// while either runs; --relaunch reopens ArcMod afterwards, even if the import failed. ArcMod's
// "Import from Arc…" menu item runs it with both in Terminal.
// Arc and the everyday ArcMod both encrypt secrets with the Keychain's "Arc Safe Storage" item, so the
// profile is copied as is: nothing is decrypted. Test builds keep their data under Chromium's fixed test key
// (--use-mock-keychain), so real sessions are never imported into them.
// The source profile is only read. The previous mod profile is kept as a backup.
import { existsSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { sessionIdentity } from "./agent-session";

// Transient caches, tab sessions, and Google sync/push identities that belong to stock Arc.
const excluded = new Set([
  "LOCK", "LOG", "LOG.old", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache",
  "Sessions", "Session Storage", "Sync Data", "trusted_vault.pb", "passkey_enclave_state", "GCM Store",
]);

const run = (command: string, args: readonly string[]): string => {
  const result = Bun.spawnSync([command, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`${command} failed: ${result.stderr.toString().trim()}`);
  return result.stdout.toString();
};

const isRunning = (pattern: string): boolean => Bun.spawnSync(["pgrep", "-f", pattern]).exitCode === 0;

const waitUntilClosed = async (pattern: string, message: string): Promise<void> => {
  if (!isRunning(pattern)) return;
  console.log(message);
  while (isRunning(pattern)) await Bun.sleep(500);
};

const main = async (args: readonly string[]): Promise<void> => {
  const flags = new Set(["--validation", "--staging-only", "--quit-arcmod", "--relaunch"]);
  const unknown = args.filter((arg, index) => !flags.has(arg) && !(arg === "--app" || args[index - 1] === "--app"));
  if (unknown.length > 0) throw new Error(`unrecognized argument: ${unknown.join(" ")}`);
  if (args.includes("--validation")) {
    throw new Error("test builds keep their data under Chromium's fixed test key; import only into the everyday ArcMod");
  }
  const session = sessionIdentity(false);
  const support = join(process.env.HOME ?? "", "Library/Application Support");
  const source = join(support, "Arc/User Data/Default");
  const targetRoot = join(support, session.appName, "User Data");
  const target = join(targetRoot, "Default");
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const staging = join(targetRoot, `Default.import-${stamp}`);

  if (!existsSync(source)) throw new Error(`missing Arc profile: ${source}`);
  if (!existsSync(targetRoot)) throw new Error(`launch ${session.appName} once before importing: ${targetRoot}`);
  const arc = "^/Applications/Arc[.]app/Contents/MacOS/Arc( |$)";
  const mod = `(^|/)${session.appName}[.]app/Contents/MacOS/Arc( |$)`;
  if (args.includes("--quit-arcmod")) {
    if (isRunning(mod)) Bun.spawnSync(["osascript", "-e", `tell application id "${session.bundleId}" to quit`]);
    await waitUntilClosed(mod, `Waiting for ${session.appName} to quit (confirm in ${session.appName} if it asks)…`);
    await waitUntilClosed(arc, "Quit Arc to continue: its profile has to be closed while it's copied.");
  }
  if (isRunning(arc)) throw new Error("quit Arc first so its profile is consistent");
  if (isRunning(mod)) throw new Error(`quit ${session.appName} first`);

  run("mkdir", ["-m", "700", staging]);
  const entries = readdirSync(source).filter((entry) => !excluded.has(entry));
  for (const entry of entries) run("cp", ["-cRp", join(source, entry), join(staging, entry)]);

  if (args.includes("--staging-only")) {
    console.log(`staged ${staging}`);
    return;
  }
  const backup = join(targetRoot, `Default.pre-import-${stamp}`);
  if (existsSync(target)) renameSync(target, backup);
  renameSync(staging, target);
  console.log(`imported Arc profile into ${target}${existsSync(backup) ? `\nprevious profile kept at ${backup}` : ""}`);
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  try {
    await main(args);
  } catch (error) {
    console.error(`\nImport stopped: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    // From the ArcMod menu: reopen ArcMod whether or not the import worked.
    const validation = args.includes("--validation");
    const session = sessionIdentity(validation);
    if (args.includes("--relaunch") && !isRunning(`(^|/)${session.appName}[.]app/Contents/MacOS/Arc( |$)`)) {
      const app = args.indexOf("--app") >= 0 ? args[args.indexOf("--app") + 1] : undefined;
      const launch = app ? ["--app", app] : validation ? ["--validation"] : [];
      Bun.spawnSync([join(import.meta.dir, "run-mod.sh"), ...launch], { stdout: "inherit", stderr: "inherit" });
    }
  }
}
