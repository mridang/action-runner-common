import { info, warning } from '@actions/core';
import { exec } from '@actions/exec';
import { createReadStream, createWriteStream } from 'node:fs';
import { rm, statfs } from 'node:fs/promises';
import { request } from 'node:http';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Tarball location for the cache payload. Under RUNNER_TEMP. */
export const TARBALL_PATH = join(
  process.env.RUNNER_TEMP || '/tmp',
  'runner-common-docker-cache.tar',
);

/** State keys used to pass data from main.ts to post.ts. */
export const STATE = {
  KEY: 'cache-key',
  HIT: 'cache-hit',
  /** JSON list of image identifiers present BEFORE restore. */
  PRE_EXISTING: 'pre-existing-images',
} as const;

/** Path to the docker daemon unix socket. Overridable for tests. */
const DOCKER_SOCKET =
  process.env.DOCKER_HOST?.replace(/^unix:\/\//, '') || '/var/run/docker.sock';

/** A docker image as we care about it: identifier + total size in bytes. */
interface ImageEntry {
  name: string;
  size: number;
}

/** Bytes of free disk on the filesystem holding the given path. */
export async function freeDiskBytes(path: string): Promise<number> {
  const stat = await statfs(dirname(path));
  return Number(stat.bavail) * Number(stat.bsize);
}

/**
 * Minimal HTTP client for the Docker Engine API over a unix socket.
 * Avoids dockerode (which depends on ssh2 → native cpufeatures.node and
 * does not bundle cleanly with rollup).
 */
function dockerRequest(opts: {
  method: 'GET' | 'POST';
  path: string;
  body?: Readable;
  headers?: Record<string, string>;
}): Promise<{ statusCode: number; stream: Readable }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath: DOCKER_SOCKET,
        method: opts.method,
        path: opts.path,
        headers: opts.headers,
      },
      (res) => {
        resolve({ statusCode: res.statusCode || 0, stream: res });
      },
    );
    req.on('error', reject);
    if (opts.body) {
      opts.body.pipe(req);
    } else {
      req.end();
    }
  });
}

async function dockerGetJson<T>(path: string): Promise<T> {
  const { statusCode, stream } = await dockerRequest({ method: 'GET', path });
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const body = Buffer.concat(chunks).toString('utf8');
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(
      `Docker API ${path} returned ${statusCode}: ${body.slice(0, 200)}`,
    );
  }
  return JSON.parse(body) as T;
}

/** Shape we read from `GET /images/json`. */
interface DockerImage {
  Id: string;
  RepoTags: string[] | null;
  Size: number;
}

/**
 * List all images visible to the docker daemon. Each entry's `name` is
 * its first usable RepoTag; dangling images (no usable tag) are
 * dropped because they cannot be restored by name on the next run.
 */
export async function listImages(): Promise<ImageEntry[]> {
  const raw = await dockerGetJson<DockerImage[]>('/images/json');
  const result: ImageEntry[] = [];
  for (const img of raw) {
    const tags = (img.RepoTags || []).filter((t) => t && t !== '<none>:<none>');
    if (tags.length === 0) continue;
    result.push({ name: tags[0]!, size: Number(img.Size || 0) });
  }
  return result;
}

/**
 * First-fit-decreasing bin-pack. Sorts images by size descending and
 * greedily includes each one whose size fits in the remaining budget.
 */
export function binPack(
  images: ImageEntry[],
  budgetBytes: number,
): { include: ImageEntry[]; skip: ImageEntry[]; totalBytes: number } {
  const sorted = [...images].sort((a, b) => b.size - a.size);
  const include: ImageEntry[] = [];
  const skip: ImageEntry[] = [];
  let totalBytes = 0;
  for (const img of sorted) {
    if (totalBytes + img.size <= budgetBytes) {
      include.push(img);
      totalBytes += img.size;
    } else {
      skip.push(img);
    }
  }
  return { include, skip, totalBytes };
}

/**
 * Export the named images to a single tarball via the Docker Engine API
 * (`GET /images/get?names=...`). Streams directly to disk.
 */
export async function exportImages(
  names: string[],
  tarballPath: string,
): Promise<void> {
  if (names.length === 0) {
    throw new Error('exportImages called with no names');
  }
  const qs = names.map((n) => `names=${encodeURIComponent(n)}`).join('&');
  const { statusCode, stream } = await dockerRequest({
    method: 'GET',
    path: `/images/get?${qs}`,
  });
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`Docker /images/get returned ${statusCode}`);
  }
  await pipeline(stream, createWriteStream(tarballPath));
}

/**
 * Load images from a tarball via the Docker Engine API
 * (`POST /images/load`). Streams the file to the socket.
 */
export async function loadImages(tarballPath: string): Promise<void> {
  const body = createReadStream(tarballPath);
  const { statusCode, stream } = await dockerRequest({
    method: 'POST',
    path: '/images/load?quiet=true',
    body,
    headers: { 'Content-Type': 'application/x-tar' },
  });
  // Drain the response (the daemon streams progress lines).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _chunk of stream) {
    /* ignore */
  }
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`Docker /images/load returned ${statusCode}`);
  }
}

/**
 * Free runner disk space by removing well-known pre-installed bloat.
 * Mirrors `jlumbroso/free-disk-space` but inline in Node so consumers
 * don't need an extra composite step. Best-effort — failures warn.
 */
export async function freeDisk(): Promise<void> {
  const PATHS = [
    '/usr/share/dotnet',
    '/usr/local/lib/android',
    '/opt/ghc',
    '/usr/local/share/boost',
    '/usr/local/share/powershell',
    '/usr/local/share/chromium',
    '/opt/hostedtoolcache/CodeQL',
    '/opt/hostedtoolcache/PyPy',
  ];
  const before = await freeDiskBytes('/');
  for (const p of PATHS) {
    try {
      await rm(p, { recursive: true, force: true });
    } catch {
      try {
        await exec('sudo', ['rm', '-rf', p], { silent: true });
      } catch (err) {
        warning(
          `free-disk: could not remove ${p}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
  const after = await freeDiskBytes('/');
  info(
    `free-disk: ${formatBytes(before)} → ${formatBytes(after)} free (+${formatBytes(after - before)})`,
  );
}

/** Human-friendly byte formatter for logs. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(2)}${units[i]}`;
}
