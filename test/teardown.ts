/**
 * @file Jest global teardown. It runs once after the suite finishes.
 */
// noinspection JSUnusedGlobalSymbols

/**
 * Cleans up after the whole test run. No external services were started, so
 * there is nothing to stop.
 * @returns A promise that resolves once teardown has completed.
 * @example
 * // Jest calls this automatically through the globalTeardown option.
 */
export default async function teardown(): Promise<void> {
  // No external services to tear down.
}
