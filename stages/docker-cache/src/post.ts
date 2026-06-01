import {
  endGroup,
  getInput,
  getState,
  info,
  startGroup,
  warning,
} from '@actions/core';
import { saveCache } from '@actions/cache';
import { existsSync, unlinkSync } from 'node:fs';
import { STATE, TARBALL_PATH, listImages, saveImages } from './lib.js';

/* istanbul ignore next */
async function run(): Promise<void> {
  try {
    const readOnly = getInput('read-only').trim().toLowerCase() === 'true';
    if (readOnly) {
      info('read-only mode; skipping cache save.');
      return;
    }

    const wasHit = getState(STATE.HIT) === 'true';
    if (wasHit) {
      info(
        'Cache was a hit on the primary key in the pre-step; nothing new to save.',
      );
      return;
    }

    const key = getState(STATE.KEY);
    if (!key) {
      warning('No cache key recorded by the pre-step; skipping save.');
      return;
    }

    const preExisting = new Set<string>(
      JSON.parse(getState(STATE.PRE_EXISTING) || '[]'),
    );

    startGroup('Listing current Docker images');
    const current = await listImages();
    const newImages = current.filter((img) => !preExisting.has(img));
    info(`Current: ${current.length}, new: ${newImages.length}`);
    endGroup();

    if (newImages.length === 0) {
      info('No new images pulled during this job; nothing to cache.');
      return;
    }

    startGroup(`docker save ${newImages.length} image(s) → ${TARBALL_PATH}`);
    if (existsSync(TARBALL_PATH)) {
      unlinkSync(TARBALL_PATH);
    }
    await saveImages(newImages, TARBALL_PATH);
    endGroup();

    startGroup(`Saving cache under key: ${key}`);
    try {
      const cacheId = await saveCache([TARBALL_PATH], key);
      info(`Cache saved (id=${cacheId}).`);
    } catch (err) {
      // Two common cases:
      // 1. Concurrent job already saved under the same key (409). Fine.
      // 2. Cache service error. Surface as a warning, not a failure.
      warning(
        `Cache save did not complete: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    endGroup();
  } catch (err) {
    warning(
      `docker-cache save failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/* istanbul ignore next */
// noinspection JSUnusedGlobalSymbols
export default (async () => {
  await run();
})();
