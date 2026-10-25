// The Arc 1.168.0 (88413) app that builds and checks start from: the installed Arc while it's still 1.168.0,
// otherwise the copy in bin/, unpacked once into build/source/ (the README's quick start does the same).
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const INSTALLED = "/Applications/Arc.app";
const UNPACKED = join(import.meta.dir, "../build/source/Arc.app");
const ARCHIVE = join(import.meta.dir, "../bin/Arc-1.168.0-88413.app.tar.xz");

export const isSupportedArc = (app: string): boolean => {
  const plist = join(app, "Contents/Info.plist");
  if (!existsSync(plist)) return false;
  const read = (key: string): string => Bun.spawnSync(["defaults", "read", plist, key]).stdout.toString().trim();
  return read("CFBundleShortVersionString") === "1.168.0" && read("CFBundleVersion") === "88413";
};

export const defaultArcSource = (): string => {
  if (isSupportedArc(INSTALLED)) return INSTALLED;
  if (isSupportedArc(UNPACKED)) return UNPACKED;
  if (!existsSync(ARCHIVE)) throw new Error(`Arc 1.168.0 not found: ${INSTALLED} isn't 1.168.0 and ${ARCHIVE} is missing`);
  mkdirSync(dirname(UNPACKED), { recursive: true });
  console.log(`Installed Arc isn't 1.168.0; unpacking bin/${ARCHIVE.split("/").pop()} into build/source/ (once)`);
  const tar = Bun.spawnSync(["tar", "-xJf", ARCHIVE, "-C", dirname(UNPACKED)], { stderr: "pipe" });
  if (!tar.success || !isSupportedArc(UNPACKED)) {
    throw new Error(`couldn't unpack ${ARCHIVE} (is it a Git LFS pointer? run: git lfs pull --include="bin/*"): ${tar.stderr.toString().trim()}`);
  }
  return UNPACKED;
};
