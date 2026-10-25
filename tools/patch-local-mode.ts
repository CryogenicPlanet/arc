#!/usr/bin/env bun
// Arc 1.168.0 (88413), arm64: suppress the account onboarding window without
// manufacturing an AuthSession or changing any authentication result.
// Also enables local window/URL routing and restores single Little Arc reuse.
// Performance: compact Storable JSON and initialize LaunchDarkly offline.
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { shortcutBridge, shortcutBridgeOffset } from "./shortcut-bridge";
import { localCloseBridge, localCloseBridgeOffset } from "./local-close-bridge";
import { finalApp, stagedApp } from "./build-paths";
import { littleArcBridge, littleArcBridgeAddress, littleArcOriginal, littleArcSiteReplacement } from "./little-arc-bridge";

type Patch = { readonly address: bigint; readonly original: Buffer; readonly replacement: Buffer };
const onboarding = Buffer.from("f44fbea9fd7b01a9fd430091f40300aaf30308aadbf7fc9700010036000080d23125fd97081480b9886a68381f010071e8079f1a020000142800805268020039fd7b41a9f44fc2a8c0035fd6", "hex");
const localOnboarding = Buffer.from(onboarding);
localOnboarding.set(Buffer.from("7f020039", "hex"), 60);

const branch = (from: bigint, to: bigint, link = false): number => {
  const delta = to - from;
  if (delta % 4n !== 0n || delta < -(1n << 27n) || delta >= (1n << 27n)) throw new Error("invalid arm64 branch");
  return ((link ? 0x94000000 : 0x14000000) | Number((delta / 4n) & 0x3ffffffn)) >>> 0;
};
// Destroy the temporary Optional<AuthSession>, then continue local window creation.
// This preserves ARC ownership and leaves all user/session/auth predicates untouched.
const windowAddress = 0x102a75744n;
const windowInstructions = [
  0xb000db81, 0x91080021, // x1 = &DAT_1045e6200 (Optional<AuthSession> cache)
  0xb0006ba2, 0x9101a042, // x2 = &DAT_1037ea068 (Optional<AuthSession> descriptor)
  0xaa1603e0,             // x0 = x22 (temporary optional)
  branch(windowAddress + 20n, 0x10000733cn, true),
  branch(windowAddress + 24n, 0x102a75868n),
  0xd503201f, 0xd503201f, 0xd503201f, 0xd503201f,
];
const localWindow = Buffer.alloc(windowInstructions.length * 4);
windowInstructions.forEach((instruction, i) => localWindow.writeUInt32LE(instruction, i * 4));
// Keep the WindowStyle.little check; then a bridge (tools/little-arc-bridge.ts) either accepts any Little Arc
// (ArcMod's default, one Little Arc) or runs Arc's own same-hostname/entry-point check when
// ARCMOD_LITTLE_ARC_PER_LINK is set. Arc's existing session and navigation path does the reuse.
const littleArc = Buffer.from("e1031aaa10c72c941f0400718103005442bfff90" + littleArcOriginal.subarray(4).toString("hex"), "hex");
const settableLittleArc = Buffer.from(littleArc);
settableLittleArc.set(littleArcSiteReplacement, 16);
// A user-opened URL must be routed even without an account. Keep the original
// Optional<AuthSession> cleanup, then enter native local URL routing.
const externalURL = Buffer.from("011802f021002d9142a301f042803991e00314aad05ef99760000014", "hex");
const localExternalURL = Buffer.from(externalURL);
localExternalURL.set(Buffer.from("1a000014", "hex"), 24);
// JSONEncoder.OutputFormatting is resilient and returned indirectly through x8.
// On the verified Foundation ABI its rawValue occupies eight bytes. Zero that
// result buffer, not x0 (which is overwritten before outputFormatting.setter).
const storableFormatting = Buffer.from("b78350f8e80317aa44dc9f94e00317aa4bdc9f94", "hex");
const compactFormatting = Buffer.from(storableFormatting);
compactFormatting.set(Buffer.from("1f0100f9", "hex"), 8); // str xzr, [x8]
// LDConfig.startOnline defaults true. Use the SDK's native offline startup so
// locally blocked streaming/event requests do not create a retry loop.
const launchDarklyConfig = Buffer.from("884280b9bf6a2838884a80b929008052a96a2838884e80b9bf6a28389a5280b9", "hex");
const offlineLaunchDarklyConfig = Buffer.from(launchDarklyConfig);
offlineLaunchDarklyConfig.set(Buffer.from("bf6a2838", "hex"), 16); // strb wzr, [x21, x8]
// MainWindowController's New Tab action has its own nil-session guard. The
// preceding code has already destroyed its WindowState snapshot. Continue into
// Arc's native .mainMenu(.newTab) action with the original controller and sender.
const newTab = Buffer.from("a1faff9021e02b91e00319aa05aef39793000014a20c02d042002d91", "hex");
const localNewTab = Buffer.from(newTab);
localNewTab.set(Buffer.from("13000014", "hex"), 16);
// Settings queries CloudKit even when sync is off. Complete only that status
// effect with CKAccountStatus.couldNotDetermine (0), avoiding the unavailable
// service dependency. The native continuation sends the existing status action.
const settingsCloudStatus = Buffer.from("bd0344b2ffc300d1f30b00f9fd7b02a9f60f00f9fd830091c87640f90051c03d", "hex");
const localSettingsCloudStatus = Buffer.from(settingsCloudStatus);
localSettingsCloudStatus.set(Buffer.from("df8200f93f000014", "hex"), 0);
// Hook only the validator's nil-session entry. Its later shared cleanup is also
// used by legitimate state failures, so it must keep returning false.
const menuValidation = Buffer.from("e10c02f021002d91229801f042803991e0031baa96cdf39763000014", "hex");
const localMenuValidation = Buffer.from(menuValidation);
localMenuValidation.writeUInt32LE(branch(0x100313cd0n, 0x100000000n + BigInt(shortcutBridgeOffset)), 0);
// Native shared tab closing checks currentUserID after resolving a valid local
// window/sidebar container. Only that call site receives a stable local small
// String when nil; no session, user object or global identity is created.
const closeUserPresence = Buffer.from("e82640f9f40316aae00318aae10317aa00013fd6410700b4f40301aa61c20791795648a9e80315aa", "hex");
const localCloseUserPresence = Buffer.from(closeUserPresence);
localCloseUserPresence.writeUInt32LE(branch(0x102a3ade8n, 0x100000000n + BigInt(localCloseBridgeOffset)), 20);
// Saved local windows are valid without an account. The copied WindowsState has
// already been destroyed at this guard; retain all subsequent persisted-window
// lookup and restoration checks and continue the existing native restore path.
const savedWindowRestore = Buffer.from("f40300aab50640f9e00319aae1031baaa0023fd6b40f0036752600f97c3200f9", "hex");
const localSavedWindowRestore = Buffer.from(savedWindowRestore);
localSavedWindowRestore.set(Buffer.from("1f2003d5", "hex"), 20);
// App icons: with no account (User.createdAt is nil) the availability check returns
// notAvailable for every icon but Original, and the Icon pane drops those. On that
// path only, return availableByDefault (0) instead of `icon != original`. The
// temporary Optional<Date> is already destroyed; signed-in rules are unchanged.
const appIconAvailability = Buffer.from("1f040071c1010054e0031caa850000943f1f0072e0079f1a21008052", "hex");
const localAppIconAvailability = Buffer.from(appIconAvailability);
localAppIconAvailability.set(Buffer.from("00008052", "hex"), 20); // mov w0, #0 (was cset w0, ne)
const patches: readonly Patch[] = [
  { address: 0x10186b3b0n, original: onboarding, replacement: localOnboarding },
  { address: windowAddress, original: Buffer.from("000080d2678f8697f40300aa08805ff8081940f9e00316aa21008052e20314aa00013fd61f04007101070054", "hex"), replacement: localWindow },
  { address: 0x102a7cb50n, original: littleArc, replacement: settableLittleArc },
  { address: littleArcBridgeAddress, original: Buffer.alloc(littleArcBridge.length), replacement: littleArcBridge },
  { address: 0x1001af7e8n, original: externalURL, replacement: localExternalURL },
  { address: 0x100dab520n, original: storableFormatting, replacement: compactFormatting },
  { address: 0x10143425cn, original: launchDarklyConfig, replacement: offlineLaunchDarklyConfig },
  { address: 0x10031caf4n, original: newTab, replacement: localNewTab },
  { address: 0x101f5f79cn, original: settingsCloudStatus, replacement: localSettingsCloudStatus },
  { address: 0x100313cd0n, original: menuValidation, replacement: localMenuValidation },
  { address: 0x100000000n + BigInt(shortcutBridgeOffset), original: Buffer.alloc(shortcutBridge.length), replacement: shortcutBridge },
  { address: 0x102a3add4n, original: closeUserPresence, replacement: localCloseUserPresence },
  { address: 0x100000000n + BigInt(localCloseBridgeOffset), original: Buffer.alloc(localCloseBridge.length), replacement: localCloseBridge },
  { address: 0x102ab2f34n, original: savedWindowRestore, replacement: localSavedWindowRestore },
  { address: 0x101eee7dcn, original: appIconAvailability, replacement: localAppIconAvailability },
];

