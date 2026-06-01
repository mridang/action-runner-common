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
import {
  STATE,
  TARBALL_PATH,
  binPack,
  exportImages,
  formatBytes,
  freeDiskBytes,
  listImages,
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

    const fractionInput = getInput('max-fraction').trim();
    let fraction = fractionInput ? parseFloat(fractionInput) : 0.6;
    if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
      warning(`Invalid max-fraction "${fractionInput}"; falling back to 0.6.`);
      fraction = 0.6;
    }

    const preExistingArr: string[] = JSON.parse(
      getState(STATE.PRE_EXISTING) || '[]',
    );
    const preExisting = new Set(preExistingArr);

    startGroup('Listing current Docker images');
    const current = await listImages();
    const newImages = current.filter((img) => !preExisting.has(img.name));
    info(`Current: ${current.length}, new (delta): ${newImages.length}`);
    endGroup();

    if (newImages.length === 0) {
      info('No new images pulled during this job; nothing to cache.');
      return;
    }

    startGroup('Bin-packing delta against available disk');
    const free = await freeDiskBytes(TARBALL_PATH);
    const budget = Math.floor(free * fraction);
    info(
      `Free disk: ${formatBytes(free)}, fraction: ${fraction}, budget: ${formatBytes(budget)}`,
    );
    const { include, skip, totalBytes } = binPack(newImages, budget);
    info(
      `Including ${include.length}/${newImages.length} images (${formatBytes(totalBytes)} / ${formatBytes(budget)} budget)`,
    );
    if (skip.length) {
      warning(
        `Skipping ${skip.length} image(s) that did not fit the cache budget:\n` +
          skip.map((s) => `  - ${s.name} (${formatBytes(s.size)})`).join('\n'),
      );
    }
    endGroup();

    if (include.length === 0) {
      info(
        'No images fit within the budget; skipping save entirely (no tarball written).',
      );
      return;
    }

    startGroup(`Exporting ${include.length} image(s) → ${TARBALL_PATH}`);
    if (existsSync(TARBALL_PATH)) {
      unlinkSync(TARBALL_PATH);
    }
    await exportImages(
      include.map((i) => i.name),
      TARBALL_PATH,
    );
    info(`Tarball written: ${TARBALL_PATH}`);
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
      // Delete the tarball to free disk for any subsequent post-step
      // (e.g., the generic ~/.cache cache save that runs after us).
      try {
        if (existsSync(TARBALL_PATH)) unlinkSync(TARBALL_PATH);
      } catch {
        /* ignore */
      }
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
