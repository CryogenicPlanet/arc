import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MARKER, moveDataFolderToKeychain, recoverDataFolder } from "./keychain-profile";
import { deriveKey, recrypter, recryptJsonText, toKeychain, whichKey } from "./oscrypt";

const encrypt = (password: string, plain: string | Buffer): Buffer => {
  const cipher = createCipheriv("aes-128-cbc", pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1"), Buffer.alloc(16, 0x20));
  return Buffer.concat([Buffer.from("v10"), cipher.update(plain), cipher.final()]);
};
const hex = (value: Uint8Array): string => Buffer.from(value).toString("hex");

test("re-encrypts OSCrypt v10 values for the target key", () => {
  const value = recrypter("arc", "mock_password").recrypt(encrypt("arc", "session=secret"));
  expect(value).toEqual(encrypt("mock_password", "session=secret"));
});

test("leaves non-OSCrypt and foreign-key values alone", () => {
  const crypto = recrypter("arc", "mock_password");
  expect(crypto.recrypt(Buffer.from("v10 plain text"))).toBeUndefined();
  expect(crypto.recrypt(encrypt("other", "session=secret"))).toBeUndefined();
});

test("moves test-key values to the Keychain's key and leaves Keychain values alone", () => {
  const crypto = toKeychain("keychain");
  expect(crypto.recrypt(encrypt("mock_password", "session=secret"))).toEqual(encrypt("keychain", "session=secret"));
  expect(crypto.recrypt(encrypt("keychain", "session=secret"))).toBeUndefined();
});

test("tells the keys apart when both pass the padding check", () => {
  const testKey = deriveKey("mock_password");
  const keychainKey = deriveKey("keychain");
  const passesTestPadding = (value: Buffer): boolean => {
    try {
      const decipher = createDecipheriv("aes-128-cbc", testKey, Buffer.alloc(16, 0x20));
      decipher.update(value.subarray(3));
      decipher.final();
      return true;
    } catch {
      return false;
    }
  };
  // About 1 in 256 Keychain-key values also decrypt with valid padding under the test key, and vice versa.
  const keychainValues = Array.from({ length: 4000 }, (_, i) => encrypt("keychain", `session=${i}`));
  const ambiguous = keychainValues.filter(passesTestPadding);
  expect(ambiguous.length).toBeGreaterThan(0);
  expect(ambiguous.filter((value) => whichKey(value, testKey, keychainKey) !== "keychain")).toEqual([]);
  const testValues = Array.from({ length: 4000 }, (_, i) => encrypt("mock_password", `session=${i}`));
  expect(testValues.filter((value) => whichKey(value, testKey, keychainKey) !== "test")).toEqual([]);
  // Cookies (SHA-256 of the host, then the value; not text) are told apart by that prefix.
  const host = ".example.com";
  const cookie = (password: string, i: number) =>
    encrypt(password, Buffer.concat([createHash("sha256").update(host).digest(), Buffer.from(`v${i}`)]));
  const ambiguousTest = Array.from({ length: 4000 }, (_, i) => cookie("mock_password", i)).filter((value) => {
    try {
      const decipher = createDecipheriv("aes-128-cbc", keychainKey, Buffer.alloc(16, 0x20));
      decipher.update(value.subarray(3));
      decipher.final();
      return true;
    } catch {
      return false;
    }
  });
  expect(ambiguousTest.length).toBeGreaterThan(0);
  expect(ambiguousTest.filter((value) => whichKey(value, testKey, keychainKey, host) !== "test")).toEqual([]);
  const ambiguousKeychain = Array.from({ length: 4000 }, (_, i) => cookie("keychain", i)).filter(passesTestPadding);
  expect(ambiguousKeychain.length).toBeGreaterThan(0);
  expect(ambiguousKeychain.filter((value) => whichKey(value, testKey, keychainKey, host) !== "keychain")).toEqual([]);
});

test("replaces only the encrypted strings in a preferences file", () => {
  const text = `{"a":3.0,"hash":"${encrypt("mock_password", "pref").toString("base64")}","b":"djEwnotbase64"}`;
  const result = recryptJsonText(text, toKeychain("keychain"));
  expect(result.converted).toBe(1);
  expect(result.text).toBe(`{"a":3.0,"hash":"${encrypt("keychain", "pref").toString("base64")}","b":"djEwnotbase64"}`);
});

const makeDataFolder = (): { folder: string; profile: string } => {
  const folder = mkdtempSync(join(tmpdir(), "arcmod-keychain-"));
  const profile = join(folder, "User Data", "Default");
  mkdirSync(join(profile, "Network"), { recursive: true });
  writeFileSync(join(profile, "Preferences"), `{"hash":"${encrypt("mock_password", "pref").toString("base64")}"}`);
  const cookies = new Database(join(profile, "Network", "Cookies"));
  cookies.run("create table cookies(host_key text, name text, encrypted_value blob)");
  cookies.run("insert into cookies values ('a.com', 'test', ?), ('b.com', 'keychain', ?)", [encrypt("mock_password", "a"), encrypt("keychain", "b")]);
  cookies.close();
  // Chromium leaves a dangling lock link after a crash.
  symlinkSync("host-999999", join(folder, "User Data", "SingletonLock"));
  return { folder, profile };
};

const cookieValues = (profile: string): string[] => {
  const db = new Database(join(profile, "Network", "Cookies"), { readonly: true });
  const rows = db.query("select encrypted_value as value from cookies order by name").all() as { value: Uint8Array }[];
  db.close();
  return rows.map((row) => hex(row.value));
};

test("moves a data folder's profiles to the Keychain once, and deletes its backup", () => {
  const { folder, profile } = makeDataFolder();
  try {
    let reads = 0;
    const password = () => {
      reads++;
      return "keychain";
    };
    moveDataFolderToKeychain(folder, password);
    expect(cookieValues(profile)).toEqual([hex(encrypt("keychain", "b")), hex(encrypt("keychain", "a"))]);
    expect(readFileSync(join(profile, "Preferences"), "utf8")).toBe(`{"hash":"${encrypt("keychain", "pref").toString("base64")}"}`);
    expect(existsSync(join(folder, "User Data", MARKER))).toBe(true);
    expect(existsSync(join(folder, "User Data.keychain-backup"))).toBe(false);
    moveDataFolderToKeychain(folder, password);
    expect(reads).toBe(1);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("puts the data folder back when the move fails partway", () => {
  const { folder, profile } = makeDataFolder();
  try {
    const before = cookieValues(profile);
    // The databases are moved first; reading this "file" then fails.
    mkdirSync(join(profile, "Secure Preferences"));
    expect(() => moveDataFolderToKeychain(folder, () => "keychain")).toThrow();
    expect(cookieValues(profile)).toEqual(before);
    expect(existsSync(join(folder, "User Data", MARKER))).toBe(false);
    for (const suffix of [".keychain-backup", ".keychain-backup.partial", ".keychain-aside"]) {
      expect(existsSync(join(folder, `User Data${suffix}`))).toBe(false);
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("an interrupted move is put back before moving again", () => {
  const { folder, profile } = makeDataFolder();
  try {
    const before = cookieValues(profile);
    // As if a run cloned the folder, moved some values and was killed.
    cpSync(join(folder, "User Data"), join(folder, "User Data.keychain-backup"), { recursive: true, verbatimSymlinks: true });
    cpSync(join(folder, "User Data"), join(folder, "User Data.keychain-backup.partial"), { recursive: true, verbatimSymlinks: true });
    const db = new Database(join(profile, "Network", "Cookies"));
    db.run("update cookies set encrypted_value = ? where name = 'test'", [encrypt("keychain", "half-moved")]);
    db.close();
    recoverDataFolder(folder);
    expect(cookieValues(profile)).toEqual(before);
    expect(existsSync(join(folder, "User Data.keychain-backup"))).toBe(false);
    expect(existsSync(join(folder, "User Data.keychain-backup.partial"))).toBe(false);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("a backup left next to a finished move is deleted", () => {
  const { folder } = makeDataFolder();
  try {
    moveDataFolderToKeychain(folder, () => "keychain");
    cpSync(join(folder, "User Data"), join(folder, "User Data.keychain-backup"), { recursive: true, verbatimSymlinks: true });
    recoverDataFolder(folder);
    expect(existsSync(join(folder, "User Data.keychain-backup"))).toBe(false);
    expect(existsSync(join(folder, "User Data", MARKER))).toBe(true);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("a data folder that doesn't exist yet starts on the Keychain", () => {
  const folder = mkdtempSync(join(tmpdir(), "arcmod-keychain-"));
  try {
    moveDataFolderToKeychain(folder, () => {
      throw new Error("read the Keychain");
    });
    expect(existsSync(join(folder, "User Data", MARKER))).toBe(true);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("discarding deletes only the test-key values", () => {
  const { folder, profile } = makeDataFolder();
  try {
    moveDataFolderToKeychain(folder, "discard");
    expect(cookieValues(profile)).toEqual([hex(encrypt("keychain", "b"))]);
    expect(existsSync(join(folder, "User Data", MARKER))).toBe(true);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
