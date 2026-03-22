const path = require("path");

/** @type {import("next").NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.resolve(__dirname, "../../../"),
  outputFileTracingIncludes: {
    "/": ["../../../deploy/compose/**/*", "../../../scripts/**/*"],
    "/api/backups/capture": ["../../../deploy/compose/**/*", "../../../scripts/**/*"],
    "/api/backups/restore-plan": ["../../../deploy/compose/**/*", "../../../scripts/**/*"],
    "/api/runtime-policies/rate-limit": ["../../../deploy/compose/**/*", "../../../scripts/**/*"],
  },
  transpilePackages: ["@fiber-link/db"],
};

module.exports = nextConfig;
