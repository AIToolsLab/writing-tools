import { betterAuth } from "better-auth";
import { bearer, jwt } from "better-auth/plugins";
import Database from "better-sqlite3";
import path from "path";

export const auth = betterAuth({
  // SQLite file lives in db/ which is gitignored.
  // Run `npx @better-auth/cli migrate` after adding or changing plugins.
  database: new Database(path.join(process.cwd(), "db/auth.db")),
  // Pass explicitly so Better Auth doesn't have to discover these from env.
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
  secret: process.env.BETTER_AUTH_SECRET,
  plugins: [
    bearer(),
    // RS256 chosen explicitly over the EdDSA default — better Python ecosystem
    // support (PyJWT + cryptography handles RSA cleanly; Ed25519 support in
    // Python JWT libraries is inconsistent across versions).
    jwt({ jwks: { keyPairConfig: { alg: "RS256" } } }),
  ],
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
  },
});
