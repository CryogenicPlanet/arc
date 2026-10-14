import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Primitive = string | number | boolean | null;
type Ref = { ref: number };
type Value = Primitive | Buffer | Ref;
type Field = { key: string; value: Value };
type NibObject = { className: string; fields: Field[] };
export type MenuEntry = {
  nibId: number; title: string; selector: string; target: string;
  keyEquivalent: string; modifierMask: number; defaultShortcut: string | null;
  tag: number; nativeIdentifier: string | null; hidden: boolean;
  allowedWhenHidden: boolean; runtimeAttributes: Record<string, Primitive>;
  bindingId: string | null;
};
export type ShortcutInventory = {
  schemaVersion: 1; arcVersion: string; arcBuild: string; source: string;
  sourceSha256: string; entries: MenuEntry[];
};

const decoder = new TextDecoder("utf-8", { fatal: true });
const invalid = (reason: string): never => { throw new Error(`Invalid NIBArchive: ${reason}`); };
const isRef = (value: Value | undefined): value is Ref =>
  value !== null && typeof value === "object" && !Buffer.isBuffer(value) && "ref" in value;

/** Decode only the bounded archive format; never instantiate AppKit/Swift objects. */
export function parseNibMenu(buffer: Buffer): MenuEntry[] {
  if (buffer.length < 50 || buffer.length > 16 * 1024 * 1024 || buffer.subarray(0, 10).toString() !== "NIBArchive") invalid("header");
  const header = Array.from({ length: 10 }, (_, i) => buffer.readUInt32LE(10 + i * 4));
  if (header[0] !== 1 || header[1] !== 10) invalid("unsupported archive version");
  const objectCount = header[2]!, objectOffset = header[3]!, keyCount = header[4]!, keyOffset = header[5]!;
  const valueCount = header[6]!, valueOffset = header[7]!, classCount = header[8]!, classOffset = header[9]!;
  if (objectOffset !== 50 || !(objectOffset < keyOffset && keyOffset < valueOffset && valueOffset < classOffset && classOffset < buffer.length)) invalid("section offsets");
  if (!objectCount || objectCount > 100_000 || objectCount > (keyOffset - objectOffset) / 3 || !keyCount || keyCount > 100_000 || keyCount > valueOffset - keyOffset || !valueCount || valueCount > 1_000_000 || valueCount > (classOffset - valueOffset) / 2 || !classCount || classCount > 100_000 || classCount > (buffer.length - classOffset) / 3) invalid("section counts");
  let cursor = 0, end = 0;
  const take = (count: number): Buffer => {
    if (!Number.isSafeInteger(count) || count < 0 || count > end - cursor) invalid("truncated section");
    const bytes = buffer.subarray(cursor, cursor + count); cursor += count; return bytes;
  };
  const uint = (): number => take(4).readUInt32LE();
  const variable = (): number => {
    let value = 0;
    for (let shift = 0; shift <= 28; shift += 7) {
      const byte = take(1)[0]!;
      value += (byte & 127) * 2 ** shift;
      if (value > 0xffffffff) invalid("varint overflow");
      if (byte & 128) return value;
    }
    return invalid("unterminated varint");
  };
  const finish = () => { if (cursor !== end) invalid("section size mismatch"); };
  const text = (bytes: Buffer): string => { try { return decoder.decode(bytes); } catch { return invalid("invalid UTF-8"); } };
  cursor = keyOffset; end = valueOffset;
  const keys = Array.from({ length: keyCount }, () => text(take(variable()))); finish();
  if (new Set(keys).size !== keys.length) invalid("duplicate archive keys");
  cursor = classOffset; end = buffer.length;
  const classes = Array.from({ length: classCount }, () => {
    const length = variable(), extras = variable(); take(extras * 4);
    const bytes = take(length);
    if (!length || bytes[length - 1] !== 0) invalid("class name terminator");
    const name = text(bytes.subarray(0, -1));
    if (!name || name.includes("\0")) invalid("class name");
    return name;
  }); finish();
  cursor = valueOffset; end = classOffset;
  const fields = Array.from({ length: valueCount }, (): Field => {
    const keyIndex = variable(); if (keyIndex >= keyCount) invalid("key reference");
    const type = take(1)[0]!;
    let value: Value;
    switch (type) {
      case 0: value = take(1).readInt8(); break;
      case 1: value = take(2).readInt16LE(); break;
      case 2: value = take(4).readInt32LE(); break;
      case 3: {
        const integer = take(8).readBigInt64LE(); value = Number(integer);
        if (!Number.isSafeInteger(value)) invalid("unsafe integer"); break;
      }
      case 4: value = true; break;
      case 5: value = false; break;
      case 6: value = take(4).readFloatLE(); break;
      case 7: value = take(8).readDoubleLE(); break;
      case 8: value = take(variable()); break;
      case 9: value = null; break;
      case 10: { const ref = uint(); if (ref >= objectCount) invalid("object reference"); value = { ref }; break; }
      default: return invalid(`unsupported value type ${type}`);
    }
    if (typeof value === "number" && !Number.isFinite(value)) invalid("nonfinite number");
    return { key: keys[keyIndex]!, value };
  }); finish();
  cursor = objectOffset; end = keyOffset;
  let nextValue = 0;
  const objects = Array.from({ length: objectCount }, (): NibObject => {
    const classIndex = variable(), start = variable(), count = variable();
    if (classIndex >= classCount) invalid("class reference");
    // The supported archive owns each value once, in object order. Enforce this
    // before copying ranges so adversarial overlaps cannot multiply allocation.
    if (start !== nextValue || start > valueCount || count > valueCount - start) invalid("object value range");
    nextValue += count;
    return { className: classes[classIndex]!, fields: fields.slice(start, start + count) };
  }); finish();
  if (nextValue !== valueCount) invalid("unowned object values");
  const field = (object: NibObject, key: string): Value | undefined => {
    const values = object.fields.filter((entry) => entry.key === key);
    if (values.length > 1) invalid(`duplicate field ${key}`);
    return values[0]?.value;
  };
  const referenced = (value: Value | undefined, label: string): NibObject => {
    if (!isRef(value)) return invalid(`${label} must be an object reference`);
    return objects[value.ref]!;
  };
  const scalar = (value: Value | undefined): Primitive => {
    if (value === undefined) return invalid("missing scalar");
    if (isRef(value)) {
      const object = objects[value.ref]!;
      if (["NSString", "NSLocalizableString"].includes(object.className)) {
        const bytes = field(object, "NS.bytes");
        if (!Buffer.isBuffer(bytes)) return invalid("string payload");
        return text(bytes);
      }
      if (object.className === "NSNumber") {
        const number = field(object, "NS.boolval") ?? field(object, "NS.intval") ?? field(object, "NS.dblval");
        if (typeof number !== "number" && typeof number !== "boolean") return invalid("number payload");
        return number;
      }
      return invalid(`unsupported scalar class ${object.className}`);
    }
    if (Buffer.isBuffer(value)) return invalid("unexpected scalar data");
    return value;
  };
  const string = (value: Value | undefined, label: string): string => {
    const resolved = scalar(value); if (typeof resolved !== "string") return invalid(`${label} must be a string`); return resolved;
  };
  const array = (value: Value | undefined): Value[] => {
    const object = referenced(value, "array");
    if (!["NSArray", "NSMutableArray"].includes(object.className)) invalid("array class");
    return object.fields.filter((entry) => entry.key === "UINibEncoderEmptyKey").map((entry) => entry.value);
  };
  const attributes = new Map<number, Record<string, Primitive>>();
  for (const object of objects) {
    if (object.className !== "NSIBUserDefinedRuntimeAttributesConnector") continue;
    const target = field(object, "NSObject"); if (!isRef(target)) return invalid("runtime attribute target");
    const names = array(field(object, "NSKeyPaths")), values = array(field(object, "NSValues"));
    if (names.length !== values.length) invalid("runtime attribute arrays");
    const attrs = attributes.get(target.ref) ?? {};
    names.forEach((name, i) => {
      const key = string(name, "runtime attribute key");
      if (!key || ["__proto__", "constructor", "prototype"].includes(key) || Object.hasOwn(attrs, key)) invalid("runtime attribute key");
      attrs[key] = scalar(values[i]);
    });
    attributes.set(target.ref, attrs);
  }
  const entries = new Map<number, MenuEntry>();
  for (const connector of objects) {
    if (connector.className !== "NSNibControlConnector") continue;
    const source = field(connector, "NSSource"), menu = referenced(source, "control source");
    const title = field(menu, "NSTitle"); if (title === undefined) continue;
    if (menu.className !== "NSMenuItem" && menu.className !== "NSClassSwapper") invalid("menu item class");
    const selector = string(field(connector, "NSLabel"), "action selector");
    if (!/^[A-Za-z_][A-Za-z0-9_:]*$/.test(selector)) invalid("action selector");
    const targetValue = field(connector, "NSDestination");
    let target = "FirstResponder";
    if (targetValue !== undefined && targetValue !== null) {
      const object = referenced(targetValue, "action target");
      const customClass = field(object, "NSClassName");
      target = customClass === undefined ? object.className : string(customClass, "target class");
    }
    const number = (key: string, fallback: number): number => {
      const value = field(menu, key); if (value === undefined) return fallback;
      if (typeof value !== "number" || !Number.isSafeInteger(value)) return invalid(`menu number ${key}`); return value;
    };
    const boolean = (key: string): boolean => {
      const value = field(menu, key); if (value === undefined) return false;
      if (typeof value !== "boolean") return invalid(`menu boolean ${key}`); return value;
    };
    const id = (source as Ref).ref, runtimeAttributes = attributes.get(id) ?? {};
    const binding = runtimeAttributes.arcKeyBindingID;
    if (binding !== undefined && typeof binding !== "string") invalid("binding ID");
    const keyEquivalent = string(field(menu, "NSKeyEquiv"), "key equivalent");
    const modifierMask = number("NSKeyEquivModMask", 1 << 20);
    if (modifierMask < 0) invalid("negative modifier mask");
    const modifiers = [[1 << 18, "Ctrl"], [1 << 19, "Alt"], [1 << 17, "Shift"], [1 << 20, "Cmd"]] as const;
    const mask = modifierMask | (/^[A-Z]$/.test(keyEquivalent) ? 1 << 17 : 0);
    const shortcut = modifiers.filter(([flag]) => mask & flag).map(([, name]) => name);
    const entry: MenuEntry = {
      nibId: id, title: string(title, "title"), selector, target, keyEquivalent, modifierMask,
      defaultShortcut: keyEquivalent ? [...shortcut, keyEquivalent].join("+") : null,
      tag: number("NSTag", 0), nativeIdentifier: field(menu, "NSMenuItemIdentifier") === undefined ? null : string(field(menu, "NSMenuItemIdentifier"), "identifier"),
      hidden: boolean("NSIsHidden"), allowedWhenHidden: boolean("NSKEAllowedWhenHidden"),
      runtimeAttributes: Object.fromEntries(Object.entries(runtimeAttributes).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)),
      bindingId: typeof binding === "string" ? binding : null,
    };
    if (entries.has(id)) invalid("multiple actions for one menu item");
    entries.set(id, entry);
  }
  return [...entries.values()].sort((a, b) => a.nibId - b.nibId);
}

