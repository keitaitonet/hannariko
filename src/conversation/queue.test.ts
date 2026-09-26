import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { Queue } from './queue.ts';

describe('Queue', () => {
  it('空のキューに追加すると、実行されて結果が返る', async () => {
    const queue = new Queue();

    assert.equal(await queue.enqueue(async () => 42), 42);
  });

  it('実行中に追加すると、先行処理の完了後に追加順で実行される', async () => {
    const queue = new Queue();
    const started = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    const events: string[] = [];

    const first = queue.enqueue(async () => {
      events.push('first start');
      started.resolve();
      await gate.promise;
      events.push('first end');
      return 'first result';
    });
    await started.promise;

    const second = queue.enqueue(async () => {
      events.push('second');
      return 'second result';
    });
    const third = queue.enqueue(async () => {
      events.push('third');
      return 'third result';
    });

    await Promise.resolve();
    assert.deepEqual(events, ['first start']);
    gate.resolve();
    assert.deepEqual(await Promise.all([first, second, third]), [
      'first result', 'second result', 'third result',
    ]);
    assert.deepEqual(events, ['first start', 'first end', 'second', 'third']);
  });

  it('先行処理が失敗しても、待機中の処理は実行される', async () => {
    const queue = new Queue();
    const error = new Error('failed');
    const started = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    const events: string[] = [];

    const first = queue.enqueue(async () => {
      events.push('first start');
      started.resolve();
      await gate.promise;
      events.push('first failed');
      throw error;
    });
    const failure = assert.rejects(first, (caught) => caught === error);
    await started.promise;
    const second = queue.enqueue(async () => {
      events.push('second');
      return 42;
    });

    await Promise.resolve();
    assert.deepEqual(events, ['first start']);
    gate.resolve();
    await failure;
    assert.equal(await second, 42);
    assert.deepEqual(events, ['first start', 'first failed', 'second']);
  });
});
