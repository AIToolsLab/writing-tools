import { betterAuth } from "better-auth";
import Database from "better-sqlite3";
import path from "path";

export const auth = betterAuth({
  // SQLite file lives in db/ which is gitignored.
  // Better Auth creates the tables on first run (no separate migration step needed for SQLite).
  database: new Database(path.join(process.cwd(), "db/auth.db")),
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
  },
  // BETTER_AUTH_SECRET and BETTER_AUTH_URL are read from env automatically.
});
