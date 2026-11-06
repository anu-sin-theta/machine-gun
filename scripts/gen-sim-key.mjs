#!/usr/bin/env node
// Prints a WORLD_SIM_KEY: a base64-encoded PKCS#8 RSA private key.
//
//   pnpm gen:sim-key
//
// Needed when WORLD_MODE=simulated runs on more than one instance (Vercel), so
// every instance signs ID tokens with the same key. Treat it like a secret.

import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
console.log(`WORLD_SIM_KEY=${Buffer.from(pem).toString("base64")}`);
