import { expect, test } from "bun:test";
import { assetName, COMPILED, compareVersions, verifySignature } from "./upgrade";

test("compareVersions orders numerically, v prefix ignored, pre-release before release", () => {
  expect(compareVersions("0.1.0", "0.2.0")).toBe(-1);
  expect(compareVersions("v0.10.0", "0.9.9")).toBe(1);
  expect(compareVersions("1.2.3", "v1.2.3")).toBe(0);
  expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBe(-1);
  expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBe(1);
  expect(compareVersions("1.0.0-rc.1", "1.0.0-rc.2")).toBe(-1);
});

test("asset name matches the release workflow; tests run from the sources", () => {
  expect(assetName("linux", "x64")).toBe("cortex-linux-x64");
  expect(assetName("darwin", "arm64")).toBe("cortex-darwin-arm64");
  expect(COMPILED).toBe(false);
});

test("verifySignature accepts the signer's signature only, and only for the signed bytes", async () => {
  const k = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const pub = Buffer.from(await crypto.subtle.exportKey("raw", k.publicKey)).toString("base64");
  const data = new TextEncoder().encode("abc  cortex-linux-x64\n");
  const sig = Buffer.from(await crypto.subtle.sign("Ed25519", k.privateKey, data)).toString("base64");
  expect(await verifySignature(data, sig, pub)).toBe(true);
  expect(await verifySignature(new TextEncoder().encode("abd  cortex-linux-x64\n"), sig, pub)).toBe(false); // tampered SHA256SUMS
  expect(await verifySignature(data, sig)).toBe(false); // signed by another key than the release key
});
