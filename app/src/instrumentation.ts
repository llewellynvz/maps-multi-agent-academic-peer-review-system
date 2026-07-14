export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }
  const { createRotatingLog } = await import('server/src/logging/rotating-log');
  createRotatingLog('app').write('info', 'app', 'app server started');
}

export async function onRequestError(
  error: unknown,
  request: { path?: string; method?: string },
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }
  const { createRotatingLog } = await import('server/src/logging/rotating-log');
  const message = error instanceof Error ? error.message : String(error);
  createRotatingLog('app').write('error', 'app', 'request error', {
    message: message.slice(0, 300),
    method: request.method,
    path: request.path,
  });
}
