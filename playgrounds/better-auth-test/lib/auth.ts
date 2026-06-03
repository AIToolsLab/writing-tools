import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import Database from "better-sqlite3";
import path from "path";

export const auth = betterAuth({
  // SQLite file lives in db/ which is gitignored.
  // Better Auth creates the tables on first run (no separate migration step needed for SQLite).
  database: new Database(path.join(process.cwd(), "db/auth.db")),
  // Pass explicitly so Better Auth doesn't have to discover these from env.
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
  secret: process.env.BETTER_AUTH_SECRET,
  plugins: [bearer()],
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
  },
});
