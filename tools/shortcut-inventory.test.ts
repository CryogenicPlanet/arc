import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import snapshot from "../resources/shortcut-menu-inventory.json";
import { inventoryFromArc, parseNibMenu } from "./shortcut-inventory";

type Encoded = { type: number; value?: number | string | boolean | null };
type FixtureObject = { name: string; fields: [string, Encoded][] };
const ref = (value: number): Encoded => ({ type: 10, value });
const int = (value: number): Encoded => ({ type: 2, value });
const str = (value: string): FixtureObject => ({ name: "NSString", fields: [["NS.bytes", { type: 8, value }]] });
const variable = (number: number): Buffer => {
  const bytes: number[] = [];
  do { const byte = number % 128; number = Math.floor(number / 128); bytes.push(byte | (number ? 0 : 128)); } while (number);
  return Buffer.from(bytes);
};
const uint = (value: number): Buffer => { const buffer = Buffer.alloc(4); buffer.writeUInt32LE(value); return buffer; };
const encode = (value: Encoded): Buffer => {
  let payload: Buffer = Buffer.alloc(0);
  if (value.type === 2) { payload = Buffer.alloc(4); payload.writeInt32LE(value.value as number); }
  if (value.type === 7) { payload = Buffer.alloc(8); payload.writeDoubleLE(value.value as number); }
  if (value.type === 8) { const bytes = Buffer.from(value.value as string); payload = Buffer.concat([variable(bytes.length), bytes]); }
  if (value.type === 10) payload = uint(value.value as number);
  return Buffer.concat([Buffer.from([value.type]), payload]);
};
function fixture(change?: (objects: FixtureObject[]) => void): Buffer {
  const objects: FixtureObject[] = [
    { name: "NSClassSwapper", fields: [["NSTitle", ref(1)], ["NSKeyEquiv", ref(2)], ["NSKeyEquivModMask", int(1048576)], ["NSTag", int(8)]] },
    str("Redo"), str("Z"),
    { name: "NSNibControlConnector", fields: [["NSSource", ref(0)], ["NSLabel", ref(4)], ["NSDestination", { type: 9 }]] },
    str("redo:"),
    { name: "NSIBUserDefinedRuntimeAttributesConnector", fields: [["NSObject", ref(0)], ["NSKeyPaths", ref(6)], ["NSValues", ref(7)]] },
    { name: "NSArray", fields: [["NSInlinedValue", { type: 4 }], ...[8, 9, 19].map((id): [string, Encoded] => ["UINibEncoderEmptyKey", ref(id)])] },
    { name: "NSMutableArray", fields: [["NSInlinedValue", { type: 4 }], ...[10, 11, 20].map((id): [string, Encoded] => ["UINibEncoderEmptyKey", ref(id)])] },
    str("arcKeyBindingID"), str("arcKeyBindingPriority"), str("redo"), str("high"),
    { name: "NSMenuItem", fields: [["NSTitle", ref(13)], ["NSKeyEquiv", ref(14)], ["NSIsHidden", { type: 5 }], ["NSKEAllowedWhenHidden", { type: 4 }]] },
    str("Bold"), str("b"),
    { name: "NSNibControlConnector", fields: [["NSSource", ref(12)], ["NSLabel", ref(16)], ["NSDestination", ref(17)]] },
    str("addFontTrait:"),
    { name: "NSCustomObject", fields: [["NSClassName", ref(18)]] }, str("NSFontManager"),
    str("arcTypeTravelCandidateBump"), { name: "NSNumber", fields: [["NS.dblval", { type: 7, value: 0.5 }]] },
  ];
  change?.(objects);
  const classes = [...new Set(objects.map((object) => object.name))];
  const keys = [...new Set(objects.flatMap((object) => object.fields.map(([key]) => key)))];
  let valueCount = 0;
  const objectBytes = Buffer.concat(objects.map((object) => {
    const bytes = Buffer.concat([variable(classes.indexOf(object.name)), variable(valueCount), variable(object.fields.length)]);
    valueCount += object.fields.length; return bytes;
  }));
  const keyBytes = Buffer.concat(keys.map((key) => Buffer.concat([variable(Buffer.byteLength(key)), Buffer.from(key)])));
  const valueBytes = Buffer.concat(objects.flatMap((object) => object.fields.map(([key, value]) => Buffer.concat([variable(keys.indexOf(key)), encode(value)]))));
  const classBytes = Buffer.concat(classes.map((name) => Buffer.concat([variable(Buffer.byteLength(name) + 1), variable(0), Buffer.from(name + "\0")])));
  const objectOffset = 50, keyOffset = objectOffset + objectBytes.length, valueOffset = keyOffset + keyBytes.length, classOffset = valueOffset + valueBytes.length;
  const header = Buffer.concat([Buffer.from("NIBArchive"), ...[1, 10, objects.length, objectOffset, keys.length, keyOffset, valueCount, valueOffset, classes.length, classOffset].map(uint)]);
  return Buffer.concat([header, objectBytes, keyBytes, valueBytes, classBytes]);
}

