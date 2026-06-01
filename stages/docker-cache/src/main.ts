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
import { existsSync } from 'node:fs';
import {
  STATE,
  TARBALL_PATH,
  freeDisk,
  listImages,
  loadImages,
} from './lib.js';

/* istanbul ignore next */
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
      if (existsSync(TARBALL_PATH)) {
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
  } catch (err) {
    warning(
      `docker-cache restore failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/* istanbul ignore next */
// noinspection JSUnusedGlobalSymbols
export default (async () => {
  await run();
})();
