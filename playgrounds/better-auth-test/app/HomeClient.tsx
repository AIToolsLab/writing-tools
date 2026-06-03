"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function HomeClient() {
  const { data: session, isPending } = authClient.useSession();
  const [protectedResult, setProtectedResult] = useState<string | null>(null);
  const [jwt, setJwt] = useState<string | null>(null);

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
      <button
        onClick={() => {
          navigator.clipboard.writeText(session.session.token);
          alert("Token copied to clipboard");
        }}
        style={{ padding: "0.25rem 0.75rem", cursor: "pointer", fontSize: "0.8rem" }}
      >
        Copy session token
      </button>
      <hr />
      <p style={{ fontSize: "0.85rem", color: "#555" }}>
        Milestone 1 ✅ — session is working. Next: read the session token and
        test a protected endpoint with Authorization: Bearer.
      </p>
      <hr style={{ margin: "1.5rem 0" }} />
      <p style={{ fontWeight: "bold" }}>Milestone 2A — Cookie session check</p>
      <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
        <button
          onClick={async () => {
            const res = await fetch("/api/protected");
            const data = await res.json();
            setProtectedResult(`${res.status}: ${JSON.stringify(data)}`);
          }}
          style={{ padding: "0.5rem 1.25rem", cursor: "pointer" }}
        >
          Call /api/protected (with cookie)
        </button>
        <button
          onClick={async () => {
            const res = await fetch("/api/protected", { credentials: "omit" });
            const data = await res.json();
            setProtectedResult(`${res.status}: ${JSON.stringify(data)}`);
          }}
          style={{ padding: "0.5rem 1.25rem", cursor: "pointer" }}
        >
          Call /api/protected (no cookie)
        </button>
      </div>
      {protectedResult && (
        <pre style={{ marginTop: "0.75rem", background: "#f4f4f4", padding: "0.75rem", borderRadius: "4px" }}>
          {protectedResult}
        </pre>
      )}

      <hr style={{ margin: "1.5rem 0" }} />
      <p style={{ fontWeight: "bold" }}>Milestone 3 — JWT (for FastAPI)</p>
      <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
        <button
          onClick={async () => {
            const res = await fetch("/api/auth/token");
            const data = await res.json();
            setJwt(data.token ?? null);
          }}
          style={{ padding: "0.5rem 1.25rem", cursor: "pointer" }}
        >
          Get JWT from Better Auth
        </button>
        {jwt && (
          <button
            onClick={() => {
              navigator.clipboard.writeText(jwt);
              alert("JWT copied to clipboard");
            }}
            style={{ padding: "0.5rem 1.25rem", cursor: "pointer" }}
          >
            Copy JWT
          </button>
        )}
      </div>
      {jwt && (
        <pre style={{ marginTop: "0.75rem", background: "#f4f4f4", padding: "0.75rem", borderRadius: "4px", wordBreak: "break-all", whiteSpace: "pre-wrap", fontSize: "0.7rem" }}>
          {jwt}
        </pre>
      )}

      <hr style={{ margin: "1.5rem 0" }} />
      <p style={{ fontWeight: "bold" }}>Milestone 2B — Bearer token check</p>
      <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
        <button
          onClick={async () => {
            const token = session.session.token;
            const res = await fetch("/api/protected", {
              credentials: "omit",
              headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            setProtectedResult(`${res.status}: ${JSON.stringify(data)}`);
          }}
          style={{ padding: "0.5rem 1.25rem", cursor: "pointer" }}
        >
          Call /api/protected (Bearer token)
        </button>
      </div>

      <hr style={{ margin: "1.5rem 0" }} />
      <button
        onClick={() =>
          authClient.signOut({
            fetchOptions: { onSuccess: () => window.location.reload() },
          })
        }
        style={{ padding: "0.5rem 1.25rem", cursor: "pointer" }}
      >
        Sign out
      </button>
    </main>
  );
}
