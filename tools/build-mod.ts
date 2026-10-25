#!/usr/bin/env bun
// Builds build/ArcMod.app: a local-mode APFS clone of Arc 1.168.0 (/Applications/Arc.app while it's still
// 1.168.0, else the copy in bin/).
//   - own bundle id (company.thebrowser.Browser.mod) and Sparkle auto-update disabled
//   - arm64 executable, required ArcMod.dylib, fingerprinted local UI/URL/single-Little-Arc patches
//   - every nested binary re-signed ad hoc, inside-out, WITHOUT hardened runtime (so no library
//     validation) and without Arc's restricted entitlements (iCloud, keychain groups, push)
// /Applications/Arc.app is never modified.
//
//   bun tools/build-mod.ts [--source /Applications/Arc.app] [--validation | --agent <slug>]
//                          [--engine <ArcCore.framework> | --engine release]   (Arc Engine; see README)

import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { hostResolverRules, servicePolicyHeader } from "./service-policy";
import { shortcutPolicyHeader } from "./shortcut-policy";
import { defaultArcSource } from "./arc-source";
import { fetchEngine } from "./fetch-engine";
import { finalApp, installedApp, runningAt, stagedApp, swapInStagedApp } from "./build-paths";
import { describeArgs } from "./update";
import { verifyShippedShortcutCoverage } from "./shortcut-coverage";
import { parseBuildOptions } from "./agent-session";
import { acquireLease } from "./agent-lease";

// All bundles share generated headers/dylib, so serialize complete builds.
const buildLease = acquireLease("global", join(homedir(), ".arcmod", "build-locks"));
process.on("exit", () => buildLease.release());
const root = join(import.meta.dir, "..");
const options = parseBuildOptions(Bun.argv.slice(2));
const { session } = options;
// --engine release: the Arc Engine release this commit pins, downloaded and checked by tools/fetch-engine.ts.
const ENGINE = options.engine === "release" ? await fetchEngine() : options.engine === undefined ? undefined : resolve(options.engine);
// Without --source: the installed Arc while it's still 1.168.0, else the copy in bin/.
const SOURCE = Bun.argv.includes("--source") ? options.source : defaultArcSource();
const { appName, bundleId: MOD_BUNDLE_ID } = session;
// Built into a staging bundle and swapped in at the end, so a failed build leaves the previous app in place.
// The everyday ArcMod is installed in Applications unless --debug; test and agent builds stay in build/.
const INSTALL = session.agent === undefined && appName === "ArcMod" && !options.debug;
const FINAL = INSTALL ? installedApp() : finalApp(appName);
const OUT = stagedApp(appName);
const DYLIB_INSTALL = "@executable_path/../Frameworks/ArcMod.dylib";

const sh = (cmd: readonly string[], opts: { quiet?: boolean } = {}): string => {
  const r = Bun.spawnSync([...cmd], { stderr: "pipe", stdout: "pipe" });
  if (!r.success) throw new Error(`${cmd.join(" ")}\n${r.stderr.toString()}`);
  if (!opts.quiet && r.stderr.length > 0) process.stderr.write(r.stderr);
  return r.stdout.toString();
};
const step = (msg: string): void => console.log(`• ${msg}`);

const walk = (dir: string): readonly string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isSymbolicLink() ? [] : e.isDirectory() ? [p, ...walk(p)] : [p];
  });

const isMachO = (p: string): boolean => {
  if (!statSync(p).isFile()) return false;
  const head = new Uint8Array(Bun.file(p).size >= 4 ? Bun.spawnSync(["head", "-c", "4", p]).stdout : []);
  const magic = head.length === 4 ? ((head[0] ?? 0) << 24) | ((head[1] ?? 0) << 16) | ((head[2] ?? 0) << 8) | (head[3] ?? 0) : 0;
  return [0xcffaedfe, 0xcefaedfe, 0xcafebabe, 0xfeedfacf].includes(magic >>> 0);
};

const CODE_BUNDLE = /\.(app|xpc|appex|plugin|framework)$/;
const depth = (p: string): number => p.split("/").length;

// ---------------------------------------------------------------------------------------------

