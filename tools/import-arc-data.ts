// Import stock Arc's Chromium profile (logins, site storage, extensions, history,
// permissions) into an ArcMod session so sites stay signed in.
//   bun tools/import-arc-data.ts [--validation] [--staging-only] [--quit-arcmod] [--relaunch]
// --quit-arcmod asks ArcMod to quit after the checks pass and waits for you to quit Arc, instead of failing
// while either runs; --relaunch reopens ArcMod afterwards, even if the import failed.
// Arc encrypts secrets with its "Arc Safe Storage" Keychain password; ArcMod launches
// with --use-mock-keychain, so every OSCrypt v10 value is re-encrypted for the mock key.
// The source profile is only read. The previous mod profile is kept as a backup.
import { Database } from "bun:sqlite";
import { createCipheriv, createDecipheriv, pbkdf2Sync } from "node:crypto";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const v10 = Buffer.from("v10");
const iv = Buffer.alloc(16, 0x20);
const deriveKey = (password: string): Buffer => pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");

// Transient caches, tab sessions, and Google sync/push identities that belong to stock Arc.
const excluded = new Set([
  "LOCK", "LOG", "LOG.old", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache",
  "Sessions", "Session Storage", "Sync Data", "trusted_vault.pb", "passkey_enclave_state", "GCM Store",
]);

export interface Recrypter {
  readonly recrypt: (value: Uint8Array) => Buffer | undefined;
}

export const recrypter = (sourcePassword: string, targetPassword: string): Recrypter => {
  const sourceKey = deriveKey(sourcePassword);
  const targetKey = deriveKey(targetPassword);
  return {
    recrypt: (value) => {
      const body = Buffer.from(value);
      if (body.length < 19 || (body.length - 3) % 16 !== 0 || !body.subarray(0, 3).equals(v10)) return undefined;
      try {
        const decipher = createDecipheriv("aes-128-cbc", sourceKey, iv);
        const plain = Buffer.concat([decipher.update(body.subarray(3)), decipher.final()]);
        const cipher = createCipheriv("aes-128-cbc", targetKey, iv);
        return Buffer.concat([v10, cipher.update(plain), cipher.final()]);
      } catch {
        return undefined;
      }
    },
  };
};

const run = (command: string, args: readonly string[]): string => {
  const result = Bun.spawnSync([command, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`${command} failed: ${result.stderr.toString().trim()}`);
  return result.stdout.toString();
};

const isRunning = (pattern: string): boolean => Bun.spawnSync(["pgrep", "-f", pattern]).exitCode === 0;

const isSqlite = (path: string): boolean => {
  if (!statSync(path).isFile()) return false;
  const header = Buffer.alloc(16);
  const fd = openSync(path, "r");
  try {
    return readSync(fd, header, 0, 16, 0) === 16 && header.toString("latin1") === "SQLite format 3\0";
  } finally {
    closeSync(fd);
  }
};

const quote = (name: string): string => `"${name.replaceAll('"', '""')}"`;

const encryptedRows = (db: Database, table: string, column: string): { id: number; value: Uint8Array }[] => {
  try {
    return db.query(`select rowid as id, ${quote(column)} as value from ${quote(table)}
      where typeof(${quote(column)}) = 'blob' and substr(${quote(column)}, 1, 3) = x'763130'`).all() as { id: number; value: Uint8Array }[];
  } catch {
    return []; // WITHOUT ROWID tables do not hold OSCrypt values.
  }
};

// Re-encrypts every v10 BLOB in a database; returns counts keyed by table.column.
const recryptDatabase = (path: string, crypto: Recrypter): Map<string, { converted: number; failed: number }> => {
  const counts = new Map<string, { converted: number; failed: number }>();
  const db = new Database(path);
  try {
    const tables = db.query("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")
      .all() as { name: string }[];
    db.transaction(() => {
      for (const { name: table } of tables) {
        const columns = db.query(`pragma table_info(${quote(table)})`).all() as { name: string }[];
        for (const { name: column } of columns) {
          const rows = encryptedRows(db, table, column);
          if (rows.length === 0) continue;
          const update = db.query(`update ${quote(table)} set ${quote(column)} = ? where rowid = ?`);
          const tally = { converted: 0, failed: 0 };
          for (const row of rows) {
            const next = crypto.recrypt(row.value);
            if (next === undefined) tally.failed++;
            else {
              update.run(next, row.id);
              tally.converted++;
            }
          }
          counts.set(`${table}.${column}`, tally);
        }
      }
    })();
  } finally {
    db.close();
  }
  return counts;
};

// Preference files store OSCrypt values as base64 strings: password reuse hashes and
// the encrypted tracked-pref hashes Chromium checks before trusting Secure Preferences.
const recryptJson = (value: unknown, crypto: Recrypter): { readonly value: unknown; readonly converted: number } => {
  if (typeof value === "string" && value.startsWith("djEw")) {
    const next = crypto.recrypt(Buffer.from(value, "base64"));
    return next === undefined ? { value, converted: 0 } : { value: next.toString("base64"), converted: 1 };
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => recryptJson(item, crypto));
    return { value: items.map((item) => item.value), converted: items.reduce((sum, item) => sum + item.converted, 0) };
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).map(([key, item]) => [key, recryptJson(item, crypto)] as const);
    return {
      value: Object.fromEntries(entries.map(([key, item]) => [key, item.value])),
      converted: entries.reduce((sum, [, item]) => sum + item.converted, 0),
    };
  }
  return { value, converted: 0 };
};

