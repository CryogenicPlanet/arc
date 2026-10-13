#!/usr/bin/env bun
// Samples the running Arc browser process and ranks where the Swift layer spends time.
//
//   bun tools/profile-arc.ts [seconds=10] [--app stock|mod|validation] [--pid N] [--quiet]
//     --delay N: N-second countdown (switch to Arc), with a sound at start and stop
//   bun tools/profile-arc.ts --file profiles/x.sample.txt    # re-analyze a saved sample
//
// Arc frames are stripped (`??? (in Arc) load address … + 0xOFF`); they are mapped to
// functions via ghidra/functions.tsv (Ghidra bounds, preferred) or dump/symbol-map.tsv.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const IMAGE_BASE = 0x1_0000_0000n;
const root = join(import.meta.dir, "..");

type Fn = { readonly start: bigint; readonly end: bigint | null; readonly name: string };
type Frame = { readonly depth: number; readonly count: number; readonly key: string; readonly arc: boolean };
type Tally = Map<string, number>;

const parseArgs = (argv: readonly string[]) => {
  const values = ["--app", "--pid", "--file", "--delay"];
  const toggles = ["--quiet", "--all-threads"];
  const positional = argv.filter((a, i) => !values.includes(argv[i - 1] ?? "") && !values.includes(a) && !toggles.includes(a));
  if (positional.length > 1 || positional.some((a) => !/^\d+$/.test(a))) throw new Error("expected one integer duration and supported options only");
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const delay = Number(flag("--delay") ?? 0);
  const secs = Number(positional[0] ?? 10);
  const app = flag("--app") ?? "stock", pid = flag("--pid");
  if (!["stock", "mod", "validation"].includes(app)) throw new Error("--app must be stock, mod or validation");
  if (!Number.isInteger(secs) || secs < 1 || secs > 120 || !Number.isInteger(delay) || delay < 0 || delay > 60)
    throw new Error("seconds must be 1–120 and delay 0–60");
  if (pid !== undefined && !/^[1-9]\d*$/.test(pid)) throw new Error("--pid must be a positive integer");
  for (const key of ["--app", "--pid", "--file", "--delay"]) if (argv.includes(key) && (!flag(key) || flag(key)?.startsWith("--"))) throw new Error(`${key} needs a value`);
  return { file: flag("--file"), secs, delay, app, explicitApp: argv.includes("--app"), pid, quiet: argv.includes("--quiet"), allThreads: argv.includes("--all-threads") };
};

const loadFunctions = (): readonly Fn[] => {
  const ghidra = join(root, "ghidra/functions.tsv");
  const lines = (p: string) => readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => l.split("\t"));
  const fns: Fn[] = existsSync(ghidra)
    ? lines(ghidra).map(([s, e, , n]) => ({ start: BigInt(s ?? "0"), end: BigInt(e ?? "0"), name: n ?? "?" }))
    : lines(join(root, "dump/symbol-map.tsv")).map(([s, , n]) => ({ start: BigInt(s ?? "0"), end: null, name: n ?? "?" }));
  return fns.toSorted((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
};

// Greatest function start <= addr; with Ghidra bounds also require addr < end.
const lookup = (fns: readonly Fn[], addr: bigint): string => {
  const search = (lo: number, hi: number): number => {
    if (lo > hi) return hi;
    const mid = (lo + hi) >> 1;
    return (fns[mid]?.start ?? 0n) <= addr ? search(mid + 1, hi) : search(lo, mid - 1);
  };
  const fn = fns[search(0, fns.length - 1)];
  if (!fn || (fn.end !== null && addr >= fn.end)) return `Arc!0x${addr.toString(16)}`;
  const off = addr - fn.start;
  return fn.end === null && off > 0x4000n ? `Arc!0x${addr.toString(16)} (near ${fn.name})` : fn.name;
};

const FRAME = /^([ +!:|]*?)(\d+) (.*)$/;
const ARC = /\?\?\?\s+\(in Arc\)\s+load address 0x[0-9a-f]+ \+ 0x([0-9a-f]+)/;
const LIB = /^(.*?)\s+\(in ([^)]+)\)/;

