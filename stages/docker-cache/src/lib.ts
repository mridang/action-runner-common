/**
 * @file Helpers for the docker-cache stage. They talk to the Docker Engine API
 * over a unix socket, pack images into a budget and manage the cache tarball.
 */
import { info, warning } from '@actions/core';
import { exec } from '@actions/exec';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, rm, statfs } from 'node:fs/promises';
import { request } from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';

/** Tarball location for the cache payload. Under RUNNER_TEMP. */
export const TARBALL_PATH = path.join(
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

/**
 * Bytes of free disk on the filesystem holding the given path.
 * @param filePath - Path whose containing filesystem is measured.
 * @returns The number of bytes available to unprivileged writers.
 * @example
 * const free = await freeDiskBytes(TARBALL_PATH);
 * info(`Free disk: ${free} bytes`);
 */
export async function freeDiskBytes(filePath: string): Promise<number> {
  const stat = await statfs(path.dirname(filePath));
  return Number(stat.bavail) * Number(stat.bsize);
}

/**
 * Report whether anything exists at the given path, treating any access
 * error as absence.
 * @param filePath - Path to test.
 * @returns A promise resolving to true when the path can be accessed.
 * @example
 * if (await fileExists(TARBALL_PATH)) {
 *   info('Tarball is present on disk.');
 * }
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Minimal HTTP client for the Docker Engine API over a unix socket.
 * Avoids dockerode (which depends on ssh2 → native cpufeatures.node and
 * does not bundle cleanly with rollup).
 * @param opts - Request description for the Docker Engine API.
 * @param opts.method - HTTP verb to send to the daemon.
 * @param opts.path - Request path, including any query string.
 * @param opts.body - Optional stream piped into the request body.
 * @param opts.headers - Optional extra request headers.
 * @returns The response status code together with the readable response body.
 * @example
 * const { statusCode, stream } = await dockerRequest({
 *   method: 'GET',
 *   path: '/version',
 * });
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

/**
 * Issue a GET request to the Docker Engine API and parse the JSON body.
 * @template T - Shape of the parsed JSON payload.
 * @param requestPath - Engine API path to fetch, such as `/images/json`.
 * @returns The parsed JSON payload typed as the caller's expected shape.
 * @throws When the daemon answers with a status outside the 2xx range.
 * @rejects When the request fails or the body is not valid JSON.
 * @example
 * const images = await dockerGetJson<DockerImage[]>('/images/json');
 */
async function dockerGetJson<T>(requestPath: string): Promise<T> {
  const { statusCode, stream } = await dockerRequest({
    method: 'GET',
    path: requestPath,
  });
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const body = Buffer.concat(chunks).toString('utf8');
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(
      `Docker API ${requestPath} returned ${statusCode}: ${body.slice(0, 200)}`,
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
 * @returns Every named image with its size in bytes.
 * @example
 * const images = await listImages();
 * info(`Found ${images.length} named images.`);
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
 * @param images - Candidate images with their sizes in bytes.
 * @param budgetBytes - Maximum combined size of the included images.
 * @returns The included images, the skipped images and the included total.
 * @example
 * const { include, skip } = binPack(newImages, 10 * 1024 ** 3);
 */
export function binPack(
  images: ImageEntry[],
  budgetBytes: number,
): { include: ImageEntry[]; skip: ImageEntry[]; totalBytes: number } {
  const sorted = images.toSorted((a, b) => b.size - a.size);
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
 * @param names - Image names to include in the tarball. Must not be empty.
 * @param tarballPath - Destination file that receives the tarball.
 * @throws When no names are given or the daemon answers with a non-2xx status.
 * @rejects When the response stream or the file write fails.
 * @example
 * await exportImages(['alpine:3.20'], TARBALL_PATH);
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
 * @param tarballPath - Path of the tarball to stream into the daemon.
 * @throws When the daemon answers with a status outside the 2xx range.
 * @rejects When the tarball cannot be read or the request fails.
 * @example
 * await loadImages(TARBALL_PATH);
 */
export async function loadImages(tarballPath: string): Promise<void> {
  const body = createReadStream(tarballPath);
  const { statusCode, stream } = await dockerRequest({
    method: 'POST',
    path: '/images/load?quiet=true',
    body,
    headers: { 'Content-Type': 'application/x-tar' },
  });
  // Drain the response (the daemon streams progress lines) until it ends.
  stream.resume();
  await finished(stream);
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`Docker /images/load returned ${statusCode}`);
  }
}

/**
 * Free runner disk space by removing well-known pre-installed bloat.
 * Mirrors `jlumbroso/free-disk-space` but inline in Node so consumers
 * don't need an extra composite step. Best-effort — failures warn.
 * @returns A promise that resolves once every removal has been attempted.
 * @example
 * await freeDisk();
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
      } catch (error) {
        warning(
          `free-disk: could not remove ${p}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  const after = await freeDiskBytes('/');
  info(
    `free-disk: ${formatBytes(before)} → ${formatBytes(after)} free (+${formatBytes(after - before)})`,
  );
}

/**
 * Human-friendly byte formatter for logs.
 * @param n - Byte count to format.
 * @returns The count scaled to B, KB, MB, GB or TB with two decimals.
 * @example
 * formatBytes(1536); // '1.50KB'
 */
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
