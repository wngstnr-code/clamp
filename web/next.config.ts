import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// One env file for the whole repo (CLAUDE.md section 8): read `.env` at the repo root.
// forceReload: Next has already loaded (and cached) the env of `web/` itself, which would make this call a no-op.
loadEnvConfig(path.resolve(process.cwd(), ".."), process.env.NODE_ENV !== "production", undefined, true);

const nextConfig: NextConfig = {
  turbopack: { resolveAlias: { fs: { browser: "./src/lib/empty.ts" } } },
};

export default nextConfig;
