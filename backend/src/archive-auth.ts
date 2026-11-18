// Signed uploads to the shared raw archive (D-054).
// A reporter signs "clamp-archive:<sha256 hex>:<unix seconds>" with its
// Solana key (ed25519). The backend accepts the file only if the signer is a
// registered reporter, the time is recent and the hash matches the bytes.

import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

import type { Keypair } from "@solana/web3.js";

export const ARCHIVE_MAX_AGE_SECS = 300;
export const ARCHIVE_MAX_BYTES = 5 * 1024 * 1024;

export const archiveMessage = (sha256Hex: string, ts: number) => `clamp-archive:${sha256Hex}:${ts}`;

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

/** ed25519 signature (base64) of the archive message with a Solana keypair. */
export function signArchive(keypair: Keypair, sha256Hex: string, ts: number): string {
  const key = createPrivateKey({
    key: {
      kty: "OKP",
      crv: "Ed25519",
      d: b64url(keypair.secretKey.slice(0, 32)),
      x: b64url(keypair.publicKey.toBytes()),
    },
    format: "jwk",
  });
  return sign(null, Buffer.from(archiveMessage(sha256Hex, ts)), key).toString("base64");
}

/** Checks the signature of `publicKey` (32 bytes) over the archive message. */
export function verifyArchive(publicKey: Uint8Array, sha256Hex: string, ts: number, signatureB64: string): boolean {
  try {
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: b64url(publicKey) }, format: "jwk" });
    return verify(null, Buffer.from(archiveMessage(sha256Hex, ts)), key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}
