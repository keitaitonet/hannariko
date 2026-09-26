import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import { createSession } from './session.ts';
import { runConversation, type ConversationPorts } from '../conversation/run-conversation.ts';
import { logger } from '../logging/logger.ts';

describe('createSession', () => {
  beforeEach(() => { vi.spyOn(logger, 'log').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('ツール実行後は、直前のレスポンスIDと新しい結果だけを送り、指示と出力設定も再送する', async () => {
    const requests: OpenAI.Responses.ResponseCreateParamsNonStreaming[] = [];
    const actions = [
      { type: 'tool_call', tool: { name: 'getConversation', arguments: { before: '3', limit: 50 } } },
      { type: 'tool_call', tool: { name: 'getConversation', arguments: { before: '2', limit: 50 } } },
      { type: 'silent' },
    ];
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({
        id: `resp_${requests.length}`, object: 'response', status: 'completed',
        output: [{
          type: 'message', id: `msg_${requests.length}`, role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify({ value: actions.shift() }), annotations: [] }],
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const client = new OpenAI({ apiKey: 'test-only', fetch });
    const execute = vi.fn<ConversationPorts['execute']>()
      .mockResolvedValueOnce('追加の履歴')
      .mockRejectedValueOnce(new Error('取得できませんでした'));
    const ports: ConversationPorts = {
      prepare: async () => '対象投稿と履歴・記憶',
      createSession: () => createSession({ client, model: 'test-model', instructions: 'テスト用の指示' }),
      execute,
      reply: vi.fn(),
    };

    assert.deepEqual(await runConversation({ guildId: '1', channelId: '2', messageId: '3' }, ports), { type: 'silent' });

    assert.deepEqual(requests.map(request => request.previous_response_id), [undefined, 'resp_1', 'resp_2']);
    assert.deepEqual(requests.map(request => request.input), [
      [
        { role: 'developer', content: '今回の残りツール呼び出し回数は10回です。' },
        { role: 'user', content: '対象投稿と履歴・記憶' },
      ],
      [
        { role: 'developer', content: '今回の残りツール呼び出し回数は9回です。' },
        { role: 'user', content: JSON.stringify({ toolResult: { name: 'getConversation', ok: true, data: '追加の履歴' } }) },
      ],
      [
        { role: 'developer', content: '今回の残りツール呼び出し回数は8回です。' },
        { role: 'user', content: JSON.stringify({ toolResult: { name: 'getConversation', ok: false, error: 'Tool execution failed or timed out' } }) },
      ],
    ]);
    assert(requests.every(request => request.store === true));
    assert(requests.every(request => request.instructions?.includes('テスト用の指示')));
    assert(requests.every(request => request.instructions === requests[0].instructions));
    assert.deepEqual(requests[1].text, requests[0].text);
    assert.deepEqual(requests[1].tools, [{ type: 'web_search' }]);
    assert(!JSON.stringify(requests[0].text?.format).includes('"oneOf"'));
    expect(requests[0].text?.format).toMatchObject({
      type: 'json_schema',
      schema: { properties: { value: { anyOf: expect.arrayContaining([
        { type: 'object', properties: expect.objectContaining({
          type: { type: 'string', const: 'tool_call' },
          tool: expect.objectContaining({ anyOf: expect.arrayContaining([
            expect.objectContaining({ properties: expect.objectContaining({
              name: { type: 'string', const: 'getConversation' },
              arguments: { anyOf: expect.arrayContaining([
                expect.objectContaining({ properties: {
                  around: expect.objectContaining({ type: 'string' }),
                  limit: { type: 'integer', minimum: 1, maximum: 100 },
                } }),
              ]) },
            }) }),
          ]) }),
        }), required: ['type', 'tool'], additionalProperties: false },
      ]) } } },
    });
  });

  it('同じ設定で次の投稿を処理しても、前の投稿のレスポンスIDを引き継がない', async () => {
    const requests: OpenAI.Responses.ResponseCreateParamsNonStreaming[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({
        id: `resp_${requests.length}`, object: 'response', status: 'completed',
        output: [{
          type: 'message', id: `msg_${requests.length}`, role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: '{"value":{"type":"silent"}}', annotations: [] }],
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const client = new OpenAI({ apiKey: 'test-only', fetch });
    const ports: ConversationPorts = {
      prepare: vi.fn<ConversationPorts['prepare']>()
        .mockResolvedValueOnce('投稿3の履歴・記憶')
        .mockResolvedValueOnce('投稿4の履歴・記憶'),
      createSession: () => createSession({ client, model: 'test-model', instructions: 'テスト用の指示' }),
      execute: vi.fn(),
      reply: vi.fn(),
    };

    assert.deepEqual(await runConversation({ guildId: '1', channelId: '2', messageId: '3' }, ports), { type: 'silent' });
    assert.deepEqual(await runConversation({ guildId: '1', channelId: '2', messageId: '4' }, ports), { type: 'silent' });

    assert.deepEqual(requests.map(request => request.previous_response_id), [undefined, undefined]);
    assert.deepEqual(requests.map(request => request.input), [
      [
        { role: 'developer', content: '今回の残りツール呼び出し回数は10回です。' },
        { role: 'user', content: '投稿3の履歴・記憶' },
      ],
      [
        { role: 'developer', content: '今回の残りツール呼び出し回数は10回です。' },
        { role: 'user', content: '投稿4の履歴・記憶' },
      ],
    ]);
  });
});
