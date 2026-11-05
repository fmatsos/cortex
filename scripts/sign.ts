export {}; // a module: top-level await
// Signs a release file: `bun scripts/sign.ts <file>` writes <file>.sig (Ed25519, base64).
// The private key (PKCS#8, base64) comes from $CORTEX_SIGNING_KEY, a GitHub secret; its public half is in src/upgrade.ts.
const [file] = process.argv.slice(2);
const secret = process.env.CORTEX_SIGNING_KEY;
if (!file || !secret) throw new Error("usage: CORTEX_SIGNING_KEY=… bun scripts/sign.ts <file>");
const key = await crypto.subtle.importKey("pkcs8", Buffer.from(secret.trim(), "base64"), { name: "Ed25519" }, false, ["sign"]);
const sig = await crypto.subtle.sign("Ed25519", key, await Bun.file(file).bytes());
await Bun.write(`${file}.sig`, Buffer.from(sig).toString("base64") + "\n");
