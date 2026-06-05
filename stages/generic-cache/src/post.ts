import {
  endGroup,
  getInput,
  getState,
  info,
  startGroup,
  warning,
} from '@actions/core';
import { saveCache } from '@actions/cache';
import { existsSync, statSync, unlinkSync } from 'node:fs';
import {
  STATE,
  TARBALL_PATH,
  cachePath,
  formatBytes,
  reportDirSize,
  tarTolerant,
} from './lib.js';

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

    const dir = cachePath();
    if (!existsSync(dir)) {
      info(`${dir} does not exist; nothing to cache.`);
      return;
    }

    startGroup(`Tar ${dir} → ${TARBALL_PATH} (tolerant of live writers)`);
    await reportDirSize('Cache dir size (being saved)', dir);
    if (existsSync(TARBALL_PATH)) {
      try {
        unlinkSync(TARBALL_PATH);
      } catch {
        /* ignore */
      }
    }
    await tarTolerant(dir, TARBALL_PATH);
    if (!existsSync(TARBALL_PATH)) {
      warning('Tar did not produce an output file; skipping cache save.');
      endGroup();
      return;
    }
    const size = statSync(TARBALL_PATH).size;
    info(`Tarball size: ${formatBytes(size)} (${size} bytes)`);
    endGroup();

    startGroup(`Saving cache under key: ${key}`);
    try {
      const cacheId = await saveCache([TARBALL_PATH], key);
      info(`Cache saved (id=${cacheId}).`);
    } catch (err) {
      warning(
        `Cache save did not complete: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      try {
        if (existsSync(TARBALL_PATH)) unlinkSync(TARBALL_PATH);
      } catch {
        /* ignore */
      }
    }
    endGroup();
  } catch (err) {
    warning(
      `generic-cache save failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/* istanbul ignore next */
// noinspection JSUnusedGlobalSymbols
export default (async () => {
  await run();
})();
