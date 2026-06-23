const path = require("path");

/** @type {import("next").NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.resolve(__dirname, "../../../"),
  // Backup capture/restore-plan and rate-limit reads shell out to repo-level
  // scripts; they now run through the tRPC handler instead of bespoke API
  // routes, so trace the compose + scripts trees for that handler.
  outputFileTracingIncludes: {
    "/": ["../../../deploy/compose/**/*", "../../../scripts/**/*"],
    "/api/trpc/[trpc]": ["../../../deploy/compose/**/*", "../../../scripts/**/*"],
  },
  transpilePackages: ["@fiber-link/db"],
};

module.exports = nextConfig;
