import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every migration file must be idempotent (safe to apply twice).
 *
 * The visual-acceptance e2e harness (scripts/e2e-invoice-payment-accounting.sh)
 * replays every drizzle/*.sql file with `psql -v ON_ERROR_STOP=1` on top of a
 * database the compose `migrate` service has already migrated, so a bare
 * `CREATE TABLE` / `ADD COLUMN` / `ADD CONSTRAINT` / `CREATE TYPE` aborts the
 * whole run with a duplicate-object error. The repo convention is:
 *
 * - `CREATE TABLE IF NOT EXISTS` / `CREATE [UNIQUE] INDEX IF NOT EXISTS`
 * - `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
 * - `CREATE TYPE` and `ADD CONSTRAINT` wrapped in
 *   `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN null; END $$;`
 * - data statements (DELETE/UPDATE/INSERT) written to be re-runnable
 *
 * This test guards the DDL rules; see packages/db/README.md for the full
 * convention.
 */

const MIGRATIONS_DIR = resolve(__dirname, "..", "drizzle");

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/** Remove DO $$ ... $$ blocks — statements inside them are exception-guarded. */
function stripGuardedBlocks(sql: string): string {
  return sql.replace(/DO\s+\$\$[\s\S]*?\$\$\s*;?/gi, "");
}

/** Remove line and block comments so commented-out DDL doesn't trip the checks. */
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("migration idempotency (drizzle/*.sql replay safety)", () => {
  const files = migrationFiles();

  it("finds at least the baseline migration", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files[0]).toMatch(/^0000_/);
  });

  for (const file of files) {
    describe(file, () => {
      const raw = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      // Comments first, then guards: a comment containing `$$` must not
      // corrupt the guarded-block stripping.
      const unguarded = stripGuardedBlocks(stripComments(raw));

      it("uses CREATE TABLE IF NOT EXISTS", () => {
        expect(unguarded).not.toMatch(/CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i);
      });

      it("uses CREATE [UNIQUE] INDEX [CONCURRENTLY] IF NOT EXISTS", () => {
        // The optional CONCURRENTLY lives inside the lookahead: an optional
        // group *before* a negative lookahead can backtrack and false-flag
        // the compliant `CONCURRENTLY IF NOT EXISTS` form.
        expect(unguarded).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX\s+(?!(CONCURRENTLY\s+)?IF\s+NOT\s+EXISTS)/i);
      });

      it("uses ADD [COLUMN] IF NOT EXISTS", () => {
        // Postgres allows omitting the COLUMN keyword, so catch both forms.
        // Two alternations (instead of one optional group) avoid lookahead
        // backtracking false-positives on `ADD COLUMN IF NOT EXISTS`.
        expect(unguarded).not.toMatch(/\bADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)/i);
        expect(unguarded).not.toMatch(/\bADD\s+(?!COLUMN\b|CONSTRAINT\b|IF\s+NOT\s+EXISTS)/i);
      });

      it("wraps CREATE TYPE in a duplicate_object guard", () => {
        expect(unguarded).not.toMatch(/CREATE\s+TYPE/i);
      });

      it("wraps ADD CONSTRAINT in a duplicate_object guard", () => {
        expect(unguarded).not.toMatch(/ADD\s+CONSTRAINT/i);
      });

      it("guarded blocks swallow duplicate_object", () => {
        const guards = raw.match(/DO\s+\$\$[\s\S]*?\$\$\s*;?/gi) ?? [];
        for (const guard of guards) {
          expect(guard).toMatch(/EXCEPTION[\s\S]*WHEN\s+duplicate_object\s+THEN/i);
        }
      });
    });
  }
});
