/**
 * Snapshot store — the anchor-verification half of anchor-based editing.
 *
 * Every `read` of an editable file records a snapshot: normalized content
 * plus a short content-hash tag. An `edit` payload carries `[path#TAG]`;
 * the patcher verifies the tag still matches the recorded snapshot before
 * touching the file, so a stale read (file changed underneath us) is
 * rejected instead of corrupting code. After an edit lands, the new content
 * is recorded and the fresh tag is returned to the model — that closed loop
 * is what re-grounds it after every mutation.
 *
 * Bounds mirror omp's hashline store:
 *   - maxPaths (default 30)          — LRU-evicted per path
 *   - maxVersionsPerPath (default 4) — keeps a small recovery chain
 *   - maxBytes (default 4 MiB)       — files over the cap are not snapshotted
 *
 * Pure and testable (tests/snapshots.test.ts); no filesystem access.
 */

export const DEFAULT_MAX_PATHS = 30;
export const DEFAULT_MAX_VERSIONS_PER_PATH = 4;
export const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

export interface SnapshotStoreOptions {
  maxPaths?: number;
  maxVersionsPerPath?: number;
  maxBytes?: number;
}

/** A recorded file version: normalized content plus its content-hash tag. */
export interface Snapshot {
  content: string;
  tag: string;
}

/**
 * Normalize text for hashing: CRLF/CR → LF and strip a UTF-8 BOM, so tags
 * are stable regardless of editor line-ending or BOM choices.
 */
export function normalizeText(text: string): string {
  let out = text.replace(/\r\n?/g, "\n");
  if (out.charCodeAt(0) === 0xfeff) out = out.slice(1);
  return out;
}

/**
 * 4-hex content hash (FNV-1a 32-bit, unsigned) of normalized content.
 * Sixteen bits is enough to catch stale-anchor drift; it is an anchor
 * verifier, not a security primitive.
 */
export function contentTag(content: string): string {
  const normalized = normalizeText(content);
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(4, "0").slice(-4);
}

export class SnapshotStore {
  /** path -> content versions, newest first; insertion order doubles as LRU. */
  private readonly paths = new Map<string, string[]>();
  private readonly maxPaths: number;
  private readonly maxVersions: number;
  private readonly maxBytes: number;

  constructor(options: SnapshotStoreOptions = {}) {
    this.maxPaths = options.maxPaths ?? DEFAULT_MAX_PATHS;
    this.maxVersions = options.maxVersionsPerPath ?? DEFAULT_MAX_VERSIONS_PER_PATH;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  /** Number of tracked paths (for tests and diagnostics). */
  get size(): number {
    return this.paths.size;
  }

  /**
   * Record a snapshot for `path` and return its tag. Files larger than
   * `maxBytes` are intentionally not snapshotted: returns `undefined` so
   * callers can omit `#TAG` anchors for them. Recording refreshes LRU order
   * and caps versions per path.
   */
  record(path: string, content: string): string | undefined {
    const normalized = normalizeText(content);
    const tag = contentTag(normalized);
    if (Buffer.byteLength(normalized, "utf8") > this.maxBytes) {
      return undefined;
    }

    const versions = this.paths.get(path) ?? []; // capture history before refreshing LRU
    this.paths.delete(path);
    versions.unshift(normalized);
    versions.length = Math.min(versions.length, this.maxVersions);
    this.paths.set(path, versions);

    while (this.paths.size > this.maxPaths) {
      const oldest = this.paths.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.paths.delete(oldest);
    }
    return tag;
  }

  /** The most recent snapshot for `path`, if any. */
  latest(path: string): Snapshot | undefined {
    const versions = this.paths.get(path);
    const content = versions?.[0];
    return content === undefined ? undefined : { content, tag: contentTag(content) };
  }

  /** Every recorded version for `path`, newest first (recovery chain). */
  versions(path: string): Snapshot[] {
    return (this.paths.get(path) ?? []).map((content) => ({ content, tag: contentTag(content) }));
  }

  /** Whether `tag` matches the newest recorded snapshot for `path`. */
  verify(path: string, tag: string): boolean {
    const current = this.latest(path);
    return current !== undefined && current.tag === tag;
  }

  /** Drop all snapshots (session teardown, tests). */
  clear(): void {
    this.paths.clear();
  }
}
