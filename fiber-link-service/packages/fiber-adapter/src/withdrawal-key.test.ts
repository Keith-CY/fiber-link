import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasWithdrawalPrivateKey, readWithdrawalPrivateKeyRaw } from "./withdrawal-key";

const KEY = "0x".padEnd(66, "a");

function keyFileWith(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "withdrawal-key-"));
  const filePath = join(dir, "key");
  writeFileSync(filePath, contents);
  return filePath;
}

describe("readWithdrawalPrivateKeyRaw", () => {
  it("returns the inline env value when set", () => {
    expect(readWithdrawalPrivateKeyRaw({ FIBER_WITHDRAWAL_CKB_PRIVATE_KEY: ` ${KEY} ` })).toBe(KEY);
  });

  it("reads and trims the key file when only the file variant is set", () => {
    const file = keyFileWith(`${KEY}\n`);
    expect(readWithdrawalPrivateKeyRaw({ FIBER_WITHDRAWAL_CKB_PRIVATE_KEY_FILE: file })).toBe(KEY);
  });

  it("prefers the inline value over the file", () => {
    const file = keyFileWith("0x".padEnd(66, "b"));
    expect(
      readWithdrawalPrivateKeyRaw({
        FIBER_WITHDRAWAL_CKB_PRIVATE_KEY: KEY,
        FIBER_WITHDRAWAL_CKB_PRIVATE_KEY_FILE: file,
      }),
    ).toBe(KEY);
  });

  it("returns null when neither source is set", () => {
    expect(readWithdrawalPrivateKeyRaw({})).toBeNull();
  });

  it("returns null for an empty key file", () => {
    const file = keyFileWith("\n");
    expect(readWithdrawalPrivateKeyRaw({ FIBER_WITHDRAWAL_CKB_PRIVATE_KEY_FILE: file })).toBeNull();
  });

  it("throws a descriptive error for an unreadable file without leaking contents", () => {
    expect(() =>
      readWithdrawalPrivateKeyRaw({ FIBER_WITHDRAWAL_CKB_PRIVATE_KEY_FILE: "/nonexistent/key" }),
    ).toThrow(/FIBER_WITHDRAWAL_CKB_PRIVATE_KEY_FILE/);
  });
});

describe("hasWithdrawalPrivateKey", () => {
  it("is true when the inline value is present", () => {
    expect(hasWithdrawalPrivateKey({ FIBER_WITHDRAWAL_CKB_PRIVATE_KEY: KEY })).toBe(true);
  });

  it("is true when the file variant is present", () => {
    const file = keyFileWith(KEY);
    expect(hasWithdrawalPrivateKey({ FIBER_WITHDRAWAL_CKB_PRIVATE_KEY_FILE: file })).toBe(true);
  });

  it("is false when nothing is configured", () => {
    expect(hasWithdrawalPrivateKey({})).toBe(false);
  });

  it("is false instead of throwing when the file is unreadable", () => {
    expect(hasWithdrawalPrivateKey({ FIBER_WITHDRAWAL_CKB_PRIVATE_KEY_FILE: "/nonexistent/key" })).toBe(false);
  });
});
