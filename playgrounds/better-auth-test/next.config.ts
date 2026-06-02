import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-auth", "better-sqlite3"],
};

export default nextConfig;
