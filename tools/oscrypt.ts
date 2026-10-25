// Chromium's macOS encryption for cookies, passwords and other secrets ("OSCrypt" v10 values): AES-128-CBC
// with a key derived from a password. Arc and the everyday ArcMod keep that password in the Keychain item
// "Arc Safe Storage"; test and agent builds run with --use-mock-keychain, whose password is the fixed
// "mock_password" from Chromium's source.
import { Database } from "bun:sqlite";
import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { closeSync, lstatSync, openSync, readSync } from "node:fs";

export const TEST_KEY_PASSWORD = "mock_password";

const v10 = Buffer.from("v10");
const iv = Buffer.alloc(16, 0x20);
export const deriveKey = (password: string): Buffer => pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");

const decrypt = (key: Buffer, body: Buffer): Buffer | undefined => {
  if (body.length < 19 || (body.length - 3) % 16 !== 0 || !body.subarray(0, 3).equals(v10)) return undefined;
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, iv);
    return Buffer.concat([decipher.update(body.subarray(3)), decipher.final()]);
  } catch {
    return undefined;
  }
};

const encrypt = (key: Buffer, plain: Buffer): Buffer => {
  const cipher = createCipheriv("aes-128-cbc", key, iv);
  return Buffer.concat([v10, cipher.update(plain), cipher.final()]);
};

const utf8 = new TextDecoder("utf-8", { fatal: true });
// Whether a decryption looks like the real thing: a cookie starts with the SHA-256 of its host (Chromium's
// cookie store since version 24), anything else is text. A wrong key that passes the padding check gives
// random bytes, which almost never pass this.
const plausible = (plain: Buffer, hostKey: string | undefined): boolean => {
  if (hostKey !== undefined && plain.length >= 32 && plain.subarray(0, 32).equals(createHash("sha256").update(hostKey).digest())) return true;
  try {
    utf8.decode(plain);
    return true;
  } catch {
    return false;
  }
};

export type KeyChoice = "test" | "keychain" | "neither";

// Which key a value is under. A wrong key passes the padding check about once in 256 tries; when both keys
// pass, the plausible decryption wins, and the test key wins a tie, since everything the everyday ArcMod saved
// before 2026-10-25 used it.
export const whichKey = (value: Uint8Array, testKey: Buffer, keychainKey: Buffer | undefined, hostKey?: string): KeyChoice => {
  const body = Buffer.from(value);
  const test = decrypt(testKey, body);
  const keychain = keychainKey === undefined ? undefined : decrypt(keychainKey, body);
  if (test === undefined) return keychain === undefined ? "neither" : "keychain";
  if (keychain === undefined) return keychainKey === undefined && !plausible(test, hostKey) ? "neither" : "test";
  return plausible(keychain, hostKey) && !plausible(test, hostKey) ? "keychain" : "test";
};

export interface Recrypter {
  // The value encrypted for the target key, or undefined to leave it unchanged.
  readonly recrypt: (value: Uint8Array, hostKey?: string) => Buffer | undefined;
}

export const recrypter = (sourcePassword: string, targetPassword: string): Recrypter => {
  const sourceKey = deriveKey(sourcePassword);
  const targetKey = deriveKey(targetPassword);
  return {
    recrypt: (value) => {
      const plain = decrypt(sourceKey, Buffer.from(value));
      return plain === undefined ? undefined : encrypt(targetKey, plain);
    },
  };
};

// Moves values from the test key to the Keychain's key; values already under the Keychain's key stay.
export const toKeychain = (keychainPassword: string): Recrypter => {
  const testKey = deriveKey(TEST_KEY_PASSWORD);
  const keychainKey = deriveKey(keychainPassword);
  return {
    recrypt: (value, hostKey) => {
      if (whichKey(value, testKey, keychainKey, hostKey) !== "test") return undefined;
      const plain = decrypt(testKey, Buffer.from(value));
      return plain === undefined ? undefined : encrypt(keychainKey, plain);
    },
  };
};

