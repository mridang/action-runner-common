/**
 * @file Jest global setup. It runs once before the suite starts.
 */
// noinspection JSUnusedGlobalSymbols

/**
 * Prepares the test environment before any suite runs. The suite needs no
 * external services, so nothing is started.
 * @returns A promise that resolves once setup has completed.
 * @example
 * // Jest calls this automatically through the globalSetup option.
 */
export default async function setup(): Promise<void> {
  // No external services are required for the test suite.
}
