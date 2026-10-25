// Where builds go. tools/build-mod.ts builds into a staging bundle and swaps it in only when the build has
// succeeded, so a failed build leaves the previous app in place. tools/update.ts builds with --stage-only
// while ArcMod keeps running, then swaps once ArcMod has quit.
import { existsSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

export const finalApp = (appName: string): string => join(root, `build/${appName}.app`);
export const stagedApp = (appName: string): string => join(root, `build/.${appName}.staging.app`);

// Processes running the app's main executable, compared as strings (paths may contain regex characters).
export const runningApp = (appName: string): readonly string[] => {
  const executable = join(finalApp(appName), "Contents/MacOS/Arc");
  const processes = Bun.spawnSync(["ps", "-axo", "pid=,command="]).stdout.toString();
  return processes.split("\n").filter((line) => {
    const command = line.trim().replace(/^\d+\s+/, "");
    return command === executable || command.startsWith(`${executable} `);
  });
};

export const swapInStagedApp = (appName: string): void => {
  const staged = stagedApp(appName);
  const final = finalApp(appName);
  if (!existsSync(staged)) throw new Error(`no staged build at ${staged}`);
  // Only a complete build is swapped in: it must carry a valid signature.
  if (!Bun.spawnSync(["codesign", "--verify", "--deep", "--strict", staged]).success) throw new Error(`the staged build at ${staged} isn't complete`);
  if (runningApp(appName).length > 0) throw new Error(`refusing to replace running ${appName}`);
  const previous = `${final}.previous`;
  rmSync(previous, { recursive: true, force: true });
  if (existsSync(final)) renameSync(final, previous);
  renameSync(staged, final);
  rmSync(previous, { recursive: true, force: true });
};
