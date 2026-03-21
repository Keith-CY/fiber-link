import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const pagesAppPath = resolve(currentDir, "../pages/_app.tsx");
const globalsCssPath = resolve(currentDir, "../styles/globals.css");

describe("admin style entrypoint", () => {
  it("loads global stylesheet through the Next app shell", () => {
    expect(existsSync(pagesAppPath)).toBe(true);
    expect(existsSync(globalsCssPath)).toBe(true);

    const appShellSource = readFileSync(pagesAppPath, "utf8");
    const globalsCssSource = readFileSync(globalsCssPath, "utf8");

    expect(appShellSource).toContain('import "../styles/globals.css";');
    expect(globalsCssSource).toContain(".dashboard-shell");
    expect(globalsCssSource).toContain(".hero-panel");
    expect(globalsCssSource).toContain('"Newsreader"');
    expect(globalsCssSource).toContain('"Manrope"');
    expect(globalsCssSource).toContain("#f9f9f9");
  });
});
