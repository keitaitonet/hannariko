// アダプターはこのシグナルを I/O に渡し、書き込みや送信の前にも中断されていないか確認する。
// 外部サービスが受理済みの操作は、タイムアウトしても取り消せない。
export async function withDeadline<T>(
  milliseconds: number,
  parent: AbortSignal | undefined,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeout = AbortSignal.timeout(milliseconds);
  const signal = parent ? AbortSignal.any([parent, timeout]) : timeout;
  signal.throwIfAborted();

  const aborted = Promise.withResolvers<never>();
  const onAbort = () => aborted.reject(signal.reason);
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    // 処理の完了か中断通知を待つ。中断に応じない処理の終了までは待たない。
    return await Promise.race([work(signal), aborted.promise]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
