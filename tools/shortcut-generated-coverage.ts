import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import generated from "../resources/shortcut-generated-inventory.json";
import policy from "../resources/local-shortcut-policy.json";

// This target ships either a thin arm64 image or a 32-bit fat header. Reject
// other formats rather than interpreting unknown offsets as code fingerprints.
export function arm64Image(bytes: Buffer): Buffer {
  if (bytes.length < 8) throw new Error("truncated Mach-O");
  const thin = (image: Buffer) => {
    if (image.length < 32 || image.readUInt32LE(0) !== 0xfeedfacf || image.readUInt32LE(4) !== 0x100000c) throw new Error("expected arm64 Mach-O");
    return image;
  };
  if (bytes.readUInt32LE(0) === 0xfeedfacf) return thin(bytes);
  if (bytes.readUInt32BE(0) !== 0xcafebabe) throw new Error("unsupported Mach-O container");
  const count = bytes.readUInt32BE(4);
  if (!count || count > 32 || 8 + count * 20 > bytes.length) throw new Error("invalid fat architecture table");
  const matches: Buffer[] = [];
  for (let index = 0; index < count; index++) {
    const start = 8 + index * 20, offset = bytes.readUInt32BE(start + 8), size = bytes.readUInt32BE(start + 12);
    if (offset < 8 + count * 20 || size < 32 || offset > bytes.length || size > bytes.length - offset) throw new Error("invalid fat architecture range");
    if (bytes.readUInt32BE(start) === 0x100000c) matches.push(thin(bytes.subarray(offset, offset + size)));
  }
  if (matches.length !== 1) throw new Error("expected exactly one arm64 image");
  return matches[0]!;
}

export function verifyGeneratedShortcutImage(bytes: Buffer) {
  const image = arm64Image(bytes);
  for (const builder of generated.builders) {
    // __TEXT has vmaddr 0x100000000 and fileoff zero in this pinned target.
    const offset = Number.parseInt(builder.address, 16) - 0x100000000;
    if (offset < 0 || builder.length > image.length - offset ||
        createHash("sha256").update(image.subarray(offset, offset + builder.length)).digest("hex") !== builder.sha256) {
      throw new Error(`generated shortcut builder drift at ${builder.address}; review native actions`);
    }
  }
  for (const family of generated.families) {
    if (family.validation === "localFinitePolicy" && !policy.selectors.includes(family.selector)) throw new Error(`missing generated local selector: ${family.selector}`);
  }
  return generated.families;
}

export function verifyGeneratedShortcutCoverage(source = "/Applications/Arc.app") {
  return verifyGeneratedShortcutImage(readFileSync(join(source, "Contents/MacOS/Arc")));
}
