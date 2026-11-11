/**
 * @file Core logic of the action. It reports failures through the Actions
 * toolkit, or throws when running under Jest.
 */
import { info, setFailed as actionFailed } from '@actions/core';

/**
 * Marks the action as failed, or throws the message when running under Jest so
 * tests can observe the failure.
 * @param message - Failure message or error to report.
 * @throws When running under Jest, with the message wrapped in an Error.
 * @example
 * setFailed('Could not restore the cache.');
 */
function setFailed(message: string | Error): void {
  if (process.env.JEST_WORKER_ID) {
    throw message instanceof Error ? message : new Error(message);
  } else {
    actionFailed(message);
  }
}

/**
 * Runs the action's main logic. Any error is forwarded to setFailed so the
 * workflow step is marked as failed.
 * @returns A promise that resolves once the logic has completed.
 * @example
 * await run();
 */
export async function run(): Promise<void> {
  try {
    info(
      'action-runner-common: no owned stages yet — composite handles everything.',
    );
  } catch (error) {
    if (error instanceof Error) {
      setFailed(error);
    } else {
      setFailed(String(error));
    }
  }
}
