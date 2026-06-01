import { info, setFailed as actionFailed } from '@actions/core';

function setFailed(message: string | Error): void {
  if (process.env.JEST_WORKER_ID) {
    if (message instanceof Error) {
      throw message;
    } else {
      throw new Error(message);
    }
  } else {
    actionFailed(message);
  }
}

export async function run(): Promise<void> {
  try {
    info(
      'action-runner-common: no owned stages yet — composite handles everything.',
    );
  } catch (err) {
    if (err instanceof Error) {
      setFailed(err);
    } else {
      setFailed(err as unknown as string);
    }
  }
}
