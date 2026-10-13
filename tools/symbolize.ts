// Map `sample` offsets (the 0xOFF in "load address … + 0xOFF") or Ghidra addresses to function names.
//   bun tools/symbolize.ts 0x15bd08c 0xdab024          # offsets relative to the load address
//   bun tools/symbolize.ts --addr 0x100dab1c4          # absolute Ghidra addresses (base 0x100000000)
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const IMAGE_BASE = 0x100000000n;

type Fn = { readonly start: bigint; readonly end: bigint; readonly name: string };

const parseFns = (text: string): readonly Fn[] =>
  text
    .split("\n")
    .filter(Boolean)
    .flatMap((line): Fn[] => {
      const [start, end, , name] = line.split("\t");
      return start && end && name ? [{ start: BigInt(start), end: BigInt(end), name }] : [];
    });

const parseSymbols = (text: string): ReadonlyMap<bigint, string> =>
  new Map(
    text
      .split("\n")
      .filter(Boolean)
      .flatMap((line): [bigint, string][] => {
        const [addr, , name] = line.split("\t");
        return addr && name ? [[BigInt(addr), name]] : [];
      }),
  );

const findFn = (fns: readonly Fn[], addr: bigint): Fn | undefined => {
  const go = (lo: number, hi: number): Fn | undefined => {
    if (lo > hi) return undefined;
    const mid = (lo + hi) >> 1;
    const fn = fns[mid];
    if (!fn) return undefined;
    if (addr < fn.start) return go(lo, mid - 1);
    if (addr >= fn.end) return go(mid + 1, hi);
    return fn;
  };
  return go(0, fns.length - 1);
};

const fns = parseFns(readFileSync(join(root, "ghidra/functions.tsv"), "utf8"));
const symbols = parseSymbols(readFileSync(join(root, "dump/symbol-map.tsv"), "utf8"));

const args = process.argv.slice(2);
const absolute = args.includes("--addr");
const inputs = args.filter((a) => a !== "--addr");

for (const input of inputs) {
  const raw = BigInt(input.startsWith("0x") ? input : `0x${input}`);
  const addr = absolute ? raw : IMAGE_BASE + raw;
  const fn = findFn(fns, addr);
  const shard = `ghidra/decomp/0x${(addr >> 20n).toString(16)}.c`;
  const line = fn
    ? `${fn.name} @0x${fn.start.toString(16)} +0x${(addr - fn.start).toString(16)} ${symbols.get(fn.start) ?? ""} (${shard})`
    : "no function";
  console.log(`${input} → 0x${addr.toString(16)}  ${line}`);
}
