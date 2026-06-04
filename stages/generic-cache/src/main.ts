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
import { mkdir } from 'node:fs/promises';
import { STATE, TARBALL_PATH, cachePath, untar } from './lib.js';

/* istanbul ignore next */
async function run(): Promise<void> {
  try {
    const key = getInput('key', { required: true }).trim();
    if (!key) {
      throw new Error('Input "key" must not be empty.');
    }
    const restoreKeysRaw = getInput('restore-keys') || '';
    const restoreKeys = restoreKeysRaw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    saveState(STATE.KEY, key);

    // Make sure the cache directory exists before any consumer writes.
    const dir = cachePath();
    await mkdir(dir, { recursive: true });

    startGroup('Restoring generic XDG cache');
    const hitKey = await restoreCache([TARBALL_PATH], key, restoreKeys);
    if (hitKey) {
      info(`Cache hit on key: ${hitKey}`);
      saveState(STATE.HIT, hitKey === key ? 'true' : 'false');
      setOutput('cache-hit', hitKey === key ? 'true' : 'false');
      if (existsSync(TARBALL_PATH)) {
        await untar(TARBALL_PATH, dir + '/..');
        info(`Cache extracted into ${dir}`);
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
      `generic-cache restore failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/* istanbul ignore next */
// noinspection JSUnusedGlobalSymbols
export default (async () => {
  await run();
})();
