#!/usr/bin/env bun
// Appends one LC_LOAD_WEAK_DYLIB (or LC_LOAD_DYLIB with --strong) to a thin 64-bit Mach-O,
// using only the existing padding between the load commands and the first section.
// No other bytes move. Run on an unsigned binary (`codesign --remove-signature`), then re-sign.
//
//   bun tools/insert-dylib.ts <thin-macho> <dylib-path> [--strong]

import { readFileSync, writeFileSync } from "node:fs";
import { shortcutBridge, shortcutBridgeOffset } from "./shortcut-bridge";

const MH_MAGIC_64 = 0xfeedfacf;
const LC_SEGMENT_64 = 0x19;
const LC_LOAD_DYLIB = 0x0c;
const LC_LOAD_WEAK_DYLIB = 0x80000018;
const LC_CODE_SIGNATURE = 0x1d;
const HEADER_SIZE = 32;

type LoadCommand = { readonly offset: number; readonly cmd: number; readonly size: number };

const fail = (msg: string): never => {
  console.error(`insert-dylib: ${msg}`);
  process.exit(1);
};

const [file, dylib] = Bun.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!file || !dylib) fail("usage: insert-dylib.ts <thin-macho> <dylib-path> [--strong]");
const strong = Bun.argv.includes("--strong");

const buf = readFileSync(file!);
const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
if (view.getUint32(0, true) !== MH_MAGIC_64) fail("not a thin little-endian 64-bit Mach-O (lipo -thin first)");

const ncmds = view.getUint32(16, true);
const sizeofcmds = view.getUint32(20, true);

const commands: readonly LoadCommand[] = Array.from({ length: ncmds }).reduce<LoadCommand[]>((acc) => {
  const offset = acc.length === 0 ? HEADER_SIZE : (acc.at(-1)?.offset ?? 0) + (acc.at(-1)?.size ?? 0);
  return [...acc, { offset, cmd: view.getUint32(offset, true), size: view.getUint32(offset + 4, true) }];
}, []);

if (commands.some((c) => c.cmd === LC_CODE_SIGNATURE)) fail("binary is still signed; run `codesign --remove-signature` first");

const decoder = new TextDecoder();
const dylibName = (c: LoadCommand): string => {
  const nameOff = view.getUint32(c.offset + 8, true);
  const raw = buf.subarray(c.offset + nameOff, c.offset + c.size);
  return decoder.decode(raw.subarray(0, Math.max(raw.indexOf(0), 0)));
};
if (commands.some((c) => (c.cmd === LC_LOAD_DYLIB || c.cmd === LC_LOAD_WEAK_DYLIB) && dylibName(c) === dylib)) {
  console.log(`insert-dylib: ${dylib} already present, nothing to do`);
  process.exit(0);
}

// First byte of section data in the file: the load commands must end before it.
const firstSectionOffset = commands
  .filter((c) => c.cmd === LC_SEGMENT_64)
  .flatMap((c) => {
    const nsects = view.getUint32(c.offset + 64, true);
    return Array.from({ length: nsects }, (_, i) => view.getUint32(c.offset + 72 + i * 80 + 48, true));
  })
  .filter((off) => off > 0)
  .reduce((min, off) => Math.min(min, off), Number.POSITIVE_INFINITY);

const path = new TextEncoder().encode(dylib!);
const cmdsize = Math.ceil((24 + path.length + 1) / 8) * 8;
const insertAt = HEADER_SIZE + sizeofcmds;
// codesign later appends a 16-byte LC_CODE_SIGNATURE without checking for room; if it doesn't
// fit, it silently overwrites the start of __text. Always keep space for it.
const SIGNATURE_RESERVE = 16;
const bridgePresent = buf.subarray(shortcutBridgeOffset, shortcutBridgeOffset + shortcutBridge.length).equals(shortcutBridge);
const paddingEnd = bridgePresent ? Math.min(firstSectionOffset, shortcutBridgeOffset) : firstSectionOffset;
if (insertAt + cmdsize + SIGNATURE_RESERVE > paddingEnd) {
  fail(`not enough header padding: need ${cmdsize}+${SIGNATURE_RESERVE} bytes, have ${paddingEnd - insertAt}; shortcut bridge is reserved when present`);
}
if (buf.subarray(insertAt, insertAt + cmdsize).some((b) => b !== 0)) fail("header padding is not zeroed; refusing to overwrite");

view.setUint32(insertAt, strong ? LC_LOAD_DYLIB : LC_LOAD_WEAK_DYLIB, true);
view.setUint32(insertAt + 4, cmdsize, true);
view.setUint32(insertAt + 8, 24, true); // dylib.name offset
view.setUint32(insertAt + 12, 2, true); // timestamp
view.setUint32(insertAt + 16, 0x10000, true); // current_version 1.0.0
view.setUint32(insertAt + 20, 0x10000, true); // compatibility_version 1.0.0
buf.set(path, insertAt + 24);
view.setUint32(16, ncmds + 1, true);
view.setUint32(20, sizeofcmds + cmdsize, true);

writeFileSync(file!, buf);
console.log(
  `insert-dylib: added ${strong ? "LC_LOAD_DYLIB" : "LC_LOAD_WEAK_DYLIB"} ${dylib} (${cmdsize} bytes, ${firstSectionOffset - insertAt - cmdsize} bytes padding left)`,
);
