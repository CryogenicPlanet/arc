// Where builds go. tools/build-mod.ts builds into a staging bundle and swaps it in only when the build has
// succeeded, so a failed build leaves the previous app in place. tools/update.ts builds with --stage-only
// while ArcMod keeps running, then swaps once ArcMod has quit.
// The everyday ArcMod is installed in /Applications (or ~/Applications when /Applications isn't writable) and
// opens like any app; `--debug` builds, test (validation) and agent builds stay in build/.
import { accessSync, constants, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const root = join(import.meta.dir, "..");

export const finalApp = (appName: string): string => join(root, `build/${appName}.app`);
export const stagedApp = (appName: string): string => join(root, `build/.${appName}.staging.app`);

const writable = (directory: string): boolean => {
  try {
    accessSync(directory, constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

export const installDirectory = (): string => writable("/Applications") ? "/Applications" : join(homedir(), "Applications");
export const installedApp = (): string => join(installDirectory(), "ArcMod.app");

// The everyday ArcMod this checkout manages. ArcMod's menu passes its own path (--app); otherwise the installed
// one if it exists, else a --debug build in build/.
export const everydayApp = (app?: string): { readonly path: string; readonly debug: boolean } => {
  if (app !== undefined) return { path: app, debug: app === finalApp("ArcMod") };
  return existsSync(installedApp()) || !existsSync(finalApp("ArcMod")) ? { path: installedApp(), debug: false } : { path: finalApp("ArcMod"), debug: true };
};

// The value after `flag` in a list of command-line arguments.
export const flagValue = (args: readonly string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

// Processes running an app bundle's main executable, compared as strings (paths may contain regex characters).
export const runningAt = (app: string): readonly string[] => {
  const executable = join(app, "Contents/MacOS/Arc");
  const processes = Bun.spawnSync(["ps", "-axo", "pid=,command="]).stdout.toString();
  return processes.split("\n").filter((line) => {
    const command = line.trim().replace(/^\d+\s+/, "");
    return command === executable || command.startsWith(`${executable} `);
  });
};

export const runningApp = (appName: string): readonly string[] => runningAt(finalApp(appName));

// Replaces `final` (build/<App>.app unless given, e.g. the installed ArcMod) with the verified staged build.
export const swapInStagedApp = (appName: string, final: string = finalApp(appName)): void => {
  const staged = stagedApp(appName);
  if (!existsSync(staged)) throw new Error(`no staged build at ${staged}`);
  // Only a complete build is swapped in: it must carry a valid signature.
  if (!Bun.spawnSync(["codesign", "--verify", "--deep", "--strict", staged]).success) throw new Error(`the staged build at ${staged} isn't complete`);
  if (runningAt(final).length > 0) throw new Error(`refusing to replace running ${appName}`);
  mkdirSync(dirname(final), { recursive: true });
  rmSync(final, { recursive: true, force: true });
  // rename can't cross volumes; copy then.
  if (statSync(dirname(staged)).dev === statSync(dirname(final)).dev) renameSync(staged, final);
  else if (Bun.spawnSync(["ditto", staged, final]).success) rmSync(staged, { recursive: true, force: true });
  else throw new Error(`couldn't copy the build to ${final}`);
};
