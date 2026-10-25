#!/usr/bin/env bun
// Downloads the Arc Engine release this ArcMod commit pins (resources/engine-release.json), checks its SHA-256
// and unpacks it into build/engines/<tag>/. `bun tools/build-mod.ts --engine release` uses it.
//   bun tools/fetch-engine.ts   → prints the ArcCore.framework path
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pinned from "../resources/engine-release.json";

type EngineRelease = { readonly tag: string; readonly chromium: string; readonly url: string; readonly sha256: string };

const root = join(import.meta.dir, "..");

export const engineRelease: EngineRelease = pinned;

export const fetchEngine = async (release: EngineRelease = engineRelease): Promise<string> => {
  if (!/^[0-9a-f]{64}$/.test(release.sha256)) throw new Error(`resources/engine-release.json has no valid sha256 for ${release.tag}`);
  const directory = join(root, "build/engines", release.tag);
  const framework = join(directory, "ArcCore.framework");
  const stamp = join(directory, "sha256");
  if (existsSync(framework) && existsSync(stamp) && readFileSync(stamp, "utf8").trim() === release.sha256) return framework;

  console.log(`Downloading Arc Engine ${release.tag} (Chromium ${release.chromium})…`);
  const response = await fetch(release.url);
  if (!response.ok || !response.body) throw new Error(`engine download failed: HTTP ${response.status} ${release.url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== release.sha256) throw new Error(`engine download has SHA-256 ${digest}, expected ${release.sha256}`);

  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  const archive = join(directory, "engine.zip");
  writeFileSync(archive, bytes);
  // ditto keeps the framework's Versions/Current symlinks, which unzip-style tools may not.
  const unpack = Bun.spawnSync(["ditto", "-x", "-k", archive, `${directory}/unpacked`], { stderr: "pipe" });
  if (!unpack.success) throw new Error(`couldn't unpack the engine: ${unpack.stderr.toString().trim()}`);
  renameSync(join(directory, "unpacked/ArcCore.framework"), framework);
  rmSync(join(directory, "unpacked"), { recursive: true, force: true });
  rmSync(archive);
  writeFileSync(stamp, `${release.sha256}\n`);
  return framework;
};

if (import.meta.main) console.log(await fetchEngine());
