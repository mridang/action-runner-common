import { exec } from '@actions/exec';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Path to the tarball that holds the cached `~/.cache` snapshot.
 * Lives under RUNNER_TEMP so it is cleaned up at job end.
 */
export const TARBALL_PATH = join(
  process.env.RUNNER_TEMP || '/tmp',
  'runner-common-generic-cache.tar',
);

/** State keys passed from main.ts to post.ts. */
export const STATE = {
  KEY: 'cache-key',
  HIT: 'cache-hit',
} as const;

/** Path the stage caches. Resolved from $HOME (or HOME env var). */
export function cachePath(): string {
  return join(process.env.HOME || '/home/runner', '.cache');
}

/**
 * Tar a directory tolerantly: a writer modifying or deleting a file
 * mid-read does not abort the archive. Designed for live directories
 * like `~/.cache` where docker containers, ryuk cleanup, JVM caches,
 * etc. may still be writing during the post-step.
 *
 * Flags:
 *   --ignore-failed-read    : skip files that vanish or can't be opened
 *   --warning=no-file-changed: silence "file changed as we read it"
 */
export async function tarTolerant(
  dirToArchive: string,
  outputTar: string,
): Promise<void> {
  // -C parent and archive the basename so paths inside the tar are
  // relative ("./.cache/...") — that way `tar -xf` into the same parent
  // restores cleanly on the next run.
  const parent = join(dirToArchive, '..');
  const base = dirToArchive.split('/').filter(Boolean).pop()!;
  await exec(
    'tar',
    [
      '-cf',
      outputTar,
      '--ignore-failed-read',
      '--warning=no-file-changed',
      '-C',
      parent,
      base,
    ],
    { ignoreReturnCode: true },
  );
}

/** Untar into the given parent directory. */
export async function untar(
  tarPath: string,
  intoParent: string,
): Promise<void> {
  await mkdir(intoParent, { recursive: true });
  await exec('tar', ['-xf', tarPath, '-C', intoParent]);
}
