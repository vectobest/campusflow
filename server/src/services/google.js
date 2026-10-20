import { OAuth2Client } from 'google-auth-library';
import { config } from '../config.js';

let client = null;

/**
 * Verify a Google Identity Services ID token (the `credential` returned by the
 * "Sign in with Google" button). google-auth-library checks the signature
 * against Google's published keys, the issuer, the expiry, and that the token
 * was issued for our client ID (audience).
 */
export async function verifyGoogleCredential(credential) {
  client ??= new OAuth2Client(config.google.clientId);
  const ticket = await client.verifyIdToken({ idToken: credential, audience: config.google.clientId });
  const p = ticket.getPayload();
  return {
    sub: p.sub,
    email: p.email,
    emailVerified: p.email_verified === true,
    hostedDomain: p.hd ?? null,
  };
}
