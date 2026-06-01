import { exec, getExecOutput } from '@actions/exec';
import { join } from 'node:path';

/**
 * Path to the tarball produced by `docker save` and uploaded to the
 * GitHub Actions cache. Lives under RUNNER_TEMP so it is cleaned up
 * automatically at the end of the job.
 */
export const TARBALL_PATH = join(
  process.env.RUNNER_TEMP || '/tmp',
  'runner-common-docker-cache.tar',
);

/** State keys used to pass data from main.ts to post.ts. */
export const STATE = {
  /** The resolved cache key. */
  KEY: 'cache-key',
  /** Whether the pre-step restored the cache on its primary key. */
  HIT: 'cache-hit',
  /**
   * JSON-encoded list of images that existed BEFORE the cache restore.
   * Used to compute the delta saved in the post-step.
   */
  PRE_EXISTING: 'pre-existing-images',
} as const;

/**
 * List the images currently present in the docker daemon, formatted as
 * "repo:tag" (or the image ID for dangling images).
 */
export async function listImages(): Promise<string[]> {
  const { stdout } = await getExecOutput(
    'docker',
    [
      'image',
      'list',
      '--format',
      '{{ if ne .Repository "<none>" }}{{ .Repository }}{{ if ne .Tag "<none>" }}:{{ .Tag }}{{ end }}{{ else }}{{ .ID }}{{ end }}',
    ],
    { silent: true },
  );
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** `docker save` the named images into the given tarball path. */
export async function saveImages(
  images: string[],
  tarballPath: string,
): Promise<void> {
  await exec('docker', ['save', '--output', tarballPath, ...images]);
}

/** `docker load` images from the given tarball path. */
export async function loadImages(tarballPath: string): Promise<void> {
  await exec('docker', ['load', '--input', tarballPath]);
}
