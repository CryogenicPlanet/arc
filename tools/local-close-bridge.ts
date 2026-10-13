// Arc 1.168.0: only the shared tab-close helper gets a local presence value.
// AuthSession/User getters stay unchanged. The native helper releases this
// String value; its small-string representation owns no heap allocation.
import { shortcutBridge, shortcutBridgeOffset } from "./shortcut-bridge";

export const localCloseBridgeOffset = shortcutBridgeOffset + shortcutBridge.length;
export const localCloseIdentifier = "arcmod-local";
const base = 0x100000000n + BigInt(localCloseBridgeOffset);
const continuation = 0x102a3adecn;
const branch = (from: bigint, to: bigint): number => {
  const delta = to - from;
  if (delta % 4n || delta < -(1n << 27n) || delta >= (1n << 27n)) throw new Error("local close branch out of range");
  return (0x14000000 | Number((delta / 4n) & 0x3ffffffn)) >>> 0;
};
const string = Buffer.alloc(16);
string.write(localCloseIdentifier, "ascii");
string[15] = 0xe0 | localCloseIdentifier.length;
const words = [string.readBigUInt64LE(0), string.readBigUInt64LE(8)];
const moves = words.flatMap((value, register) => Array.from({ length: 4 }, (_, half) =>
  (((half === 0 ? 0xd2800000 : 0xf2800000) | (half << 21) |
    (Number((value >> BigInt(half * 16)) & 0xffffn) << 5) | register) >>> 0)));
const instructions = [
  0xb4000041, // cbz x1,+8: only a missing user ID takes the local fallback
  branch(base + 4n, continuation), // preserve the original retained non-nil String
  ...moves,
  branch(base + 40n, continuation),
];
export const localCloseBridge = Buffer.alloc(48);
instructions.forEach((instruction, i) => localCloseBridge.writeUInt32LE(instruction, i * 4));
if (localCloseBridgeOffset + localCloseBridge.length > 0x3138) throw new Error("local close bridge overlaps original text");
