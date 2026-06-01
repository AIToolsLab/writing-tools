"use client";

import { authClient } from "@/lib/auth-client";

// Milestone 1: sign in with Google, display name + email.
// No token polling, no Word/GDocs, no OpenAI — just proving Better Auth works.
export default function Home() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return <p style={{ padding: "2rem" }}>Loading...</p>;
  }

  if (!session) {
    return (
      <main style={{ padding: "2rem" }}>
        <h1>Better Auth POC</h1>
        <p>Google sign-in playground — writing-tools auth research.</p>
        <button
          onClick={() =>
            authClient.signIn.social({
              provider: "google",
              callbackURL: "/",
            })
          }
          style={{ padding: "0.5rem 1.25rem", cursor: "pointer", fontSize: "1rem" }}
        >
          Sign in with Google
        </button>
      </main>
    );
  }

  return (
    <main style={{ padding: "2rem" }}>
      <h2>Hi, I see you are {session.user.email}</h2>
      <p>Name: {session.user.name}</p>
      <hr />
      <p style={{ fontSize: "0.85rem", color: "#555" }}>
        Milestone 1 ✅ — session is working. Next: read the session token and
        test a protected endpoint with Authorization: Bearer.
      </p>
      <button
        onClick={() =>
          authClient.signOut({
            fetchOptions: { onSuccess: () => window.location.reload() },
          })
        }
        style={{ padding: "0.5rem 1.25rem", cursor: "pointer", marginTop: "1rem" }}
      >
        Sign out
      </button>
    </main>
  );
}