export const patchLocalMode = (source: Buffer): Buffer => {
  const image = Buffer.from(source);
  if (image.length < 32 || image.readUInt32LE(0) !== 0xfeedfacf || image.readUInt32LE(4) !== 0x100000c) {
    throw new Error("local-mode patch requires a thin arm64 Mach-O");
  }
  const commandEnd = 32 + image.readUInt32LE(20);
  if (commandEnd > image.length) throw new Error("truncated Mach-O load commands");
  if (commandEnd > shortcutBridgeOffset) throw new Error("Mach-O load commands overlap the local shortcut bridge");
  const segments: { readonly address: bigint; readonly length: bigint; readonly offset: bigint }[] = [];
  let commandOffset = 32;
  for (let i = 0; i < image.readUInt32LE(16); i++) {
    if (commandOffset + 8 > commandEnd) throw new Error("truncated Mach-O load command");
    const command = image.readUInt32LE(commandOffset);
    const size = image.readUInt32LE(commandOffset + 4);
    if (size < 8 || commandOffset + size > commandEnd) throw new Error("invalid Mach-O load command size");
    if (command === 0x19) {
      if (size < 72) throw new Error("truncated segment command");
      const name = image.subarray(commandOffset + 8, commandOffset + 24).toString().replace(/\0.*$/, "");
      const address = image.readBigUInt64LE(commandOffset + 24);
      const length = image.readBigUInt64LE(commandOffset + 48);
      if (name === "__TEXT") segments.push({ address, length, offset: image.readBigUInt64LE(commandOffset + 40) });
    }
    commandOffset += size;
  }
  patches.forEach((patch) => {
    const segment = segments.find((s) => patch.address >= s.address && patch.address + BigInt(patch.original.length) <= s.address + s.length);
    if (!segment) throw new Error("local-mode function is not mapped to file-backed __TEXT");
    const fileOffset = Number(segment.offset + patch.address - segment.address);
    if (fileOffset + patch.original.length > image.length) throw new Error("local-mode function extends beyond file");
    const current = image.subarray(fileOffset, fileOffset + patch.original.length);
    if (current.equals(patch.replacement)) return;
    if (!current.equals(patch.original)) throw new Error(`Arc local-mode fingerprint mismatch at 0x${patch.address.toString(16)}; refusing to patch this version`);
    image.set(patch.replacement, fileOffset);
  });
  return image;
};

if (import.meta.main) {
  const file = Bun.argv[2];
  // ArcMod builds and their staging copies (tools/build-paths.ts), never another app.
  const names = ["ArcMod", "ArcModValidation"];
  const candidate = file?.match(/\/\.?ArcModAgent-([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?:\.staging)?\.app\/Contents\/MacOS\/Arc$/)?.[1];
  if (candidate && candidate.length <= 32) names.push(`ArcModAgent-${candidate}`);
  const allowed = names.flatMap((name) => [finalApp(name), stagedApp(name)].map((app) => join(app, "Contents/MacOS/Arc")));
  if (!file || !allowed.some((path) => realpathSync(file) === join(path))) throw new Error("patch only an ArcMod build executable");
  writeFileSync(file, patchLocalMode(readFileSync(file)));
  console.log("local mode: onboarding disabled, local windows and single Little Arc enabled; performance: compact state JSON, LaunchDarkly offline; account state unchanged");
}
