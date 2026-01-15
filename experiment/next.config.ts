import { execSync } from "node:child_process";
import type { NextConfig } from "next";

function resolveCommit(): string {
  if (process.env.NEXT_PUBLIC_GIT_COMMIT) {
    return process.env.NEXT_PUBLIC_GIT_COMMIT;
  }

  try {
    const commit = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    if (commit) return commit;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_) {
    // ignore
  }

  return "unknown";
}

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,

  // Enable standalone output for Docker deployment only
  ...(process.env.DOCKER_BUILD === 'true' && { output: 'standalone' }),

  // Inline the commit hash so it is available at runtime without writing .env.local
  env: {
    NEXT_PUBLIC_GIT_COMMIT: resolveCommit(),
  },
};

export default nextConfig;
