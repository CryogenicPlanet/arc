#!/usr/bin/env bun
// Merges every name source recovered from the stripped Arc binary into one
// address -> name table (dump/symbol-map.tsv):
//   1. nm symbols that survived stripping (demangled)
//   2. Swift vtable / accessor addresses from `ipsw swift-dump`
//   3. Objective-C method implementations from `ipsw class-dump --re -V`
// Priority on collisions: nm > objc > swift (nm names are exact symbols).

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Source = "nm" | "objc" | "swift";
type Entry = { readonly addr: bigint; readonly name: string; readonly source: Source };

const IMAGE_BASE = 0x1_0000_0000n;
const root = join(import.meta.dir, "..");
const read = (p: string): string => readFileSync(join(root, p), "utf8");

// `nm` lines: "00000001009449a0 T _$s..." paired 1:1 with the demangled file.
const fromNm = (): readonly Entry[] => {
  const raw = read("dump/symbols.txt").split("\n");
  const demangled = read("dump/symbols.demangled.txt").split("\n");
  return raw.flatMap((line, i): Entry[] => {
    const m = /^([0-9a-f]{16}) [tT] /.exec(line);
    const name = demangled[i]?.replace(/^[0-9a-f]{16} [tT] /, "").replace(/^_/, "");
    return m?.[1] && name ? [{ addr: BigInt(`0x${m[1]}`), name, source: "nm" }] : [];
  });
};

const TYPE_HEADER = /^(?:final )?(?:class|struct|enum|actor|protocol|extension) ([^\s{:<(]+)/;
const SUB = /sub_([0-9a-f]{9,})/;

// Member text before the address, e.g. "func _wantsAnchoredLayout.getter.sub_100012ef4"
// -> "_wantsAnchoredLayout.getter"; "func sub_10000abcc // method (instance)" -> "method".
const swiftMember = (line: string): string => {
  const trimmed = line.trim();
  const named = /^(?:static )?func (.+?)\.sub_[0-9a-f]+/.exec(trimmed);
  if (named?.[1]) return named[1];
  const prop = /^(?:let|var) (\w+): \(accessor function/.exec(trimmed);
  if (prop?.[1]) return `${prop[1]}.accessor`;
  const comment = /\/\/ (.+)$/.exec(trimmed);
  const kind = comment?.[1]?.replace(/[()|]/g, "").replace(/\s+/g, "_");
  return trimmed.startsWith("static ") ? `static.${kind ?? "func"}` : (kind ?? "func");
};

const fromSwift = (): readonly Entry[] =>
  read("dump/swift-types.swift")
    .split("\n")
    .reduce<{ type: string; out: Entry[] }>(
      (acc, line) => {
        const header = TYPE_HEADER.exec(line);
        if (header?.[1]) return { type: header[1], out: acc.out };
        const sub = SUB.exec(line);
        if (!sub?.[1]) return acc;
        acc.out.push({ addr: BigInt(`0x${sub[1]}`), name: `${acc.type}.${swiftMember(line)}`, source: "swift" });
        return acc;
      },
      { type: "?", out: [] },
    ).out;

const OBJC_CONTAINER = /^@(?:interface|protocol) (\S+)(?: : \S+)?(?: \((\w*)\))?/;
const OBJC_METHOD = /^([-+]) ?\([^)]*\)(.*);$/;

// Selector from "- (void)focus:(id)focus;" -> "focus:", multi-part keeps every label.
const selector = (sig: string): string => {
  const parts = [...sig.matchAll(/(\w+):\([^)]*\)\s*\w*/g)].map((m) => `${m[1]}:`);
  return parts.length > 0 ? parts.join("") : sig.trim();
};

const fromObjc = (): readonly Entry[] =>
  read("dump/objc-classes.re.h")
    .split("\n")
    .reduce<{ cls: string; pending: bigint | null; out: Entry[] }>(
      (acc, line) => {
        const container = OBJC_CONTAINER.exec(line);
        if (container?.[1]) {
          const cls = container[2] ? `${container[1]}(${container[2]})` : container[1];
          return { cls, pending: null, out: acc.out };
        }
        const addr = /^\/\/ 0x([0-9a-f]+)$/.exec(line.trim());
        if (addr?.[1]) return { ...acc, pending: IMAGE_BASE + BigInt(`0x${addr[1]}`) };
        const method = OBJC_METHOD.exec(line.trim());
        if (method?.[1] && method[2] !== undefined && acc.pending !== null) {
          acc.out.push({ addr: acc.pending, name: `${method[1]}[${acc.cls} ${selector(method[2])}]`, source: "objc" });
          return { ...acc, pending: null };
        }
        return acc;
      },
      { cls: "?", pending: null, out: [] },
    ).out;

const PRIORITY: Readonly<Record<Source, number>> = { nm: 0, objc: 1, swift: 2 };

const merged = [...fromNm(), ...fromObjc(), ...fromSwift()]
  .filter((e) => e.addr >= IMAGE_BASE)
  .sort((a, b) => (a.addr === b.addr ? PRIORITY[a.source] - PRIORITY[b.source] : a.addr < b.addr ? -1 : 1))
  .filter((e, i, all) => i === 0 || all[i - 1]?.addr !== e.addr);

const tsv = merged.map((e) => `0x${e.addr.toString(16)}\t${e.source}\t${e.name}`).join("\n");
// ObjC names embed mangled Swift classes (_TtC3Arc23SidebarDragRegionWindow); swift-demangle rewrites them inline.
const demangled = Bun.spawnSync(["xcrun", "swift-demangle", "--simplified"], { stdin: Buffer.from(`${tsv}\n`) });
writeFileSync(join(root, "dump/symbol-map.tsv"), demangled.success ? demangled.stdout : `${tsv}\n`);

const counts = merged.reduce<Record<string, number>>((c, e) => ({ ...c, [e.source]: (c[e.source] ?? 0) + 1 }), {});
console.log(`wrote dump/symbol-map.tsv: ${merged.length} names`, counts);
