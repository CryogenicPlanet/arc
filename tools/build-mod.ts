#!/usr/bin/env bun
// Builds build/ArcMod.app: a local-mode APFS clone of /Applications/Arc.app.
//   - own bundle id (company.thebrowser.Browser.mod) and Sparkle auto-update disabled
//   - arm64 executable, required ArcMod.dylib, fingerprinted local UI/URL/single-Little-Arc patches
//   - every nested binary re-signed ad hoc, inside-out, WITHOUT hardened runtime (so no library
//     validation) and without Arc's restricted entitlements (iCloud, keychain groups, push)
// /Applications/Arc.app is never modified.
//
//   bun tools/build-mod.ts [--source /Applications/Arc.app] [--validation]

import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { hostResolverRules, servicePolicyHeader } from "./service-policy";
import { shortcutPolicyHeader } from "./shortcut-policy";
import { verifyShippedShortcutCoverage } from "./shortcut-coverage";

const root = join(import.meta.dir, "..");
const argSource = Bun.argv.indexOf("--source");
const SOURCE = argSource >= 0 ? (Bun.argv[argSource + 1] ?? "") : "/Applications/Arc.app";
const validation = Bun.argv.includes("--validation");
const appName = validation ? "ArcModValidation" : "ArcMod";
const OUT = join(root, `build/${appName}.app`);
const MOD_BUNDLE_ID = validation ? "company.thebrowser.Browser.mod.validation" : "company.thebrowser.Browser.mod";
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
  "-framework", "AppKit", "-I", join(root, "build"), "-install_name", DYLIB_INSTALL, "-o", dylib,
  join(root, "mods/hello/ArcMod.m"), join(root, "mods/local/ServicePolicy.m"),
  join(root, "mods/local/ShortcutPolicy.m"),
]);

step(`APFS-clone app → build/${appName}.app`);
rmSync(OUT, { recursive: true, force: true });
sh(["cp", "-cR", SOURCE, OUT]);
sh(["xattr", "-cr", OUT], { quiet: true });

step("Info.plist: bundle id, display name, Sparkle off");
const plist = join(OUT, "Contents/Info.plist");
const plutil = (...args: string[]): string => sh(["plutil", ...args, plist]);
plutil("-replace", "CFBundleIdentifier", "-string", MOD_BUNDLE_ID);
plutil("-replace", "CFBundleDisplayName", "-string", validation ? "Arc Mod Test" : "Arc Mod");
// Arc's Swift layer names its data folder after CFBundleName (~/Library/Application Support/<name>),
// so this keeps the mod out of the real ~/Library/Application Support/Arc.
plutil("-replace", "CFBundleName", "-string", appName);
plutil("-insert", "ArcModLocalMode", "-bool", "YES");
plutil("-insert", "ArcModHostResolverRules", "-string", hostResolverRules);
plutil("-replace", "SUEnableAutomaticChecks", "-bool", "NO");
plutil("-replace", "SUAutomaticallyUpdate", "-bool", "NO");
plutil("-replace", "SUFeedURL", "-string", "https://127.0.0.1:9/arcmod-updates-disabled.xml");
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
console.log(`\nbuilt ${relative(root, OUT)} from Arc ${version}`);
