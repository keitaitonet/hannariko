import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import OpenAI from 'openai';
import { createActionGenerator } from './generate-action.ts';
import { logger } from '../logging/logger.ts';

describe('createActionGenerator', () => {
  beforeEach(() => { vi.spyOn(logger, 'log').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('JSONとして読めない応答が届くと、エラーを返し再生成しない', async () => {
    const requests: OpenAI.Responses.ResponseCreateParamsNonStreaming[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({
        id: 'resp_test', object: 'response', status: 'completed',
        output: [{
          type: 'message', id: 'msg_test', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: 'JSONではない応答', annotations: [] }],
        }],
      }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    const client = new OpenAI({ apiKey: 'test-only', fetch });
    const generate = createActionGenerator({
      client,
      model: 'test-model',
    });

    await assert.rejects(generate({ instructions: 'テスト用の指示', input: [{ role: 'user', content: 'テスト用の入力' }], signal: new AbortController().signal }), /Invalid JSON/);
    assert.equal(fetch.mock.calls.length, 1);
  });

  it('必要な項目が欠けた行動が届くと、エラーを返し再生成しない', async () => {
    const requests: OpenAI.Responses.ResponseCreateParamsNonStreaming[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({
        id: 'resp_test', object: 'response', status: 'completed',
        output: [{
          type: 'message', id: 'msg_test', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: '{"value":{"type":"reply","text":"こんにちは"}}', annotations: [] }],
        }],
      }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    const client = new OpenAI({ apiKey: 'test-only', fetch });
    const generate = createActionGenerator({
      client,
      model: 'test-model',
    });

    await assert.rejects(generate({ instructions: 'テスト用の指示', input: [{ role: 'user', content: 'テスト用の入力' }], signal: new AbortController().signal }), /validation/);
    assert.equal(fetch.mock.calls.length, 1);
  });

  it('モデルが応答を拒否すると、結果を返さず再試行もしない', async () => {
    const requests: OpenAI.Responses.ResponseCreateParamsNonStreaming[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({
        id: 'resp_test', object: 'response', status: 'completed',
        output: [{
          type: 'message', id: 'msg_test', role: 'assistant', status: 'completed',
          content: [{ type: 'refusal', refusal: 'この要求には応じられません' }],
        }],
      }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    const client = new OpenAI({ apiKey: 'test-only', fetch });
    const generate = createActionGenerator({
      client,
      model: 'test-model',
    });

    await assert.rejects(generate({ instructions: 'テスト用の指示', input: [{ role: 'user', content: 'テスト用の入力' }], signal: new AbortController().signal }), /refused/);
    assert.equal(fetch.mock.calls.length, 1);
  });

  it('応答が未完了の場合は、本文が妥当でも採用せず再試行しない', async () => {
    const requests: OpenAI.Responses.ResponseCreateParamsNonStreaming[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({
        id: 'resp_test', object: 'response', status: 'incomplete',
        output: [{
          type: 'message', id: 'msg_test', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: '{"value":{"type":"silent"}}', annotations: [] }],
        }],
      }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    const client = new OpenAI({ apiKey: 'test-only', fetch });
    const generate = createActionGenerator({
      client,
      model: 'test-model',
    });

    await assert.rejects(generate({ instructions: 'テスト用の指示', input: [{ role: 'user', content: 'テスト用の入力' }], signal: new AbortController().signal }), /incomplete/);
    assert.equal(fetch.mock.calls.length, 1);
  });

  it('APIが500を返すと、SDKの自動リトライをせずエラーを返す', async () => {
    const requests: OpenAI.Responses.ResponseCreateParamsNonStreaming[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ error: { message: '一時的な障害' } }), {
        status: 500, headers: { 'content-type': 'application/json' },
      });
    });
    const client = new OpenAI({ apiKey: 'test-only', fetch });
    const generate = createActionGenerator({
      client,
      model: 'test-model',
    });

    await assert.rejects(generate({ instructions: 'テスト用の指示', input: [{ role: 'user', content: 'テスト用の入力' }], signal: new AbortController().signal }), (error) => error instanceof OpenAI.APIError && error.status === 500);
    assert.equal(fetch.mock.calls.length, 1);
  });
});
