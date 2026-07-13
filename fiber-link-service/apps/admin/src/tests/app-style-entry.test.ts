import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const pagesAppPath = resolve(currentDir, "../pages/_app.tsx");
const globalsCssPath = resolve(currentDir, "../styles/globals.css");
const postcssConfigPath = resolve(currentDir, "../../postcss.config.js");

describe("admin style entrypoint", () => {
  it("loads the global stylesheet through the Next app shell", () => {
    expect(existsSync(pagesAppPath)).toBe(true);
    expect(existsSync(globalsCssPath)).toBe(true);

    const appShellSource = readFileSync(pagesAppPath, "utf8");
    expect(appShellSource).toContain('import "../styles/globals.css";');
  });

  it("uses the Tailwind v4 CSS-first pipeline with the console theme tokens", () => {
    expect(existsSync(postcssConfigPath)).toBe(true);
    const postcssSource = readFileSync(postcssConfigPath, "utf8");
    expect(postcssSource).toContain("@tailwindcss/postcss");

    const globalsCssSource = readFileSync(globalsCssPath, "utf8");
    expect(globalsCssSource).toContain('@import "tailwindcss"');
    expect(globalsCssSource).toContain("--color-primary");
    expect(globalsCssSource).toContain('"Manrope"');
  });
});
