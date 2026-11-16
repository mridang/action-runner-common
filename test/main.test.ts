/**
 * @file Tests that the action entrypoint in src/main.ts can be imported.
 */

test('the main entrypoint module can be imported and awaited', async () => {
  // noinspection ES6PreferShortImport
  const entrypoint = await import('../src/main.js');
  await expect(entrypoint.default).resolves.toBeUndefined();
});
