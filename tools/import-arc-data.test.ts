import { expect, test } from "bun:test";
import { createCipheriv, pbkdf2Sync } from "node:crypto";
import { recrypter } from "./import-arc-data";

const encrypt = (password: string, plain: string): Buffer => {
  const cipher = createCipheriv("aes-128-cbc", pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1"), Buffer.alloc(16, 0x20));
  return Buffer.concat([Buffer.from("v10"), cipher.update(plain), cipher.final()]);
};

test("re-encrypts OSCrypt v10 values for the target key", () => {
  const value = recrypter("arc", "mock_password").recrypt(encrypt("arc", "session=secret"));
  expect(value).toEqual(encrypt("mock_password", "session=secret"));
});

test("leaves non-OSCrypt and foreign-key values alone", () => {
  const crypto = recrypter("arc", "mock_password");
  expect(crypto.recrypt(Buffer.from("v10 plain text"))).toBeUndefined();
  expect(crypto.recrypt(encrypt("other", "session=secret"))).toBeUndefined();
});
