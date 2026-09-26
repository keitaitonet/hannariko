import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { RUN_LIMITS, runConversation, type ConversationSession, type ConversationPorts } from './run-conversation.ts';
import type { Action } from './action.ts';
import { logger } from '../logging/logger.ts';

describe('runConversation', () => {
  beforeEach(() => { vi.spyOn(logger, 'log').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('ツールが失敗すると、その結果をLLMに渡して再判断し、返信する', async () => {
    const tool: Action = {
      type: 'tool_call',
      tool: { name: 'getConversation', arguments: { around: '3', limit: 100 } },
    };
    const job = { guildId: '1', channelId: '2', messageId: '3' };
    const decide = vi.fn<ConversationSession['decide']>()
      .mockResolvedValueOnce(tool)
      .mockResolvedValueOnce({ type: 'reply', text: '取得できなかった', replyTo: null });
    const ports = {
      prepare: async () => '対象メッセージと現在の履歴',
      createSession: () => ({ decide }),
      execute: vi.fn<ConversationPorts['execute']>().mockRejectedValue(new Error('SDK内部の詳細')),
      reply: vi.fn<ConversationPorts['reply']>().mockResolvedValue('4'),
    } satisfies ConversationPorts;

    assert.deepEqual(await runConversation(job, ports), { type: 'reply', messageId: '4' });
    assert.equal(decide.mock.calls.length, 2);
    const [input, remaining] = decide.mock.calls[1];
    const result = JSON.parse(input).toolResult;
    assert.equal(result.ok, false);
    assert(!result.error.includes('SDK内部'));
    assert.equal(remaining, 9);
    assert.equal(ports.execute.mock.calls.length, 1);
    assert.equal(ports.reply.mock.calls.length, 1);
  });

  it('ツールを10回実行した後でも、最後に沈黙を選んで終了できる', async () => {
    const tool: Action = {
      type: 'tool_call',
      tool: { name: 'getConversation', arguments: { around: '3', limit: 100 } },
    };
    const actions: Action[] = [...Array.from({ length: 10 }, () => tool), { type: 'silent' }];
    const job = { guildId: '1', channelId: '2', messageId: '3' };
    const decide = vi.fn<ConversationSession['decide']>(async () => {
      const action = actions.shift();
      assert(action);
      return action;
    });
    const ports = {
      prepare: async () => '対象メッセージと現在の履歴',
      createSession: () => ({ decide }),
      execute: vi.fn<ConversationPorts['execute']>().mockResolvedValue([]),
      reply: vi.fn<ConversationPorts['reply']>().mockResolvedValue('4'),
    } satisfies ConversationPorts;

    assert.deepEqual(await runConversation(job, ports), { type: 'silent' });
    assert.equal(ports.execute.mock.calls.length, 10);
    assert.equal(decide.mock.calls.at(-1)![1], 0);
    assert.equal(ports.reply.mock.calls.length, 0);
  });

  it('11回目のツール呼び出しを要求されると、実行せずに終了する', async () => {
    const tool: Action = {
      type: 'tool_call',
      tool: { name: 'getConversation', arguments: { around: '3', limit: 100 } },
    };
    const job = { guildId: '1', channelId: '2', messageId: '3' };
    const decide = vi.fn<ConversationSession['decide']>().mockResolvedValue(tool);
    const ports = {
    prepare: async () => '対象メッセージと現在の履歴',
    createSession: () => ({ decide }),
    execute: vi.fn<ConversationPorts['execute']>().mockResolvedValue([]),
    reply: vi.fn<ConversationPorts['reply']>().mockResolvedValue('4'),
    } satisfies ConversationPorts;

    assert.equal((await runConversation(job, ports)).type, 'failed');
    assert.equal(decide.mock.calls.length, 11);
    assert.equal(ports.execute.mock.calls.length, 10);
    assert.equal(ports.reply.mock.calls.length, 0);
  });

  it('LLMの呼び出しが失敗すると、再試行や返信をせずに失敗を記録する', async () => {
    const error = new Error('LLMの呼び出しに失敗');
    const job = { guildId: '1', channelId: '2', messageId: '3' };
    const decide = vi.fn<ConversationSession['decide']>().mockRejectedValue(error);
    const ports = {
      prepare: async () => '対象メッセージと現在の履歴',
      createSession: () => ({ decide }),
      execute: vi.fn<ConversationPorts['execute']>().mockResolvedValue([]),
      reply: vi.fn<ConversationPorts['reply']>().mockResolvedValue('4'),
    } satisfies ConversationPorts;

    assert.deepEqual(await runConversation(job, ports), { type: 'failed', error });
    assert.equal(decide.mock.calls.length, 1);
    assert.equal(ports.reply.mock.calls.length, 0);
    assert.deepEqual(vi.mocked(logger.log).mock.calls.at(-1)![0], {
      type: 'finished', outcome: { type: 'failed', error },
    });
  });

  it('LLMが時間切れの後に応答しても、返信しない', async () => {
    const controller = new AbortController();
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    // 標準タイマーの動作ではなく、中断通知を受けた後の挙動を確認する。
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(delay =>
      delay === RUN_LIMITS.modelMs ? controller.signal : timeout(delay));
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<Action>();
    const job = { guildId: '1', channelId: '2', messageId: '3' };
    const decide = vi.fn<ConversationSession['decide']>(async () => {
      started.resolve();
      return response.promise;
    });
    const ports = {
      prepare: async () => '対象メッセージと現在の履歴',
      createSession: () => ({ decide }),
      execute: vi.fn<ConversationPorts['execute']>().mockResolvedValue([]),
      reply: vi.fn<ConversationPorts['reply']>().mockResolvedValue('4'),
    } satisfies ConversationPorts;

    const run = runConversation(job, ports);
    await started.promise;
    controller.abort(new DOMException('時間切れ', 'TimeoutError'));
    assert.equal((await run).type, 'failed');
    assert.equal(decide.mock.calls[0][2].aborted, true);
    response.resolve({ type: 'reply', text: '遅れて届いた返信', replyTo: null });
    await response.promise;
    assert.equal(ports.reply.mock.calls.length, 0);
  });

  it('入力準備中に全体の時間制限に達すると、LLMを呼ばずに終了する', async () => {
    const controller = new AbortController();
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    // 標準タイマーの動作ではなく、中断通知を受けた後の挙動を確認する。
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(delay =>
      delay === RUN_LIMITS.jobMs ? controller.signal : timeout(delay));
    const preparation = Promise.withResolvers<string>();
    const job = { guildId: '1', channelId: '2', messageId: '3' };
    const decide = vi.fn<ConversationSession['decide']>().mockResolvedValue({ type: 'silent' });
    const ports = {
      prepare: async () => preparation.promise,
      createSession: () => ({ decide }),
      execute: vi.fn<ConversationPorts['execute']>().mockResolvedValue([]),
      reply: vi.fn<ConversationPorts['reply']>().mockResolvedValue('4'),
    } satisfies ConversationPorts;

    const run = runConversation(job, ports);
    controller.abort(new DOMException('時間切れ', 'TimeoutError'));
    assert.equal((await run).type, 'failed');
    preparation.resolve('遅れて取得された入力');
    await preparation.promise;
    assert.equal(decide.mock.calls.length, 0);
    assert.equal(ports.reply.mock.calls.length, 0);
  });
});
