import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRpcSchemaDocument } from "../rpc-schema";

// Repo layout: apps/rpc/src/scripts -> repo root is five levels up.
const scriptDir = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(scriptDir, "../../../../..", "docs/rpc-schema.json");

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(buildRpcSchemaDocument(), null, 2)}\n`);
console.log(`wrote ${outPath}`);
