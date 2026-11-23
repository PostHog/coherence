// A cached scan is replayed only under an equal key and version, so a miss, a torn bucket or another version costs a scan, never a different reading.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cacheDir, writeKept } from "./kept-parse.ts";
import type { FileScan, ScanCache } from "./lexicon-coverage.ts";

/** Buckets per kind: an edit reads at most this many term buckets, whatever the project's size. */
export const BUCKETS = 64;

export function bucketOf(name: string): string {
  return bucketAmong(name, BUCKETS);
}

export function bucketAmong(name: string, buckets: number): string {
  return String(createHash("sha1").update(name).digest().readUInt32BE(0) % buckets).padStart(String(buckets - 1).length, "0");
}

interface KeptScan extends FileScan {
  key: string;
}

interface ScanBucket {
  version: string;
  files: Record<string, KeptScan>;
}

export function scanCacheDir(root: string): string {
  return join(cacheDir(root), "vocabulary-scan");
}

export function openScanCache(root: string, version: string): ScanCache & { save(): void } {
  const buckets = new Map<string, ScanBucket>();
  const seen = new Set<string>();
  const changed = new Set<string>();
  const bucketFor = (id: string): ScanBucket => {
    const loaded = buckets.get(id);
    if (loaded !== undefined) return loaded;
    let read: ScanBucket = { version, files: {} };
    try {
      const parsed = JSON.parse(readFileSync(join(scanCacheDir(root), `${id}.json`), "utf8")) as ScanBucket;
      if (parsed.version === version && typeof parsed.files === "object" && parsed.files !== null) read = parsed;
    } catch {
      // Missing or torn: its files are scanned again and the bucket rewritten.
    }
    buckets.set(id, read);
    return read;
  };
  return {
    scanOf(rel, key) {
      seen.add(rel);
      const kept = bucketFor(bucketOf(rel)).files[rel];
      return kept?.key === key ? kept : undefined;
    },
    keep(rel, key, scan) {
      const id = bucketOf(rel);
      bucketFor(id).files[rel] = { key, comparisons: scan.comparisons, events: scan.events };
      changed.add(id);
    },
    save() {
      for (const [id, bucket] of buckets) {
        const gone = Object.keys(bucket.files).filter((rel) => !seen.has(rel));
        for (const rel of gone) delete bucket.files[rel];
        if (gone.length === 0 && !changed.has(id)) continue;
        try {
          writeKept(join(scanCacheDir(root), `${id}.json`), bucket);
        } catch {
          // An unwritten bucket is a miss next time, never a wrong reading.
        }
      }
    },
  };
}
