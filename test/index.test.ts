import { expect, jest } from '@jest/globals';
// noinspection ES6PreferShortImport
import { run } from '../src/index.js';

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
  expect(writes.join('')).toMatch(/no owned stages yet/);
});
