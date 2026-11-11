import { info, setFailed as actionFailed } from '@actions/core';

function setFailed(message: string | Error): void {
  if (process.env.JEST_WORKER_ID) {
    throw message instanceof Error ? message : new Error(message);
  } else {
    actionFailed(message);
  }
}

export async function run(): Promise<void> {
  try {
    info(
      'action-runner-common: no owned stages yet — composite handles everything.',
    );
  } catch (error) {
    if (error instanceof Error) {
      setFailed(error);
    } else {
      setFailed(error as unknown as string);
    }
  }
}