// A regular file (not a symlink: Chromium leaves dangling Singleton* links after a crash) that is a database.
export const isSqlite = (path: string): boolean => {
  if (!lstatSync(path).isFile()) return false;
  const header = Buffer.alloc(16);
  const fd = openSync(path, "r");
  try {
    return readSync(fd, header, 0, 16, 0) === 16 && header.toString("latin1") === "SQLite format 3\0";
  } finally {
    closeSync(fd);
  }
};

const quote = (name: string): string => `"${name.replaceAll('"', '""')}"`;

type Row = { id: number; value: Uint8Array; host?: string };

const encryptedRows = (db: Database, table: string, column: string, withHost: boolean): Row[] => {
  try {
    const host = withHost ? ", host_key as host" : "";
    return db.query(`select rowid as id, ${quote(column)} as value${host} from ${quote(table)}
      where typeof(${quote(column)}) = 'blob' and substr(${quote(column)}, 1, 3) = x'763130'`).all() as Row[];
  } catch {
    return []; // WITHOUT ROWID tables do not hold OSCrypt values.
  }
};

const eachEncryptedColumn = (db: Database, visit: (table: string, column: string, rows: Row[]) => void): void => {
  const tables = db.query("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")
    .all() as { name: string }[];
  for (const { name: table } of tables) {
    const columns = (db.query(`pragma table_info(${quote(table)})`).all() as { name: string }[]).map((column) => column.name);
    const withHost = columns.includes("host_key");
    for (const column of columns) {
      const rows = encryptedRows(db, table, column, withHost);
      if (rows.length > 0) visit(table, column, rows);
    }
  }
};

// Re-encrypts every v10 BLOB in a database in one transaction; returns counts keyed by table.column.
// "unchanged" counts values the recrypter left alone.
export const recryptDatabase = (path: string, crypto: Recrypter): Map<string, { converted: number; unchanged: number }> => {
  const counts = new Map<string, { converted: number; unchanged: number }>();
  const db = new Database(path);
  try {
    db.transaction(() => {
      eachEncryptedColumn(db, (table, column, rows) => {
        const update = db.query(`update ${quote(table)} set ${quote(column)} = ? where rowid = ?`);
        const tally = { converted: 0, unchanged: 0 };
        for (const row of rows) {
          const next = crypto.recrypt(row.value, row.host);
          if (next === undefined) tally.unchanged++;
          else {
            update.run(next, row.id);
            tally.converted++;
          }
        }
        counts.set(`${table}.${column}`, tally);
      });
    })();
  } finally {
    db.close();
  }
  return counts;
};

// Deletes every row holding a value under the test key; returns how many.
export const deleteTestKeyRows = (path: string): number => {
  const testKey = deriveKey(TEST_KEY_PASSWORD);
  const db = new Database(path);
  let deleted = 0;
  try {
    db.transaction(() => {
      eachEncryptedColumn(db, (table, _column, rows) => {
        const remove = db.query(`delete from ${quote(table)} where rowid = ?`);
        for (const row of rows) {
          if (whichKey(row.value, testKey, undefined, row.host) !== "test") continue;
          remove.run(row.id);
          deleted++;
        }
      });
    })();
  } finally {
    db.close();
  }
  return deleted;
};

// Preference files store OSCrypt values as base64 strings ("djEw…" is base64 for "v10"): password reuse
// hashes and the encrypted tracked-pref hashes Chromium checks before trusting Secure Preferences. They're
// replaced in the text itself, so nothing else in the file changes.
export const recryptJsonText = (text: string, crypto: Recrypter): { readonly text: string; readonly converted: number } => {
  let converted = 0;
  const next = text.replaceAll(/"(djEw[A-Za-z0-9+/]*={0,2})"/g, (match, value: string) => {
    const recrypted = crypto.recrypt(Buffer.from(value, "base64"));
    if (recrypted === undefined) return match;
    converted++;
    return `"${recrypted.toString("base64")}"`;
  });
  return { text: next, converted };
};
