test('the main entrypoint module can be imported and awaited', async () => {
  // noinspection ES6PreferShortImport
  const mod = await import('../src/main.js');
  await expect(mod.default).resolves.toBeUndefined();
});