const parseFrames = (text: string, fns: readonly Fn[]): readonly Frame[] => {
  const graph = text.split("\n");
  const start = graph.findIndex((l) => l.startsWith("Call graph:"));
  const end = graph.findIndex((l, i) => i > start && l.startsWith("Total number in stack"));
  return graph.slice(start + 1, end < 0 ? undefined : end).flatMap((line): Frame[] => {
    const m = FRAME.exec(line.replace(/^ {4}/, ""));
    if (!m?.[3] || m[1] === undefined) return [];
    const depth = m[1].length / 2;
    const rest = m[3];
    const arc = ARC.exec(rest);
    if (arc?.[1]) return [{ depth, count: Number(m[2]), key: lookup(fns, IMAGE_BASE + BigInt(`0x${arc[1]}`)), arc: true }];
    const lib = LIB.exec(rest);
    const image = lib?.[2] ?? "";
    // ArcCore (Chromium) is stripped too; collapse it instead of printing ChromeMain+offset noise.
    const key = image === "ArcCore" ? "[ArcCore/Chromium]" : lib ? `${lib[1]} (${image})` : rest;
    return [{ depth, count: Number(m[2]), key, arc: false }];
  });
};

type Report = { readonly self: Tally; readonly inclusive: Tally; readonly modules: Tally; readonly total: number };

const bump = (t: Tally, k: string, n: number): void => void t.set(k, (t.get(k) ?? 0) + n);
const moduleOf = (name: string): string => /^[-+]\[([^\s\]]+)/.exec(name)?.[1] ?? name.split(".")[0] ?? name;

// childSum[i] = total samples of frame i's direct children, in one pass with a depth-indexed stack.
const childSums = (frames: readonly Frame[]): readonly number[] =>
  frames.reduce(
    (acc, f, i) => {
      const parent = f.depth > 0 ? acc.open[f.depth - 1] : undefined;
      if (parent !== undefined) acc.sums[parent] = (acc.sums[parent] ?? 0) + f.count;
      acc.open[f.depth] = i;
      acc.open.length = f.depth + 1;
      return acc;
    },
    { sums: frames.map(() => 0), open: [] as number[] },
  ).sums;

const analyze = (frames: readonly Frame[], threadFilter: (name: string) => boolean): Report => {
  const self: Tally = new Map(), inclusive: Tally = new Map(), modules: Tally = new Map();
  const sums = childSums(frames);
  const state = frames.reduce(
    (acc, f, i) => {
      if (f.depth === 0) return { stack: [] as Frame[], keep: threadFilter(f.key), total: acc.total + (threadFilter(f.key) ? f.count : 0) };
      if (!acc.keep) return acc;
      const stack = [...acc.stack.slice(0, f.depth - 1), f];
      const selfCount = f.count - (sums[i] ?? 0);
      const ancestors = new Set(stack.slice(0, -1).map((s) => s.key));
      if (f.arc && !ancestors.has(f.key)) bump(inclusive, f.key, f.count);
      const arcAncestors = new Set(stack.slice(0, -1).filter((s) => s.arc).map((s) => moduleOf(s.key)));
      if (f.arc && !arcAncestors.has(moduleOf(f.key))) bump(modules, moduleOf(f.key), f.count);
      if (selfCount > 0) {
        // Attribute self time in system/Chromium code to the nearest Arc caller as well.
        const owner = [...stack].reverse().find((s) => s.arc);
        bump(self, f.arc ? f.key : `${f.key}  ← ${owner?.key ?? "(no Arc frame)"}`, selfCount);
      }
      return { ...acc, stack };
    },
    { stack: [] as Frame[], keep: false, total: 0 },
  );
  return { self, inclusive, modules, total: state.total };
};

