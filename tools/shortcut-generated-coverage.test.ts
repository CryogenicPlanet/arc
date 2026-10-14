import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { arm64Image, verifyGeneratedShortcutImage } from "./shortcut-generated-coverage";
import generated from "../resources/shortcut-generated-inventory.json";
import policy from "../resources/local-shortcut-policy.json";

const image = readFileSync(join(import.meta.dir, "../bin/Arc.arm64"));
test("generated menu constructors and native validators match the pinned binary", () => {
  expect(verifyGeneratedShortcutImage(image)).toEqual(generated.families);
  expect(verifyGeneratedShortcutImage(readFileSync("/Applications/Arc.app/Contents/MacOS/Arc"))).toEqual(generated.families);
  const count = generated.families.reduce((sum, family) => sum + ("ids" in family ? family.ids!.length : "id" in family ? 1 : 0), 0);
  expect(count).toBe(21);
});
test("generated menu and validator drift fails closed", () => {
  for (const builder of generated.builders) {
    const changed = Buffer.from(image), offset = Number.parseInt(builder.address, 16) - 0x100000000;
    changed[offset] = changed[offset]! ^ 1;
    expect(() => verifyGeneratedShortcutImage(changed)).toThrow("drift");
  }
});
test("fat architecture ranges and wrong architecture are rejected", () => {
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(8), image.subarray(0, 8)]) expect(() => arm64Image(bytes)).toThrow();
  const wrong = Buffer.from(image.subarray(0, 32)); wrong.writeUInt32LE(0x1000007, 4);
  expect(() => arm64Image(wrong)).toThrow("arm64");
  const fat = Buffer.alloc(28); fat.writeUInt32BE(0xcafebabe); fat.writeUInt32BE(1, 4); fat.writeUInt32BE(0x100000c, 8);
  fat.writeUInt32BE(0xffffffff, 16); fat.writeUInt32BE(32, 20);
  expect(() => arm64Image(fat)).toThrow("range");
});
test("native generated IDs never grant MainWindow callback permissions", () => {
  for (const id of ["item1", "item9", "item10", "pane1", "pane4", "pane5", "nextTab", "previousTab", "space1", "space999"]) {
    expect(policy.bindingIDs.includes(id)).toBe(false);
  }
  expect(policy.selectors.includes("focusSpace:")).toBe(true);
});
