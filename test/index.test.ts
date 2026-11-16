/**
 * @file Tests for the core run() logic in src/index.ts.
 */
import { expect, jest, test } from '@jest/globals';
// noinspection ES6PreferShortImport
import { run } from '../src/index.js';

/** Matches the message the placeholder run logs. */
const PLACEHOLDER_PATTERN = /no owned stages yet/;

test('run() resolves without throwing', async () => {
  await expect(run()).resolves.toBeUndefined();
});

test('run() logs the placeholder notice', async () => {
  const writes: string[] = [];
  const spy = jest
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: unknown) => {
      writes.push(
        typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf8'),
      );
      return true;
    });
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  expect(writes.join('')).toMatch(PLACEHOLDER_PATTERN);
});
