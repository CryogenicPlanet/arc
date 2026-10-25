#!/usr/bin/env bun
// Updates this checkout to the newest ArcMod release for its branch and rebuilds ArcMod with the same engine.
//   bun tools/update.ts                         update and rebuild; if ArcMod is open, waits for you to quit it
//   bun tools/update.ts --check                 only report
//   bun tools/update.ts --quit-arcmod --relaunch
//       what ArcMod's "Update…" menu item runs: everything that can fail (checks, source update, build) happens
//       while ArcMod keeps running; then it asks ArcMod to quit, swaps in the new build and reopens ArcMod.
// Releases are tags: vX.Y.Z on master and vX.Y.Z-no-login on no-login.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { finalApp, runningApp, stagedApp, swapInStagedApp } from "./build-paths";

const root = join(import.meta.dir, "..");
const RELEASES = "https://api.github.com/repos/CryogenicPlanet/arc/releases?per_page=50";
const APP = "ArcMod";
const BUNDLE_ID = "company.thebrowser.Browser.mod";

export type Channel = "master" | "no-login";
type Version = readonly [number, number, number];
type Release = { readonly tag: string; readonly url: string; readonly version: Version };

const git = (...args: string[]): { readonly ok: boolean; readonly out: string } => {
  const result = Bun.spawnSync(["git", "-C", root, ...args], { stderr: "pipe" });
  return { ok: result.success, out: result.stdout.toString().trim() };
};

export const tagPattern = (channel: Channel): RegExp => channel === "master" ? /^v(\d+)\.(\d+)\.(\d+)$/ : /^v(\d+)\.(\d+)\.(\d+)-no-login$/;

export const parseVersion = (tag: string, channel: Channel): Version | undefined => {
  const match = tagPattern(channel).exec(tag);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
};

export const compareVersions = (a: Version, b: Version): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

// The branch decides the channel; a detached checkout falls back to its nearest release tag.
export const currentChannel = (): Channel => {
  const branch = git("rev-parse", "--abbrev-ref", "HEAD").out;
  if (branch === "master" || branch === "no-login") return branch;
  return git("describe", "--tags", "--abbrev=0", "--match", "v*-no-login").ok ? "no-login" : "master";
};

// `git describe` limited to one channel's tags, as tools/build-mod.ts stamps it into ArcModVersion.
export const describeArgs = (channel: Channel): readonly string[] =>
  channel === "master" ? ["--match", "v[0-9]*", "--exclude", "*-no-login"] : ["--match", "v*-no-login"];

const isRelease = (value: unknown): value is { tag_name: string; html_url: string; draft: boolean; prerelease: boolean } =>
  typeof value === "object" && value !== null && typeof (value as { tag_name?: unknown }).tag_name === "string" &&
  typeof (value as { html_url?: unknown }).html_url === "string";

