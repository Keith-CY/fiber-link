import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { KNOWN_RPC_METHODS } from "./metrics";
import { buildRpcSchemaDocument, knownSchemaMethods } from "./rpc-schema";

const COMMITTED_PATH = resolve(__dirname, "../../../..", "docs/rpc-schema.json");

describe("rpc schema document", () => {
  it("matches the committed docs/rpc-schema.json (run `bun run schema:generate` after contract changes)", () => {
    const committed = JSON.parse(readFileSync(COMMITTED_PATH, "utf8"));
    expect(committed).toEqual(buildRpcSchemaDocument());
  });

  it("stays in parity with the bounded metrics method set", () => {
    expect(new Set(knownSchemaMethods())).toEqual(KNOWN_RPC_METHODS);
  });

  it("describes every method with params and result schemas", () => {
    const doc = buildRpcSchemaDocument();
    for (const [name, entry] of Object.entries(doc.methods)) {
      const method = entry as { description?: string; params?: unknown; result?: unknown };
      expect(method.description, name).toBeTruthy();
      expect(method.params, name).toBeTruthy();
      expect(method.result, name).toBeTruthy();
    }
  });

  it("contains no uninhabited { not: {} } alternatives", () => {
    // zod-to-json-schema artifacts from optional/effect wrappers; they match
    // nothing and break automated client generators, so the builder strips them.
    expect(JSON.stringify(buildRpcSchemaDocument())).not.toContain('{"not":{}}');
  });

  it("marks tip.get as an alias of tip.status", () => {
    const doc = buildRpcSchemaDocument();
    expect((doc.methods["tip.get"] as { aliasOf?: string }).aliasOf).toBe("tip.status");
  });
});
