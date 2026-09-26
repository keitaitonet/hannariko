// 処理を追加順に実行し、失敗しても次の処理へ進む。
export class Queue {
  private tail: Promise<void> = Promise.resolve();

  enqueue<T>(run: () => Promise<T>): Promise<T> {
    const result = this.tail.then(run);
    this.tail = result.then(() => {}, () => {});
    return result;
  }
}
