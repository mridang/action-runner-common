/**
 * @file Restore step of the docker-cache stage. It records the images present
 * before the job, restores the cache tarball and loads its images into Docker.
 */
import {
  endGroup,
  getInput,
  info,
  saveState,
  setOutput,
  startGroup,
  warning,
} from '@actions/core';
import { restoreCache } from '@actions/cache';
import {
  STATE,
  TARBALL_PATH,
  fileExists,
  freeDisk,
  listImages,
  loadImages,
} from './lib.js';

/* istanbul ignore next */

/**
 * Runs the restore step: optionally frees disk, records pre-existing images
 * and restores the cache tarball. Failures are reported as warnings so the job
 * continues.
 * @returns A promise that resolves once the restore step has finished.
 * @example
 * await run();
 */
async function run(): Promise<void> {
  try {
    const key = getInput('key', { required: true }).trim();
    if (!key) {
      throw new Error('Input "key" must not be empty.');
    }
    saveState(STATE.KEY, key);

    const freeDiskFlag = getInput('free-disk').trim().toLowerCase() === 'true';
    if (freeDiskFlag) {
      startGroup('Freeing runner disk space');
      await freeDisk();
      endGroup();
    }

    startGroup('Recording pre-existing Docker images');
    const preExisting = await listImages();
    saveState(
      STATE.PRE_EXISTING,
      JSON.stringify(preExisting.map((i) => i.name)),
    );
    info(`Pre-existing images: ${preExisting.length}`);
    endGroup();

    startGroup('Restoring Docker image cache');
    const hitKey = await restoreCache([TARBALL_PATH], key);
    if (hitKey) {
      info(`Cache hit on key: ${hitKey}`);
      saveState(STATE.HIT, 'true');
      setOutput('cache-hit', 'true');
      if (await fileExists(TARBALL_PATH)) {
        await loadImages(TARBALL_PATH);
        info('Docker images loaded from cache.');
      } else {
        warning(
          'Cache restore reported success but tarball is missing on disk.',
        );
      }
    } else {
      info('Cache miss.');
      saveState(STATE.HIT, 'false');
      setOutput('cache-hit', 'false');
    }
    endGroup();
  } catch (error) {
    warning(
      `docker-cache restore failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/* istanbul ignore next */
// noinspection JSUnusedGlobalSymbols
// eslint-disable-next-line unicorn/prefer-top-level-await -- CJS bundle output rejects top-level await
export default (async () => {
  await run();
})();
