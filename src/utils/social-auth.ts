import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { env } from "../config/env.js";
import { Errors } from "./errors.js";

export interface SocialAuthPayload {
  provider: "google" | "apple";
  providerId: string;
  email: string;
  name?: string;
  surname?: string;
}

// ─── Google ───

const googleClient = new OAuth2Client();

export async function verifyGoogleToken(idToken: string): Promise<SocialAuthPayload> {
  const audiences = [
    env.GOOGLE_CLIENT_ID_WEB,
    env.GOOGLE_CLIENT_ID_IOS,
    env.GOOGLE_CLIENT_ID_ANDROID,
  ].filter(Boolean);

  if (audiences.length === 0) {
    console.error("[social-auth] No Google client IDs configured");
    throw Errors.SERVER_ERROR();
  }

  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: audiences,
  });

  const payload = ticket.getPayload();
  if (!payload || !payload.sub || !payload.email) {
    throw Errors.INVALID_TOKEN();
  }

  // iat freshness check — reject tokens older than 5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (payload.iat && now - payload.iat > 300) {
    throw Errors.INVALID_TOKEN();
  }

  return {
    provider: "google",
    providerId: payload.sub,
    email: payload.email,
    name: payload.given_name ?? undefined,
    surname: payload.family_name ?? undefined,
  };
}

// ─── Apple ───

interface AppleJwtPayload {
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  sub: string;
  nonce?: string;
  email?: string;
}

// Apple public keys cache
let appleKeysCache: { keys: Array<{ kid: string; kty: string; n: string; e: string }> } | null = null;
let appleKeysCacheExpiry = 0;

async function getApplePublicKeys() {
  const now = Date.now();
  if (appleKeysCache && now < appleKeysCacheExpiry) {
    return appleKeysCache;
  }

  const res = await fetch("https://appleid.apple.com/auth/keys");
  if (!res.ok) {
    throw Errors.SERVER_ERROR();
  }

  const jwks = await res.json() as { keys: Array<{ kid: string; kty: string; n: string; e: string }> };
  appleKeysCache = jwks;
  appleKeysCacheExpiry = now + 3600_000; // Cache for 1 hour
  return jwks;
}

export async function verifyAppleToken(
  idToken: string,
  nonce?: string,
): Promise<SocialAuthPayload> {
  const bundleId = env.APPLE_BUNDLE_ID;
  if (!bundleId) {
    console.error("[social-auth] APPLE_BUNDLE_ID not configured");
    throw Errors.SERVER_ERROR();
  }

  // Decode header to get kid
  let header: { kid?: string };
  try {
    header = JSON.parse(
      Buffer.from(idToken.split(".")[0], "base64url").toString(),
    );
  } catch {
    throw Errors.INVALID_TOKEN();
  }

  // Fetch Apple public keys
  const jwks = await getApplePublicKeys();
  const key = jwks.keys.find((k) => k.kid === header.kid);
  if (!key) {
    throw Errors.INVALID_TOKEN();
  }

  // Convert JWK to PEM
  const pubKey = crypto.createPublicKey({ key, format: "jwk" });

  // Verify JWT signature and claims
  let decoded: AppleJwtPayload;
  try {
    decoded = jwt.verify(idToken, pubKey, {
      algorithms: ["RS256"],
      issuer: "https://appleid.apple.com",
      audience: bundleId,
    }) as AppleJwtPayload;
  } catch {
    throw Errors.INVALID_TOKEN();
  }

  // iat freshness check
  const now = Math.floor(Date.now() / 1000);
  if (decoded.iat && now - decoded.iat > 300) {
    throw Errors.INVALID_TOKEN();
  }

  // Nonce verification
  if (nonce) {
    const expectedNonce = crypto
      .createHash("sha256")
      .update(nonce)
      .digest("hex");
    if (decoded.nonce !== expectedNonce) {
      throw Errors.INVALID_TOKEN();
    }
  }

  if (!decoded.sub) {
    throw Errors.INVALID_TOKEN();
  }

  return {
    provider: "apple",
    providerId: decoded.sub,
    email: decoded.email ?? "",
  };
}
