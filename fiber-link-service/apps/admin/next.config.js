const path = require("path");

/** @type {import("next").NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../../"),
  transpilePackages: ["@fiber-link/db"],
};

module.exports = nextConfig;
