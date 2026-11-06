/** Polls until `fn` returns a value (not null/undefined) or the time runs out. The mirror node lags a few seconds behind consensus. */
export async function eventually<T>(
  fn: () => Promise<T | null | undefined>,
  options: { timeoutMs?: number; intervalMs?: number; what?: string } = {},
): Promise<T> {
  const {
    timeoutMs = 60_000,
    intervalMs = 3_000,
    what = "condition",
  } = options;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== null && value !== undefined) return value;
    if (Date.now() + intervalMs > deadline)
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