export function inventoryFromArc(path = "/Applications/Arc.app"): ShortcutInventory {
  const plist = join(path, "Contents/Info.plist");
  const read = (key: string): string => {
    const result = Bun.spawnSync(["/usr/bin/plutil", "-extract", key, "raw", "-o", "-", plist], { stdout: "pipe", stderr: "pipe" });
    if (!result.success) throw new Error(`Cannot read Arc bundle ${key}`);
    return result.stdout.toString().trim();
  };
  const arcVersion = read("CFBundleShortVersionString"), arcBuild = read("CFBundleVersion");
  if (arcVersion !== "1.168.0" || arcBuild !== "88413") throw new Error(`Unsupported Arc version ${arcVersion} (${arcBuild})`);
  const source = "Contents/Resources/Base.lproj/MainMenu.nib", buffer = readFileSync(join(path, source));
  const entries = parseNibMenu(buffer);
  if (!entries.length) throw new Error("Arc menu archive contains no actionable entries");
  return { schemaVersion: 1, arcVersion, arcBuild, source, sourceSha256: createHash("sha256").update(buffer).digest("hex"), entries };
}

if (import.meta.main) {
  let source = "/Applications/Arc.app", write: string | undefined;
  const args = process.argv.slice(2);
  while (args.length) {
    const flag = args.shift(), value = args.shift();
    if (!value || value.startsWith("--") || (flag !== "--source" && flag !== "--write")) throw new Error("Usage: bun tools/shortcut-inventory.ts [--source /Applications/Arc.app] [--write resources/shortcut-menu-inventory.json]");
    if (flag === "--source") source = value; else write = value;
  }
  // Validate the entire archive and bundle before opening any output file.
  const output = JSON.stringify(inventoryFromArc(source), null, 2) + "\n";
  if (write) writeFileSync(write, output); else process.stdout.write(output);
}
