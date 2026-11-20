import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// One env file for the whole repo (CLAUDE.md section 8): read `.env` at the repo root.
loadEnvConfig(path.resolve(process.cwd(), ".."));

const nextConfig: NextConfig = {
  turbopack: { resolveAlias: { fs: { browser: "./src/lib/empty.ts" } } },
};

export default nextConfig;
