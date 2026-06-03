"""
Milestone 3 — FastAPI JWT verifier POC

Tests that a JWT issued by Better Auth can be verified independently
by a Python process using the JWKS endpoint — no shared secret, no
callback to the session endpoint.

Setup:
    pip install requests PyJWT cryptography

Usage:
    python scripts/verify_jwt.py

Paste the JWT when prompted (get it from the "Get JWT" button in the browser UI).

Algorithm notes:
    Better Auth JWT plugin default is EdDSA/Ed25519.
    This playground configures RS256 explicitly (lib/auth.ts) for consistent
    Python support. If you change the algorithm, update EXPECTED_ALG below.
"""

import requests
import jwt as pyjwt
from jwt.algorithms import ECAlgorithm, RSAAlgorithm

JWKS_URL     = "http://localhost:3001/api/auth/jwks"
EXPECTED_ALG = "RS256"  # must match lib/auth.ts jwt() config

def fetch_jwks() -> dict:
    res = requests.get(JWKS_URL)
    res.raise_for_status()
    return res.json()

def get_public_key(jwks: dict, kid: str | None):
    keys = jwks.get("keys", [])
    if not keys:
        raise ValueError("No keys in JWKS response")

    for key in keys:
        if kid and key.get("kid") != kid:
            continue
        kty = key.get("kty")
        alg = key.get("alg", "")
        if kty == "RSA":
            return RSAAlgorithm.from_jwk(key)
        elif kty == "EC":
            return ECAlgorithm.from_jwk(key)
        elif kty == "OKP" or alg == "EdDSA":
            # EdDSA/Ed25519 — requires PyJWT >= 2.4 + cryptography
            try:
                from jwt.algorithms import OKPAlgorithm
                return OKPAlgorithm.from_jwk(key)
            except ImportError:
                raise ValueError(
                    "EdDSA key found but OKPAlgorithm not available. "
                    "Upgrade PyJWT (>=2.4) or set alg=RS256 in lib/auth.ts"
                )

    raise ValueError(f"No matching key for kid={kid}")

def verify(token: str) -> dict:
    header = pyjwt.get_unverified_header(token)
    kid    = header.get("kid")
    alg    = header.get("alg")

    if alg != EXPECTED_ALG:
        raise ValueError(
            f"Token uses {alg!r} but this verifier enforces {EXPECTED_ALG!r}. "
            f"Check lib/auth.ts jwt() config and clear the jwks table."
        )

    jwks       = fetch_jwks()
    public_key = get_public_key(jwks, kid)

    payload = pyjwt.decode(
        token,
        public_key,
        algorithms=[alg],
        options={"verify_aud": False},  # Better Auth JWT does not set aud by default
    )
    return payload

def run_test(label: str, token: str, expect_success: bool):
    print(f"\n--- {label} ---")
    try:
        payload = verify(token)
        if expect_success:
            print(f"✅ Valid JWT")
            print(f"   sub  : {payload.get('sub')}")
            print(f"   email: {payload.get('email')}")
            print(f"   name : {payload.get('name')}")
            print(f"   iss  : {payload.get('iss')}")
            print(f"   exp  : {payload.get('exp')}")
        else:
            print(f"⚠️  Unexpected success — {payload}")
    except Exception as e:
        if not expect_success:
            print(f"✅ Correctly rejected — {e}")
        else:
            print(f"❌ Verification failed — {e}")

if __name__ == "__main__":
    jwt_token = input("Paste JWT (from 'Get JWT' button): ").strip()
    run_test("Valid JWT", jwt_token, expect_success=True)

    opaque = input("\nPaste opaque session token (from 'Copy session token'): ").strip()
    run_test("Opaque session token (should fail)", opaque, expect_success=False)

    tampered = jwt_token[:-10] + "AAAAAAAAAA"
    run_test("Tampered JWT (should fail)", tampered, expect_success=False)