// A staged build (--stage-only) can be made while the app runs; replacing the app can't.
const assertOutputStopped = (): void => {
  const running = runningAt(FINAL);
  if (running.length > 0) throw new Error(`refusing to overwrite running ${appName}: ${running.map((line) => line.trim()).join(", ")}`);
};
if (!options.stageOnly) assertOutputStopped();
if (!existsSync(SOURCE)) throw new Error(`source app not found: ${SOURCE}`);
const version = sh(["defaults", "read", join(SOURCE, "Contents/Info.plist"), "CFBundleShortVersionString"]).trim();
const build = sh(["defaults", "read", join(SOURCE, "Contents/Info.plist"), "CFBundleVersion"]).trim();
if (version !== "1.168.0" || build !== "88413") throw new Error(`unsupported Arc ${version} (${build}); local-mode patch targets 1.168.0 (88413)`);
step(`source ${SOURCE} (Arc ${version})`);
step(`verify complete menu coverage (${verifyShippedShortcutCoverage(SOURCE).length} actions)`);
step("verify native Foundation formatting ABI for compact state serialization");
console.log(`  ${sh(["xcrun", "swift", "-O", join(root, "tools/verify-foundation-abi.swift")]).trim()}`);
mkdirSync(join(root, "build"), { recursive: true });
writeFileSync(join(root, "build/ArcModServiceHosts.h"), servicePolicyHeader);
writeFileSync(join(root, "build/ArcModShortcutPolicy.h"), shortcutPolicyHeader);

const dylib = join(root, "build/ArcMod.dylib");
step("compile mods/hello/ArcMod.m → build/ArcMod.dylib");
sh([
  "clang", "-dynamiclib", "-arch", "arm64", "-fobjc-arc", "-Wall", "-Wextra", "-Werror", "-mmacosx-version-min=13.0",
  "-framework", "AppKit", "-framework", "CoreServices", "-I", join(root, "build"), "-install_name", DYLIB_INSTALL, "-o", dylib,
  join(root, "mods/hello/ArcMod.m"), join(root, "mods/local/ServicePolicy.m"),
  join(root, "mods/local/ShortcutPolicy.m"),
]);

step(`APFS-clone app → ${relative(root, OUT)}`);
rmSync(OUT, { recursive: true, force: true });
sh(["cp", "-cR", SOURCE, OUT]);
if (ENGINE !== undefined) {
  // Arc's app links @executable_path/../Frameworks/ArcCore.framework/Versions/A/ArcCore; the replacement
  // must have that layout and install name. It is re-signed with the rest of the bundle below.
  const engineBinary = join(ENGINE, "Versions/A/ArcCore");
  if (!existsSync(engineBinary)) throw new Error(`not an ArcCore.framework (no Versions/A/ArcCore): ${ENGINE}`);
  const installName = sh(["otool", "-D", engineBinary]).trim().split("\n").at(-1)?.trim();
  if (installName !== "@executable_path/../Frameworks/ArcCore.framework/Versions/A/ArcCore") {
    throw new Error(`engine install name is ${installName}, expected Arc's ArcCore path`);
  }
  step(`engine → ${ENGINE}`);
  const frameworks = join(OUT, "Contents/Frameworks/ArcCore.framework");
  rmSync(frameworks, { recursive: true, force: true });
  sh(["cp", "-cR", ENGINE, frameworks]);
}
sh(["xattr", "-cr", OUT], { quiet: true });

step("Info.plist: bundle id, display name, Sparkle off");
const plist = join(OUT, "Contents/Info.plist");
const plutil = (...args: string[]): string => sh(["plutil", ...args, plist]);
plutil("-replace", "CFBundleIdentifier", "-string", MOD_BUNDLE_ID);
plutil("-replace", "CFBundleDisplayName", "-string", session.displayName);
// Arc's Swift layer names its data folder after CFBundleName (~/Library/Application Support/<name>),
// so this keeps the mod out of the real ~/Library/Application Support/Arc.
plutil("-replace", "CFBundleName", "-string", appName);
if (session.agent !== undefined) plutil("-insert", "ArcModAgentSession", "-string", session.agent);
plutil("-insert", "ArcModLocalMode", "-bool", "YES");
plutil("-insert", "ArcModHostResolverRules", "-string", hostResolverRules);
plutil("-replace", "SUEnableAutomaticChecks", "-bool", "NO");
plutil("-replace", "SUAutomaticallyUpdate", "-bool", "NO");
plutil("-replace", "SUFeedURL", "-string", "https://127.0.0.1:9/arcmod-updates-disabled.xml");
// Arc's Dock tile plug-in shows the chosen icon while Arc isn't running, without ArcMod's badge, and Arc
// tells it about changes by a notification name the real Arc's plug-in also receives. ArcMod's dylib
// badges the bundle's own custom icon instead, which the Dock uses once the plug-in is gone.
plutil("-remove", "NSDockTilePlugIn");
// The shown name is the localized CFBundleName (ArcMod menu → Rename App…). Arc names its data folder after
// the unlocalized CFBundleName, so renaming never moves the data. Only the normal ArcMod can be renamed.
plutil("-insert", "LSHasLocalizedDisplayName", "-bool", "YES");
// Read by tools/update.ts and ArcMod's update check: the release this build came from, its engine and its source.
const describe = Bun.spawnSync(["git", "-C", root, "describe", "--tags", "--always", "--dirty", ...describeArgs]).stdout.toString().trim();
plutil("-insert", "ArcModVersion", "-string", describe || "unknown");
plutil("-insert", "ArcModBuildEngine", "-string", options.engine === "release" ? "release" : ENGINE ?? "arc");
plutil("-insert", "ArcModRepository", "-string", root);
const shownName = session.agent === undefined && MOD_BUNDLE_ID === "company.thebrowser.Browser.mod"
  ? Bun.spawnSync(["defaults", "read", MOD_BUNDLE_ID, "ArcModAppName"]).stdout.toString().trim()
  : "";
