export const CONNECTION_TIMEOUT = 15000;
export async function withTimeout<T>(
  operation: PromiseLike<T>,
  timeout = CONNECTION_TIMEOUT,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              Error(
                "Anslutningen tog för lång tid. Kontrollera nätverket och försök igen.",
              ),
            ),
          timeout,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function timedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const originalSignal =
    init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const abort = () => controller.abort(originalSignal?.reason);
  if (originalSignal?.aborted) abort();
  else originalSignal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), CONNECTION_TIMEOUT);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    originalSignal?.removeEventListener("abort", abort);
  }
}