describe("bounded static menu inventory", () => {
  test("recovers bound and standard wrapper actions, target, tag and runtime attributes", () => {
    const menu = parseNibMenu(fixture());
    expect(menu).toHaveLength(2);
    expect(menu[0]).toEqual({ nibId: 0, title: "Redo", selector: "redo:", target: "FirstResponder", keyEquivalent: "Z", modifierMask: 1048576,
      defaultShortcut: "Shift+Cmd+Z", tag: 8, nativeIdentifier: null, hidden: false, allowedWhenHidden: false,
      runtimeAttributes: { arcKeyBindingID: "redo", arcKeyBindingPriority: "high", arcTypeTravelCandidateBump: 0.5 }, bindingId: "redo" });
    expect(menu[1]).toMatchObject({ title: "Bold", selector: "addFontTrait:", target: "NSFontManager", bindingId: null, modifierMask: 1048576, hidden: false, allowedWhenHidden: true });
  });
  test("preserves empty strings and a missing key modifier mask's native Cmd default", () => {
    const menu = parseNibMenu(fixture((objects) => { objects[2] = str(""); objects[0]!.fields = objects[0]!.fields.filter(([key]) => key !== "NSKeyEquivModMask"); }));
    expect(menu[0]).toMatchObject({ keyEquivalent: "", defaultShortcut: null, modifierMask: 1048576 });
  });
  test("rejects every truncation boundary without reading across archive sections", () => {
    const buffer = fixture();
    for (let cut = 0; cut < buffer.length; cut++) expect(() => parseNibMenu(buffer.subarray(0, cut))).toThrow("Invalid NIBArchive");
  });
  test("rejects unsupported archive version, impossible counts, offsets and appended data", () => {
    for (const [offset, value] of [[10, 2], [14, 11], [18, 0xffffffff], [26, 0xffffffff], [34, 0xffffffff], [42, 0xffffffff], [22, 49], [30, 0], [38, 0], [46, 0]]) {
      const buffer = fixture(); buffer.writeUInt32LE(value!, offset!);
      expect(() => parseNibMenu(buffer)).toThrow("Invalid NIBArchive");
    }
    expect(() => parseNibMenu(Buffer.concat([fixture(), Buffer.from([0])]))).toThrow("section size mismatch");
  });
  test("rejects invalid object, key, class and value ranges", () => {
    expect(() => parseNibMenu(fixture((objects) => { objects[0]!.fields[0] = ["NSTitle", ref(999)]; }))).toThrow("object reference");
    const key = fixture(); key[key.readUInt32LE(38)] = 255;
    expect(() => parseNibMenu(key)).toThrow("key reference");
    const objectClass = fixture(); objectClass[50] = 255;
    expect(() => parseNibMenu(objectClass)).toThrow("class reference");
    const valueStart = fixture(); valueStart[51] = 255;
    expect(() => parseNibMenu(valueStart)).toThrow("object value range");
    const valueCount = fixture(); valueCount[52] = 255;
    expect(() => parseNibMenu(valueCount)).toThrow("object value range");
  });
  test("rejects unknown types, nonfinite numbers and mistyped menu data", () => {
    expect(() => parseNibMenu(fixture((objects) => { objects[0]!.fields[0] = ["NSTitle", { type: 255 }]; }))).toThrow("unsupported value type");
    expect(() => parseNibMenu(fixture((objects) => { objects[20]!.fields[0] = ["NS.dblval", { type: 7, value: NaN }]; }))).toThrow("nonfinite number");
    expect(() => parseNibMenu(fixture((objects) => { objects[0]!.fields[0] = ["NSTitle", int(10)]; }))).toThrow("title must be a string");
    expect(() => parseNibMenu(fixture((objects) => { objects[0]!.fields.push(["NSIsHidden", int(1)]); }))).toThrow("menu boolean");
  });
  test("rejects malformed UTF-8, class names and varints", () => {
    const utf8 = fixture(); utf8[utf8.readUInt32LE(30) + 1] = 255;
    expect(() => parseNibMenu(utf8)).toThrow("UTF-8");
    const terminator = fixture(); terminator[terminator.length - 1] = 1;
    expect(() => parseNibMenu(terminator)).toThrow("class name terminator");
    const unterminated = fixture(); unterminated.fill(0, 50, 55);
    expect(() => parseNibMenu(unterminated)).toThrow("unterminated varint");
    const overflow = fixture(); overflow.fill(127, 50, 55);
    expect(() => parseNibMenu(overflow)).toThrow("varint overflow");
  });
  test("rejects mismatched runtime attribute arrays, duplicate keys and ambiguous actions", () => {
    expect(() => parseNibMenu(fixture((objects) => { objects[7]!.fields.pop(); }))).toThrow("runtime attribute arrays");
    expect(() => parseNibMenu(fixture((objects) => { objects[9] = str("arcKeyBindingID"); }))).toThrow("runtime attribute key");
    expect(() => parseNibMenu(fixture((objects) => { objects[8] = str("__proto__"); }))).toThrow("runtime attribute key");
    expect(() => parseNibMenu(fixture((objects) => { objects[0]!.fields.push(["NSTitle", ref(1)]); }))).toThrow("duplicate field");
    expect(() => parseNibMenu(fixture((objects) => { objects.push(objects[3]!); }))).toThrow("multiple actions");
  });
  test("CLI validates version and malformed archives before overwriting output", () => {
    const directory = mkdtempSync(join(tmpdir(), "arc-menu-inventory-"));
    try {
      const contents = join(directory, "Arc.app/Contents"); mkdirSync(join(contents, "Resources/Base.lproj"), { recursive: true });
      const plist = (version: string) => `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleVersion</key><string>88413</string></dict></plist>`;
      const output = join(directory, "output.json"); writeFileSync(output, "preserved\n");
      writeFileSync(join(contents, "Info.plist"), plist("1.167.0"));
      writeFileSync(join(contents, "Resources/Base.lproj/MainMenu.nib"), fixture());
      expect(() => inventoryFromArc(join(directory, "Arc.app"))).toThrow("Unsupported Arc version");
      const run = () => Bun.spawnSync([process.execPath, join(import.meta.dir, "shortcut-inventory.ts"), "--source", join(directory, "Arc.app"), "--write", output], { stdout: "pipe", stderr: "pipe" });
      expect(run().success).toBe(false); expect(readFileSync(output, "utf8")).toBe("preserved\n");
      writeFileSync(join(contents, "Info.plist"), plist("1.168.0"));
      writeFileSync(join(contents, "Resources/Base.lproj/MainMenu.nib"), fixture().subarray(0, 60));
      expect(run().success).toBe(false); expect(readFileSync(output, "utf8")).toBe("preserved\n");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

describe.skipIf(!existsSync(join(import.meta.dir, "../bin/Arc.arm64")))("shipped Arc 1.168.0 menu inventory", () => {
  test("matches the complete fingerprinted snapshot, including all 73 entries absent from binding-only inventory", () => {
    const inventory = inventoryFromArc();
    expect(inventory as unknown).toEqual(snapshot);
    expect(inventory.entries).toHaveLength(162);
    expect(inventory.entries.filter((entry) => entry.bindingId)).toHaveLength(89);
    for (const selector of ["copyAction:", "cut:", "paste:", "selectAll:", "undo:", "redo:", "underline:", "addFontTrait:", "checkSpelling:"]) {
      expect(inventory.entries.some((entry) => entry.selector === selector && entry.bindingId === null)).toBe(true);
    }
    expect(inventory.entries.find((entry) => entry.selector === "redo:")?.defaultShortcut).toBe("Shift+Cmd+Z");
  });
});