const IDLE = /mach_msg2_trap|__psynch_cvwait|kevent|__workq_kernreturn|__semwait_signal|__select|poll \(libsystem/;

const print = (title: string, t: Tally, total: number, n: number, skip: (k: string) => boolean = () => false) => {
  console.log(`\n## ${title}`);
  [...t.entries()]
    .filter(([k]) => !skip(k))
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, n)
    .forEach(([k, v]) => console.log(`${String(v).padStart(7)}  ${((100 * v) / Math.max(total, 1)).toFixed(1).padStart(5)}%  ${k}`));
};

const chime = (sound: string): void => void Bun.spawn(["afplay", `/System/Library/Sounds/${sound}.aiff`]);

const capture = async ({secs, delay, app, explicitApp, pid: explicitPid, quiet}: ReturnType<typeof parseArgs>): Promise<string> => {
  const requestedBundle = app === "mod" ? "ArcMod" : app === "validation" ? "ArcModValidation" : "Arc";
  const candidates = explicitPid ? [explicitPid] : Bun.spawnSync(["pgrep", "-f", `(^|/)${requestedBundle}[.]app/Contents/MacOS/Arc( |$)`]).stdout.toString().trim().split("\n").filter(Boolean);
  if (candidates.length !== 1) throw new Error(`${requestedBundle}: found ${candidates.length} browser processes; choose --pid explicitly`);
  const pid = candidates[0]!;
  const command = Bun.spawnSync(["ps", "-p", pid, "-o", "command="]).stdout.toString().trim();
  const bundle = /(?:^|\/)(Arc(?:Mod(?:Validation)?)?)[.]app\/Contents\/MacOS\/Arc(?: |$)/.exec(command)?.[1];
  if (!bundle) throw new Error(`pid ${pid} is not an Arc browser process`);
  if (explicitApp && bundle !== requestedBundle) throw new Error(`pid ${pid} is ${bundle}, not requested ${requestedBundle}`);
  mkdirSync(join(root, "profiles"), { recursive: true });
  const out = join(root, "profiles", `${bundle}-${pid}-${new Date().toISOString().replace(/[:.]/g, "-")}.sample.txt`);
  for (const left of Array.from({ length: delay }, (_, i) => delay - i)) {
    console.error(`switch to ${bundle} — sampling starts in ${left}s`);
    await Bun.sleep(1000);
  }
  if (!quiet) chime("Tink");
  console.error(`sampling pid ${pid} for ${secs}s → ${out}`);
  const r = Bun.spawnSync(["sample", pid, String(secs), "-mayDie", "-file", out], { stderr: "inherit" });
  if (!quiet) chime("Glass");
  if (!r.success) throw new Error("sample failed");
  return out;
};

const args = parseArgs(Bun.argv.slice(2));
const { file, allThreads } = args;
const path = file ?? (await capture(args));
const fns = loadFunctions();
const report = analyze(parseFrames(readFileSync(path, "utf8"), fns), (t) => allThreads || /CrBrowserMain|com\.apple\.main-thread/.test(t));

const busy = [...report.self.entries()].filter(([k]) => !IDLE.test(k)).reduce((s, [, v]) => s + v, 0);
const busyPct = (100 * busy) / Math.max(report.total, 1);
console.log(`# Arc profile: ${path}\n${report.total} samples (${allThreads ? "all threads" : "main thread"}), names from ${existsSync(join(root, "ghidra/functions.tsv")) ? "Ghidra" : "symbol-map only"}`);
console.log(`non-wait sample share: ${busy} samples (${busyPct.toFixed(1)}%); this is not CPU utilization or UI latency${busyPct < 2 ? "  ⚠ mostly waiting; use an interaction workload to find UI costs" : ""}`);
print("Hot self time (non-idle) with owning Arc function", report.self, report.total, 30, (k) => IDLE.test(k));
print("Arc functions, inclusive", report.inclusive, report.total, 30);
print("Arc modules/classes, inclusive", report.modules, report.total, 20);
