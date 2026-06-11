import { betterAuth } from "better-auth";
import { bearer, deviceAuthorization } from "better-auth/plugins";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Device-flow client identifier. This is the app's own ID for the device
// authorization grant — it is NOT the Google OAuth client ID.
export const DEVICE_CLIENT_ID = "writing-tools-word-poc";

export const auth = betterAuth({
  // Run `npx @better-auth/cli migrate` after adding or changing plugins.
  database: new Database(path.join(__dirname, "../db/auth.db")),
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
  secret: process.env.BETTER_AUTH_SECRET,
  plugins: [
    bearer(),
    deviceAuthorization({
      // Browser-facing approval page the user is sent to.
      verificationUri: "/device.html",
      // Device codes expire after 10 minutes if never approved.
      expiresIn: "10m",
      // Task pane must not poll faster than every 5 seconds.
      interval: "5s",
      // Only issue device codes for this app's known client ID.
      validateClient: (clientId) => clientId === DEVICE_CLIENT_ID,
      // Required by this plugin version's runtime options schema even though
      // the TS type marks it optional. Empty = use the default deviceCode table.
      schema: {},
    }),
  ],
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
  },
});
