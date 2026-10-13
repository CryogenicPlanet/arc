// Arc 1.168.0: an AOT bridge in existing RX header padding. No runtime page writes.
export const shortcutBridgeOffset = 0x3070;
export const shortcutBridgeSymbol = "ArcModCanValidateLocalMenuItem";
const base = 0x100000000n + BigInt(shortcutBridgeOffset);
const branch = (from: bigint, to: bigint, link = false): number => {
  const delta = to - from;
  if (delta % 4n || delta < -(1n << 27n) || delta >= (1n << 27n)) throw new Error("bridge branch out of range");
  return ((link ? 0x94000000 : 0x14000000) | Number((delta / 4n) & 0x3ffffffn)) >>> 0;
};
const adrp = (from: bigint, to: bigint, reg: number): number => {
  const delta = (to >> 12n) - (from >> 12n);
  if (delta < -(1n << 20n) || delta >= (1n << 20n)) throw new Error("bridge page out of range");
  const immediate = Number(delta & 0x1fffffn);
  return (0x90000000 | ((immediate & 3) << 29) | ((immediate >> 2) << 5) | reg) >>> 0;
};
const add = (to: bigint, reg: number): number => (0x91000000 | (Number(to & 0xfffn) << 10) | (reg << 5) | reg) >>> 0;
const instructions = [
  0xa9bf7bfd, 0x910003fd, // save native frame/link; keep SP aligned
  adrp(base + 8n, 0x1044b2b40n, 1), add(0x1044b2b40n, 1),
  adrp(base + 16n, 0x10361ae60n, 2), add(0x10361ae60n, 2),
  0xaa1b03e0, branch(base + 28n, 0x10000733cn, true), // original nil-optional cleanup
  0x92800020, 0x10000161, // x0=RTLD_DEFAULT (-2); adr x1,symbol (+44)
  branch(base + 40n, 0x1035ad624n, true), // existing dlsym stub
  0xb40000e0, 0xaa0003f0, // missing helper -> deny; x16=helper
  0xf9413e60, 0xd63f0200, // x0=[x19+0x278] (original menu item); blr x16
  0x34000060, // helper returned false -> deny
  0xa8c17bfd, branch(base + 68n, 0x100313d0cn),
  0xa8c17bfd, branch(base + 76n, 0x100313e74n),
];
const name = Buffer.from(`${shortcutBridgeSymbol}\0`);
export const shortcutBridge = Buffer.alloc(Math.ceil((instructions.length * 4 + name.length) / 16) * 16);
instructions.forEach((word, i) => shortcutBridge.writeUInt32LE(word, i * 4));
shortcutBridge.set(name, instructions.length * 4);
