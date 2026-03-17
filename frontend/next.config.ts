import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a standalone build folder so the Docker image only ships the minimum
  // files needed to run the server (no node_modules copy required).
  output: "standalone",
};

export default nextConfig;
