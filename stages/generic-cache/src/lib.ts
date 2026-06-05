import { info } from '@actions/core';
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
 * Privilege handling:
 *   When test containers run as root and bind-mount into a host path
 *   like `~/.cache/openapi-gen/<lang>`, the files they write end up
 *   owned by root on the host. A plain `tar` running as the runner
 *   user would hit EACCES on those files and (with --ignore-failed-read)
 *   silently skip them — making the cache useless.
 *
 *   We try `sudo -n tar` first so tar runs as root and can read
 *   everything. On GitHub-hosted runners passwordless sudo is always
 *   available; on self-hosted runners without it, sudo fails fast and
 *   we fall back to a plain `tar` (root-owned files get skipped, which
 *   is the same behavior as before — graceful degradation).
 *
 *   After `sudo tar`, we `sudo chown` the output back to the runner
 *   user so `@actions/cache.saveCache()` (which runs as the runner)
 *   can read it without elevation.
 *
 * Flags:
 *   --ignore-failed-read     : skip files that vanish mid-read
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
  const tarArgs = [
    '-cf',
    outputTar,
    '--ignore-failed-read',
    '--warning=no-file-changed',
    '-C',
    parent,
    base,
  ];

  // Try elevated tar first (non-interactive). exit 0 = sudo worked.
  // Any non-zero from sudo (no NOPASSWD, no sudo, etc.) falls through.
  const sudoExit = await exec('sudo', ['-n', 'tar', ...tarArgs], {
    ignoreReturnCode: true,
  });
  if (sudoExit === 0) {
    const uid = process.getuid?.() ?? 1001;
    const gid = process.getgid?.() ?? 1001;
    await exec('sudo', ['-n', 'chown', `${uid}:${gid}`, outputTar], {
      ignoreReturnCode: true,
    });
    return;
  }

  info('sudo tar unavailable; falling back to plain tar.');
  await exec('tar', tarArgs, { ignoreReturnCode: true });
}

/** Untar into the given parent directory. */
export async function untar(
  tarPath: string,
  intoParent: string,
): Promise<void> {
  await mkdir(intoParent, { recursive: true });
  await exec('tar', ['-xf', tarPath, '-C', intoParent]);
}

/**
 * Log the on-disk size of a directory (apparent total bytes), so every
 * run records what was saved/restored. Uses `sudo -n du` so root-owned
 * subtrees (e.g. files written by containers running as root) are
 * counted; falls back to plain `du` when sudo is unavailable.
 *
 * Best-effort: never throws — diagnostics must not fail the job.
 */
export async function reportDirSize(label: string, dir: string): Promise<void> {
  try {
    let out = '';
    const opts = {
      silent: true,
      ignoreReturnCode: true,
      listeners: {
        stdout: (d: Buffer) => {
          out += d.toString();
        },
      },
    };
    let code = await exec('sudo', ['-n', 'du', '-sb', dir], opts);
    if (code !== 0) {
      out = '';
      code = await exec('du', ['-sb', dir], opts);
    }
    const bytes = parseInt(out.split(/\s+/)[0] || '0', 10);
    if (Number.isFinite(bytes) && bytes > 0) {
      info(`${label}: ${dir} = ${formatBytes(bytes)} (${bytes} bytes)`);
    } else {
      info(`${label}: ${dir} = unknown (du returned no size)`);
    }
  } catch (err) {
    info(
      `${label}: could not measure ${dir}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Human-readable byte formatter. */
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
