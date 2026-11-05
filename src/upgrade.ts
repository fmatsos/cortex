import { chmodSync, renameSync, rmSync } from "node:fs";
import { sha256 } from "./lib";
import { LIMITS } from "./limits";
import pkg from "../package.json";

/** Releases of this repository (GitHub). */
export const REPO = "fmatsos/cortex";

/** True in a binary built by `bun build --compile` (its modules live in Bun's virtual /$bunfs/), false when run from the sources. */
export const COMPILED = Bun.main.startsWith("/$bunfs/") || /^[A-Z]:[\\/]~BUN[\\/]/.test(Bun.main);

/** Release asset for this machine, as named by .github/workflows/release.yml. */
export const assetName = (platform = process.platform, arch = process.arch) => `cortex-${platform}-${arch}`;

/** -1, 0 or 1 (semver order: a leading `v` ignored, a pre-release such as `-rc.2` sorts before its release and numerically against `-rc.10`). */
export const compareVersions = (a: string, b: string) => Bun.semver.order(a.replace(/^v/, ""), b.replace(/^v/, ""));

/**
 * Public half of the release signing key (Ed25519, raw, base64). The workflow signs SHA256SUMS with the private half
 * (secret CORTEX_SIGNING_KEY, scripts/sign.ts): a release altered without that key is refused, SHA256SUMS included.
 */
export const RELEASE_PUBLIC_KEY = "LgTE4Q4tGxmew5Cb1/1qi3jirqDDH6k4yjniXY9EKac=";

/** True if `sig` (base64) is a valid Ed25519 signature of `data` by `publicKey` (raw, base64). */
export async function verifySignature(data: Uint8Array<ArrayBuffer>, sig: string, publicKey = RELEASE_PUBLIC_KEY): Promise<boolean> {
  const key = await crypto.subtle.importKey("raw", Buffer.from(publicKey, "base64"), { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.verify("Ed25519", key, Buffer.from(sig.trim(), "base64"), data);
}

type Release = { tag_name: string; assets: { name: string; browser_download_url: string }[] };

async function latestRelease(): Promise<Release> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: "application/vnd.github+json", "user-agent": "cortex-cli" }, signal: AbortSignal.timeout(LIMITS.fetchTimeoutMs) });
  if (res.status === 404) throw new Error(`Aucune release publiée sur ${REPO}.`);
  if (!res.ok) throw new Error(`GitHub a répondu ${res.status} en cherchant la dernière release.`);
  return res.json() as Promise<Release>;
}

async function download(url: string): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch(url, { headers: { "user-agent": "cortex-cli" }, signal: AbortSignal.timeout(LIMITS.upgradeTimeoutMs) });
  if (!res.ok) throw new Error(`Téléchargement impossible (HTTP ${res.status}) : ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

export type Upgrade = { current: string; latest: string; upgraded: boolean };

/**
 * `cortex upgrade [--check]`: compares the installed version with the latest GitHub release and, unless `check`,
 * replaces the running binary with the release asset for this platform, after checking it against SHA256SUMS.
 */
export async function upgrade(check = false): Promise<Upgrade> {
  const rel = await latestRelease();
  const r = { current: pkg.version, latest: rel.tag_name.replace(/^v/, ""), upgraded: false };
  if (check || compareVersions(r.current, r.latest) >= 0) return r;
  if (!COMPILED) throw new Error(`cortex tourne depuis les sources : mets-le à jour avec git pull && bun install (dernière version : ${r.latest}).`);

  const name = assetName();
  const asset = rel.assets.find((a) => a.name === name);
  const sums = rel.assets.find((a) => a.name === "SHA256SUMS");
  const sumsSig = rel.assets.find((a) => a.name === "SHA256SUMS.sig");
  if (!asset) throw new Error(`La release ${rel.tag_name} n'a pas de binaire pour ${process.platform}-${process.arch} (${name}).`);
  if (!sums || !sumsSig) throw new Error(`La release ${rel.tag_name} n'a pas de SHA256SUMS signé : mise à jour refusée.`);
  const [bin, list, sig] = await Promise.all([asset, sums, sumsSig].map((a) => download(a.browser_download_url)));
  if (!(await verifySignature(list, new TextDecoder().decode(sig)))) throw new Error(`Signature de SHA256SUMS invalide pour ${rel.tag_name} : release non signée par cortex, mise à jour refusée.`);
  const expected = new TextDecoder().decode(list).split("\n").map((l) => l.trim().split(/\s+/)).find(([, f]) => f?.replace(/^\*/, "") === name)?.[0];
  if (!expected || expected !== sha256(bin)) throw new Error(`Empreinte SHA-256 de ${name} invalide : mise à jour refusée.`);

  // Written next to the binary then renamed over it: same filesystem, so the swap is atomic and the running process keeps its inode.
  const target = process.execPath, tmp = `${target}.new`;
  try {
    await Bun.write(tmp, bin);
    chmodSync(tmp, 0o755);
    renameSync(tmp, target);
  } catch (e) {
    rmSync(tmp, { force: true });
    const code = (e as NodeJS.ErrnoException).code;
    throw new Error(code === "EACCES" || code === "EPERM" ? `Pas le droit d'écrire ${target} : relance avec les droits nécessaires (sudo ?).` : (e as Error).message);
  }
  return { ...r, upgraded: true };
}
