// Generates a fresh signing key pair for Convex Auth and stores it on the
// current Convex deployment (JWT_PRIVATE_KEY, JWKS), plus SITE_URL.
//
//   node scripts/convex-auth-keys.mjs [site-url]
//
// Run once per deployment (local, dev, prod). Rotating the keys signs every
// user out. The keys go straight to Convex and are never printed.
import { execFileSync } from "node:child_process";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

const siteUrl = process.argv[2] ?? "http://localhost:5173";
const keys = await generateKeyPair("RS256", { extractable: true });
const privateKey = await exportPKCS8(keys.privateKey);
const jwks = JSON.stringify({
  keys: [{ use: "sig", ...(await exportJWK(keys.publicKey)) }],
});

const set = (name, value) =>
  execFileSync("npx", ["convex", "env", "set", name, "--", value], {
    stdio: ["ignore", "inherit", "inherit"],
  });
set("JWT_PRIVATE_KEY", privateKey.trimEnd().replace(/\n/g, " "));
set("JWKS", jwks);
set("SITE_URL", siteUrl);
