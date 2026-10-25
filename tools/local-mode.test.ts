import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { patchLocalMode } from "./patch-local-mode";
import { hostResolverRules } from "./service-policy";
import { shortcutBridge, shortcutBridgeOffset, shortcutBridgeSymbol } from "./shortcut-bridge";
import { localCloseBridge, localCloseBridgeOffset } from "./local-close-bridge";
import { littleArcBridge, littleArcBridgeAddress, littleArcVariable } from "./little-arc-bridge";

const littleArcBridgeOffset = Number(littleArcBridgeAddress - 0x100000000n);

const binary = join(import.meta.dir, "../bin/Arc.arm64");
describe.skipIf(!existsSync(binary))("Arc 1.168.0 local-mode binary patch", () => {
  const original = readFileSync(binary);
  const originalDigest = Bun.hash(original);
  const patched = patchLocalMode(original);

  test("changes only local gates, Little Arc selection and verified performance sites, keeping the source intact", () => {
    expect(patched.length).toBe(original.length);
    expect(Bun.hash(original)).toBe(originalDigest);
    const changed: number[] = [];
    original.forEach((byte, i) => { if (byte !== patched[i]) changed.push(i); });
    expect(changed.length).toBe(301);
    expect(changed.every((i) => i === 0x186b3ec || i === 0x1af800 || i === 0x31cb04 || (i >= 0x313cd0 && i < 0x313cd4) || (i >= shortcutBridgeOffset && i < shortcutBridgeOffset + shortcutBridge.length) || (i >= localCloseBridgeOffset && i < localCloseBridgeOffset + localCloseBridge.length) || (i >= 0x2a3ade8 && i < 0x2a3adec) || (i >= 0x2ab2f48 && i < 0x2ab2f4c) || (i >= 0x2a75744 && i < 0x2a75770) || (i >= 0x2a7cb60 && i < 0x2a7cb64) || (i >= littleArcBridgeOffset && i < littleArcBridgeOffset + littleArcBridge.length) || (i >= 0xdab528 && i < 0xdab52c) || i === 0x143426c || (i >= 0x1f5f79c && i < 0x1f5f7a4) || (i >= 0x1eee7f0 && i < 0x1eee7f4))).toBe(true);
    // The new call must destroy the optional session, and the branch must reach local bootstrap.
    const target = (offset: number): number => {
      const immediate = patched.readUInt32LE(offset) & 0x3ffffff;
      const signed = immediate & 0x2000000 ? immediate - 0x4000000 : immediate;
      return offset + signed * 4;
    };
    expect(target(0x2a75758)).toBe(0x733c);
    expect(target(0x2a7575c)).toBe(0x2a75868);
    // Little Arc: the site branches to the bridge; one Little Arc by default, Arc's own check when the variable is set.
    expect(target(0x2a7cb60)).toBe(littleArcBridgeOffset);
    expect(target(littleArcBridgeOffset + 4)).toBe(0x35ad864); // getenv stub
    expect(target(littleArcBridgeOffset + 0x18)).toBe(0x8314);
    expect(target(littleArcBridgeOffset + 0x20)).toBe(0x2a7cbe0);
    expect(target(littleArcBridgeOffset + 0x34)).toBe(0x82d0);
    expect(target(littleArcBridgeOffset + 0x3c)).toBe(0x2a7cb78);
    expect(patched.subarray(0x2a7cb64, 0x2a7cb78)).toEqual(original.subarray(0x2a7cb64, 0x2a7cb78));
    expect(patched.subarray(littleArcBridgeOffset + 64, littleArcBridgeOffset + 64 + littleArcVariable.length).toString()).toBe(littleArcVariable);
    expect(original.subarray(littleArcBridgeOffset, littleArcBridgeOffset + littleArcBridge.length).every((byte) => byte === 0)).toBe(true);
    // In __TEXT's file-backed padding: after the last section (__eh_frame ends 0x41526d8), before the segment's end.
    expect(littleArcBridgeOffset).toBeGreaterThanOrEqual(0x41526d8);
    expect(littleArcBridgeOffset + littleArcBridge.length).toBeLessThanOrEqual(0x4154000);
    // adr/adrp+add targets: the variable name and the two metadata addresses.
    const adrpAdd = (offset: number): number => {
      const adrp = patched.readUInt32LE(offset), add = patched.readUInt32LE(offset + 4);
      const immediate = ((adrp >>> 29) & 3) | (((adrp >>> 5) & 0x7ffff) << 2);
      const pages = immediate & 0x100000 ? immediate - 0x200000 : immediate;
      return (offset & ~0xfff) + pages * 4096 + ((add >>> 10) & 0xfff);
    };
    const adr = patched.readUInt32LE(littleArcBridgeOffset);
    expect(littleArcBridgeOffset + ((((adr >>> 5) & 0x7ffff) << 2) | ((adr >>> 29) & 3))).toBe(littleArcBridgeOffset + 64);
    expect(adrpAdd(littleArcBridgeOffset + 0xc)).toBe(0x29f7828);
    expect(adrpAdd(littleArcBridgeOffset + 0x24)).toBe(0x2264844);
    expect(target(0x1af800)).toBe(0x1af868);
    expect(target(0x31cb04)).toBe(0x31cb50);
    expect(target(0x1f5f7a0)).toBe(0x1f5f89c);
    expect(target(0x313cd0)).toBe(shortcutBridgeOffset);
    expect(target(0x2a3ade8)).toBe(localCloseBridgeOffset);
    expect(target(localCloseBridgeOffset + 4)).toBe(0x2a3adec);
    expect(target(localCloseBridgeOffset + 40)).toBe(0x2a3adec);
    expect(target(shortcutBridgeOffset + 28)).toBe(0x733c);
    expect(target(shortcutBridgeOffset + 40)).toBe(0x35ad624);
    expect(target(shortcutBridgeOffset + 68)).toBe(0x313d0c);
    expect(target(shortcutBridgeOffset + 76)).toBe(0x313e74);
    expect(patched.subarray(0x31caf4, 0x31cb04)).toEqual(original.subarray(0x31caf4, 0x31cb04));
    expect(patched.subarray(0x2a7cb58, 0x2a7cb60)).toEqual(original.subarray(0x2a7cb58, 0x2a7cb60));
  });

  test("local close fallback keeps native cleanup and every global account getter intact", () => {
    expect(patched.subarray(0x2a3add4, 0x2a3ade8)).toEqual(original.subarray(0x2a3add4, 0x2a3ade8));
    expect(patched.subarray(0x2a3adec, 0x2a3b7a8)).toEqual(original.subarray(0x2a3adec, 0x2a3b7a8));
    expect(patched.subarray(0x16f1c0, 0x16f324)).toEqual(original.subarray(0x16f1c0, 0x16f324));
    expect(localCloseBridge.readUInt32LE(0)).toBe(0xb4000041);
    expect(localCloseBridgeOffset + localCloseBridge.length).toBeLessThanOrEqual(0x3138);
  });

  test("app icons are available without an account; the signed-in availability rules are unchanged", () => {
    expect(patched.readUInt32LE(0x1eee7f0)).toBe(0x52800000);
    expect(original.readUInt32LE(0x1eee7f0)).toBe(0x1a9f07e0);
    expect(patched.subarray(0x1eee6d4, 0x1eee7f0)).toEqual(original.subarray(0x1eee6d4, 0x1eee7f0));
    expect(patched.subarray(0x1eee7f4, 0x1eee9ac)).toEqual(original.subarray(0x1eee7f4, 0x1eee9ac));
  });

  test("local saved-window restore preserves state destruction and native saved-data checks", () => {
    expect(patched.readUInt32LE(0x2ab2f48)).toBe(0xd503201f);
    expect(patched.subarray(0x2ab2f1c, 0x2ab2f48)).toEqual(original.subarray(0x2ab2f1c, 0x2ab2f48));
    expect(patched.subarray(0x2ab2f4c, 0x2ab3410)).toEqual(original.subarray(0x2ab2f4c, 0x2ab3410));
    expect(patched.subarray(0x2a4f2a0, 0x2a4f36c)).toEqual(original.subarray(0x2a4f2a0, 0x2a4f36c));
  });

  test("shortcut bridge preserves shared state-failure cleanup and the first original instruction", () => {
    expect(patched.subarray(0x313cd4, 0x313d0c)).toEqual(original.subarray(0x313cd4, 0x313d0c));
    expect(patched.subarray(0x314840, 0x314858)).toEqual(original.subarray(0x314840, 0x314858));
    expect(patched.subarray(0x3138, 0x3150)).toEqual(original.subarray(0x3138, 0x3150));
    expect(patched.subarray(shortcutBridgeOffset, shortcutBridgeOffset + shortcutBridge.length)).toEqual(shortcutBridge);
    expect(shortcutBridge.subarray(80, 80 + shortcutBridgeSymbol.length).toString()).toBe(shortcutBridgeSymbol);
    expect(shortcutBridge.readUInt32LE(0)).toBe(0xa9bf7bfd);
    expect(shortcutBridge.readUInt32LE(64)).toBe(0xa8c17bfd);
    expect(shortcutBridge.readUInt32LE(72)).toBe(0xa8c17bfd);
    expect(shortcutBridge.readUInt32LE(52)).toBe(0xf9413e60); // original NSMenuItem stack slot
  });

  test("Settings completes only the CloudKit status effect through the existing native continuation", () => {
    expect(patched.readUInt32LE(0x1f5f79c)).toBe(0xf90082df); // str xzr,[x22,#0x100], couldNotDetermine
    expect(patched.subarray(0x1f5f7a4, 0x1f5f89c)).toEqual(original.subarray(0x1f5f7a4, 0x1f5f89c));
    expect(patched.subarray(0x1f5f89c, 0x1f5f8ec)).toEqual(original.subarray(0x1f5f89c, 0x1f5f8ec));
  });

  test("preserves the Foundation indirect-result ABI and LDConfig's other defaults", () => {
    expect(patched.readUInt32LE(0xdab528)).toBe(0xf900011f); // str xzr,[x8], eight-byte OptionSet
    expect(patched.subarray(0xdab520, 0xdab528)).toEqual(original.subarray(0xdab520, 0xdab528));
    expect(patched.subarray(0xdab52c, 0xdab534)).toEqual(original.subarray(0xdab52c, 0xdab534));
    expect(patched.readUInt32LE(0x143426c)).toBe(0x38286abf); // only startOnline's store becomes false
    expect(patched.subarray(0x143425c, 0x143426c)).toEqual(original.subarray(0x143425c, 0x143426c));
    expect(patched.subarray(0x1434270, 0x143427c)).toEqual(original.subarray(0x1434270, 0x143427c));
  });

  test("is idempotent", () => expect(patchLocalMode(patched)).toEqual(patched));

  test("rejects another version without mutating its bytes", () => {
    const mismatch = Buffer.from(original);
    mismatch[0x2a75744] = 1;
    const digest = Bun.hash(mismatch);
    expect(() => patchLocalMode(mismatch)).toThrow("fingerprint mismatch");
    expect(Bun.hash(mismatch)).toBe(digest);
  });

  test("rejects drift in either performance fingerprint", () => {
    for (const offset of [0xdab524, 0x1434264, 0x313cd0, 0x2a3ade8, 0x2ab2f48]) {
      const mismatch = Buffer.from(original);
      mismatch[offset] = 0;
      const digest = Bun.hash(mismatch);
      expect(() => patchLocalMode(mismatch)).toThrow("fingerprint mismatch");
      expect(Bun.hash(mismatch)).toBe(digest);
    }
  });

  test("refuses occupied header padding without changing input", () => {
    const occupied = Buffer.from(original);
    occupied[shortcutBridgeOffset] = 1;
    const digest = Bun.hash(occupied);
    expect(() => patchLocalMode(occupied)).toThrow("fingerprint mismatch");
    expect(Bun.hash(occupied)).toBe(digest);
  });

  test("rejects wrong architecture and truncated input", () => {
    const wrongArchitecture = Buffer.from(original);
    wrongArchitecture.writeUInt32LE(7, 4);
    expect(() => patchLocalMode(wrongArchitecture)).toThrow("thin arm64");
    expect(() => patchLocalMode(original.subarray(0, 32))).toThrow("truncated");
  });
});

test("Chromium keeps shared Firebase/web backends available to ordinary websites", () => {
  expect(hostResolverRules).toContain("MAP *.arc.net ~NOTFOUND");
  expect(hostResolverRules).not.toMatch(/firebase|firestore|identitytoolkit|securetoken|launchdarkly|segment|sentry/);
});