export const latestRelease = async (channel: Channel): Promise<Release | undefined> => {
  const response = await fetch(RELEASES, { headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) throw new Error(`GitHub releases: HTTP ${response.status}`);
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error("GitHub releases: unexpected response");
  return body
    .filter(isRelease)
    .filter((release) => !release.draft && !release.prerelease)
    .flatMap((release) => {
      const version = parseVersion(release.tag_name, channel);
      return version ? [{ tag: release.tag_name, url: release.html_url, version }] : [];
    })
    .toSorted((a, b) => compareVersions(b.version, a.version))[0];
};

// The release the built app came from, from the ArcModVersion that tools/build-mod.ts stamps (`git describe`).
const builtVersion = (channel: Channel): Version | undefined => {
  const plist = join(finalApp(APP), "Contents/Info.plist");
  if (!existsSync(plist)) return undefined;
  const stamp = Bun.spawnSync(["defaults", "read", plist, "ArcModVersion"]).stdout.toString().trim();
  return parseVersion(stamp.replace(/-\d+-g[0-9a-f]+/, "").replace(/-dirty$/, ""), channel);
};

const builtEngine = (): string => {
  const plist = join(finalApp(APP), "Contents/Info.plist");
  const engine = existsSync(plist) ? Bun.spawnSync(["defaults", "read", plist, "ArcModBuildEngine"]).stdout.toString().trim() : "";
  return engine === "" || engine === "arc" ? "arc" : engine;
};

const run = (command: readonly string[], what: string): void => {
  console.log(`• ${what}`);
  const result = Bun.spawnSync([...command], { cwd: root, stdout: "inherit", stderr: "inherit" });
  if (!result.success) throw new Error(`${what} failed`);
};

const arcModRunning = (): boolean => runningApp(APP).length > 0;

const relaunch = (): void => void Bun.spawnSync([join(root, "tools/run-mod.sh")], { cwd: root, stdout: "inherit", stderr: "inherit" });

const update = async (args: ReadonlySet<string>): Promise<void> => {
  const channel = currentChannel();
  const latest = await latestRelease(channel);
  if (!latest) {
    console.log(`No ${channel} releases yet.`);
    return;
  }
  if (!git("fetch", "--quiet", "--tags", "origin").ok) throw new Error("couldn't fetch release tags from origin");
  if (!git("rev-parse", "--verify", "--quiet", `${latest.tag}^{commit}`).ok) throw new Error(`origin has no tag ${latest.tag}`);
  const needsSource = !git("merge-base", "--is-ancestor", latest.tag, "HEAD").ok;
  const built = builtVersion(channel);
  const needsBuild = needsSource || !built || compareVersions(built, latest.version) < 0;
  if (!needsBuild) {
    console.log(`ArcMod is up to date (${latest.tag}).`);
    return;
  }
  console.log(needsSource
    ? `ArcMod ${latest.tag} is available. Release notes: ${latest.url}`
    : `The source is at ${latest.tag}, but the built ArcMod is older; rebuilding.`);
  if (args.has("--check")) return;

  if (needsSource) {
    const branch = git("rev-parse", "--abbrev-ref", "HEAD").out;
    if (branch !== channel) throw new Error(`check out the ${channel} branch first (this checkout is on ${branch})`);
    if (git("status", "--porcelain", "--untracked-files=no").out) throw new Error("this checkout has local changes; commit or stash them first");
    if (!git("merge-base", "--is-ancestor", "HEAD", latest.tag).ok) {
      throw new Error(`${branch} has commits that aren't in ${latest.tag}; update it yourself (git merge ${latest.tag})`);
    }
    run(["git", "merge", "--ff-only", latest.tag], `update the source to ${latest.tag}`);
    if (existsSync(join(root, "engine/.git"))) run(["git", "submodule", "update", "engine"], "update the engine submodule");
    if (Bun.spawnSync(["git", "lfs", "version"]).success) run(["git", "lfs", "pull", "--include=bin/*"], "update Arc 1.168.0 in bin/");
    run(["bun", "install", "--frozen-lockfile"], "install dependencies");
  }

  const engine = builtEngine();
  run(["bun", "tools/build-mod.ts", "--stage-only", ...(engine === "arc" ? [] : ["--engine", engine])],
    `build ArcMod (${engine === "arc" ? "Arc's engine" : `engine: ${engine}`})`);
  if (arcModRunning()) {
    if (args.has("--quit-arcmod")) {
      console.log("• asking ArcMod to quit (confirm in ArcMod if it asks)");
      Bun.spawnSync(["osascript", "-e", `tell application id "${BUNDLE_ID}" to quit`]);
    } else {
      console.log(`• the new build is ready (${stagedApp(APP)}); quit ArcMod to finish`);
    }
    while (arcModRunning()) await Bun.sleep(500);
  }
  swapInStagedApp(APP);
  console.log(`\nArcMod is now ${latest.tag}.`);
};

if (import.meta.main) {
  const args = new Set(process.argv.slice(2));
  try {
    await update(args);
  } catch (error) {
    console.error(`\nUpdate stopped: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    // From the ArcMod menu: reopen ArcMod whether or not the update worked, unless it's still open.
    if (args.has("--relaunch") && !arcModRunning() && existsSync(finalApp(APP))) relaunch();
  }
}