if (shownName) {
  step(`shown name: ${shownName}`);
  const resources = join(OUT, "Contents/Resources");
  const folders = new Set(["en.lproj", ...readdirSync(resources).filter((name) => name.endsWith(".lproj"))]);
  folders.forEach((folder) => {
    mkdirSync(join(resources, folder), { recursive: true });
    const strings = join(resources, folder, "InfoPlist.strings");
    writeFileSync(strings, JSON.stringify({ CFBundleName: shownName, CFBundleDisplayName: shownName }));
    sh(["plutil", "-convert", "xml1", strings]);
  });
}
rmSync(join(OUT, "Contents/embedded.provisionprofile"), { force: true });

step("main executable: thin to arm64, strip signature, apply local patches, insert required dylib");
const exe = join(OUT, "Contents/MacOS/Arc");
sh(["lipo", exe, "-thin", "arm64", "-output", `${exe}.arm64`]);
sh(["mv", `${exe}.arm64`, exe]);
sh(["codesign", "--remove-signature", exe]);
console.log(`  ${sh(["bun", join(root, "tools/patch-local-mode.ts"), exe]).trim()}`);
console.log(`  ${sh(["bun", join(root, "tools/insert-dylib.ts"), exe, DYLIB_INSTALL, "--strong"]).trim()}`);
sh(["cp", dylib, join(OUT, "Contents/Frameworks/ArcMod.dylib")]);

// Inside-out: loose Mach-O files that aren't a bundle's main executable, then bundles deepest first.
step("re-sign ad hoc, inside-out (no hardened runtime, no entitlements)");
const all = walk(OUT);
const bundles = all.filter((p) => CODE_BUNDLE.test(p) && statSync(p).isDirectory() && p !== OUT);
const bundleMains = new Set(
  bundles.flatMap((b) => {
    const name = b.split("/").at(-1)?.replace(CODE_BUNDLE, "") ?? "";
    return [join(b, "Contents/MacOS", name), join(b, name), join(b, "Versions/A", name), join(b, "Versions/B", name)];
  }),
);
const loose = all.filter((p) => !bundleMains.has(p) && !p.startsWith(exe) && isMachO(p));
const ordered = [...loose.toSorted((a, b) => depth(b) - depth(a)), ...bundles.toSorted((a, b) => depth(b) - depth(a)), OUT];
const sign = (p: string): void => void sh(["codesign", "--force", "--sign", "-", "--timestamp=none", p], { quiet: true });
ordered.forEach((p) => {
  sign(p);
  console.log(`  signed ${relative(OUT, p) || "ArcMod.app"}`);
});

step("verify");
sh(["codesign", "--verify", "--deep", "--strict", OUT], { quiet: true });
const loads = sh(["otool", "-L", exe]).split("\n").filter((l) => l.includes("ArcMod"));
console.log(`  codesign --verify --deep --strict: ok\n  ${loads.join("\n  ").trim()}`);
if (options.stageOnly) {
  console.log(`\nstaged ${relative(root, OUT)} from Arc ${version}`);
} else {
  assertOutputStopped();
  swapInStagedApp(appName, FINAL);
  if (INSTALL) {
    // One everyday ArcMod: drop an older build/ArcMod.app so two copies don't share the bundle ID.
    const lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
    if (existsSync(finalApp(appName)) && runningAt(finalApp(appName)).length === 0) {
      Bun.spawnSync([lsregister, "-u", finalApp(appName)]);
      rmSync(finalApp(appName), { recursive: true, force: true });
      console.log(`  removed the old ${relative(root, finalApp(appName))}; re-pin ArcMod in the Dock if you had it there`);
    }
    Bun.spawnSync([lsregister, "-f", FINAL]);
  }
  console.log(`\nbuilt ${INSTALL ? FINAL : relative(root, FINAL)} from Arc ${version}`);
}