const waitUntilClosed = async (pattern: string, message: string): Promise<void> => {
  if (!isRunning(pattern)) return;
  console.log(message);
  while (isRunning(pattern)) await Bun.sleep(500);
};

const sessionFor = (validation: boolean) => validation
  ? { appName: "ArcModValidation", bundleId: "company.thebrowser.Browser.mod.validation" } as const
  : { appName: "ArcMod", bundleId: "company.thebrowser.Browser.mod" } as const;

const main = async (args: readonly string[]): Promise<void> => {
  const flags = new Set(["--validation", "--staging-only", "--quit-arcmod", "--relaunch"]);
  const unknown = args.filter((arg) => !flags.has(arg));
  if (unknown.length > 0) throw new Error(`unrecognized argument: ${unknown.join(" ")}`);
  const session = sessionFor(args.includes("--validation"));
  const support = join(process.env.HOME ?? "", "Library/Application Support");
  const source = join(support, "Arc/User Data/Default");
  const targetRoot = join(support, session.appName, "User Data");
  const target = join(targetRoot, "Default");
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const staging = join(targetRoot, `Default.import-${stamp}`);

  if (!existsSync(source)) throw new Error(`missing Arc profile: ${source}`);
  if (!existsSync(targetRoot)) throw new Error(`launch ${session.appName} once before importing: ${targetRoot}`);
  const arc = "^/Applications/Arc[.]app/Contents/MacOS/Arc( |$)";
  const mod = `(^|/)${session.appName}[.]app/Contents/MacOS/Arc( |$)`;
  if (args.includes("--quit-arcmod")) {
    if (isRunning(mod)) Bun.spawnSync(["osascript", "-e", `tell application id "${session.bundleId}" to quit`]);
    await waitUntilClosed(mod, `Waiting for ${session.appName} to quit (confirm in ${session.appName} if it asks)…`);
    await waitUntilClosed(arc, "Quit Arc to continue: its profile has to be closed while it's copied.");
  }
  if (isRunning(arc)) throw new Error("quit Arc first so its profile is consistent");
  if (isRunning(mod)) throw new Error(`quit ${session.appName} first`);

  // Arc's Keychain password is only held in memory. Choose "Allow", not "Always Allow".
  const arcPassword = run("security", ["find-generic-password", "-w", "-s", "Arc Safe Storage", "-a", "Arc"]).trim();
  const crypto = recrypter(arcPassword, "mock_password");

  run("mkdir", ["-m", "700", staging]);
  const entries = readdirSync(source).filter((entry) => !excluded.has(entry));
  for (const entry of entries) run("cp", ["-cRp", join(source, entry), join(staging, entry)]);

  const failures = readdirSync(staging)
    .map((entry) => join(staging, entry))
    .filter((path) => !path.endsWith("-journal") && !path.endsWith("-wal") && isSqlite(path))
    .flatMap((path) => [...recryptDatabase(path, crypto)].map(([column, tally]) => {
      const name = `${path.slice(staging.length + 1)}: ${column}`;
      console.log(`${name} converted=${tally.converted}${tally.failed ? ` failed=${tally.failed}` : ""}`);
      return tally.failed > 0 ? name : undefined;
    }))
    .filter((name) => name !== undefined);

  for (const file of ["Preferences", "Secure Preferences"]) {
    const path = join(staging, file);
    const preferences = recryptJson(JSON.parse(readFileSync(path, "utf8")), crypto);
    if (preferences.converted > 0) writeFileSync(path, JSON.stringify(preferences.value));
    console.log(`${file}: converted=${preferences.converted}`);
  }
  if (failures.length > 0) console.warn(`values that did not decrypt were left unchanged: ${failures.join(", ")}`);

  if (args.includes("--staging-only")) {
    console.log(`staged ${staging}`);
    return;
  }
  const backup = join(targetRoot, `Default.pre-import-${stamp}`);
  if (existsSync(target)) renameSync(target, backup);
  renameSync(staging, target);
  console.log(`imported Arc profile into ${target}${existsSync(backup) ? `\nprevious profile kept at ${backup}` : ""}`);
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  try {
    await main(args);
  } catch (error) {
    console.error(`\nImport stopped: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    const validation = args.includes("--validation");
    if (args.includes("--relaunch") && !isRunning(`(^|/)${sessionFor(validation).appName}[.]app/Contents/MacOS/Arc( |$)`)) {
      Bun.spawnSync([join(import.meta.dir, "run-mod.sh"), ...(validation ? ["--validation"] : [])], { stdout: "inherit", stderr: "inherit" });
    }
  }
}
