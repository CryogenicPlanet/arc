// Arc 1.168.0: Little Arc reuse as a setting. Arc reuses an open Little Arc only for a link to the same site
// (hostname and entry point). ArcMod's default is one Little Arc for every link; with
// ARCMOD_LITTLE_ARC_PER_LINK set (ArcMod's Settings turns it on), Arc's own check runs again.
// The decision site at 0x102a7cb60 branches to this bridge, placed in the zero padding at the end of the
// __TEXT segment (after __eh_frame), which calls getenv and continues on one of the two paths.
export const littleArcSite = 0x102a7cb60n;
export const littleArcBridgeAddress = 0x104153e00n;
export const littleArcVariable = "ARCMOD_LITTLE_ARC_PER_LINK";

const GETENV_STUB = 0x1035ad864n;

// The site's original instructions (Arc's same-site check) and ArcMod's single-Little-Arc replacement.
export const littleArcOriginal = Buffer.from("42bfff9042102191e00318aae1031baad82d5697941b80b9", "hex");
export const littleArcSingle = Buffer.from("c1fbfff021a02091e00318aaea2d569728008052" + "1b000014", "hex");

const word = (bytes: Buffer, index: number): number => bytes.readUInt32LE(index * 4);
const signExtend = (value: number, bits: number): bigint => {
  const big = BigInt(value);
  return big & (1n << BigInt(bits - 1)) ? big - (1n << BigInt(bits)) : big;
};

const branchTarget = (instruction: number, pc: bigint): bigint => pc + signExtend(instruction & 0x3ffffff, 26) * 4n;
const branch = (from: bigint, to: bigint, link = false): number => {
  const delta = to - from;
  if (delta % 4n !== 0n || delta < -(1n << 27n) || delta >= (1n << 27n)) throw new Error("Little Arc bridge branch out of range");
  return ((link ? 0x94000000 : 0x14000000) | Number((delta / 4n) & 0x3ffffffn)) >>> 0;
};

// adrp + add (immediate, no shift) → the absolute address they form.
const pageAddress = (adrp: number, add: number, pc: bigint): bigint => {
  const imm = ((adrp >>> 29) & 0x3) | (((adrp >>> 5) & 0x7ffff) << 2);
  const page = (pc & ~0xfffn) + signExtend(imm, 21) * 4096n;
  return page + BigInt((add >>> 10) & 0xfff);
};
const adrpAdd = (register: number, pc: bigint, target: bigint): readonly number[] => {
  const pages = ((target & ~0xfffn) - (pc & ~0xfffn)) / 4096n;
  const imm = Number(BigInt.asUintN(21, pages));
  const adrp = (0x90000000 | ((imm & 0x3) << 29) | ((imm >>> 2) << 5) | register) >>> 0;
  const add = (0x91000000 | (Number(target & 0xfffn) << 10) | (register << 5) | register) >>> 0;
  return [adrp, add];
};

const singleMetadata = pageAddress(word(littleArcSingle, 0), word(littleArcSingle, 1), littleArcSite);
const singleDestroy = branchTarget(word(littleArcSingle, 3), littleArcSite + 12n);
const singleContinue = branchTarget(word(littleArcSingle, 5), littleArcSite + 20n);
const originalMetadata = pageAddress(word(littleArcOriginal, 0), word(littleArcOriginal, 1), littleArcSite);
const originalCompare = branchTarget(word(littleArcOriginal, 4), littleArcSite + 16n);
const originalContinue = littleArcSite + BigInt(littleArcOriginal.length);

const at = (index: number): bigint => littleArcBridgeAddress + BigInt(index * 4);
const stringOffset = 16 * 4;
const instructions: readonly number[] = [
  (0x10000000 | (((stringOffset & 0x3) << 29) | ((stringOffset >>> 2) << 5)) | 0) >>> 0, // adr x0, variable name
  branch(at(1), GETENV_STUB, true), // bl getenv: x0–x17 and flags are dead after the site's bl/cmp/b.ne (notes/local-mode.md)
  (0xb5000000 | ((((9 - 2) * 4 / 4) & 0x7ffff) << 5) | 0) >>> 0, // cbnz x0, Arc's own check
  // One Little Arc (default): ArcMod's replacement, as before.
  ...adrpAdd(1, at(3), singleMetadata),
  0xaa1803e0, // mov x0, x24
  branch(at(6), singleDestroy, true),
  0x52800028, // mov w8, #1
  branch(at(8), singleContinue),
  // ARCMOD_LITTLE_ARC_PER_LINK set: Arc's original same-site check, then back to the site.
  ...adrpAdd(2, at(9), originalMetadata),
  0xaa1803e0, // mov x0, x24
  0xaa1b03e1, // mov x1, x27
  branch(at(13), originalCompare, true),
  word(littleArcOriginal, 5), // ldrsw x20, [x28, #0x18] (not PC-relative)
  branch(at(15), originalContinue),
];

export const littleArcBridge = Buffer.alloc(stringOffset + 32);
instructions.forEach((instruction, i) => littleArcBridge.writeUInt32LE(instruction, i * 4));
littleArcBridge.write(littleArcVariable, stringOffset, "ascii");
if (instructions.length !== 16) throw new Error("Little Arc bridge layout changed");
if (littleArcVariable.length + 1 > 32) throw new Error("Little Arc variable name too long");

// The site: branch to the bridge, keeping the rest of Arc's original bytes (now unreachable) unchanged.
export const littleArcSiteReplacement = Buffer.from(littleArcOriginal);
littleArcSiteReplacement.writeUInt32LE(branch(littleArcSite, littleArcBridgeAddress), 0);
