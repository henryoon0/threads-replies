import { promises as fs } from "node:fs";
import path from "node:path";
import { shareManifestPath } from "./paths";
import type { ShareDeployInfo, ShareEntry, ShareManifest } from "./types";

export async function readManifest(
  filePath = shareManifestPath()
): Promise<ShareManifest> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ShareManifest>;
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      lastDeploy: parsed.lastDeploy,
    };
  } catch {
    return { entries: [] };
  }
}

async function writeManifest(
  manifest: ShareManifest,
  filePath = shareManifestPath()
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(manifest, null, 2), "utf-8");
}

/** 같은 key 가 있으면 publishedAt 은 보존하고 나머지를 갱신한다(재발행). */
export async function upsertEntry(
  entry: Omit<ShareEntry, "publishedAt" | "updatedAt">,
  now = new Date().toISOString(),
  filePath = shareManifestPath()
): Promise<ShareEntry> {
  const manifest = await readManifest(filePath);
  const existing = manifest.entries.find((e) => e.key === entry.key);
  const next: ShareEntry = {
    ...entry,
    publishedAt: existing?.publishedAt ?? now,
    updatedAt: now,
  };
  manifest.entries = [
    next,
    ...manifest.entries.filter((e) => e.key !== entry.key),
  ];
  await writeManifest(manifest, filePath);
  return next;
}

export async function removeEntry(
  key: string,
  filePath = shareManifestPath()
): Promise<boolean> {
  const manifest = await readManifest(filePath);
  const before = manifest.entries.length;
  manifest.entries = manifest.entries.filter((e) => e.key !== key);
  if (manifest.entries.length === before) return false;
  await writeManifest(manifest, filePath);
  return true;
}

export async function recordDeploy(
  info: ShareDeployInfo,
  filePath = shareManifestPath()
): Promise<void> {
  const manifest = await readManifest(filePath);
  manifest.lastDeploy = info;
  await writeManifest(manifest, filePath);
}
