import assert from 'node:assert/strict';
import { afterEach, describe, it, vi } from 'vitest';
import { ChannelType, Client } from 'discord.js';
import { logger } from '../../logging/logger.ts';
import { getConversation } from './index.ts';

describe('getConversation.execute', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('対象の前後100件をAPIに要求し、取得した会話を古い順で返す', async () => {
    const client = new Client({ intents: [] });
    vi.spyOn(logger, 'log').mockImplementation(() => {});
    const get = vi.spyOn(client.rest, 'get')
      .mockResolvedValueOnce({ id: '1', name: 'サーバー' })
      .mockResolvedValueOnce({ id: '2', guild_id: '1', type: ChannelType.GuildText, name: '雑談' })
      .mockResolvedValueOnce({ id: '7', username: 'Bot', bot: true })
      .mockResolvedValueOnce([
        { id: '4', channel_id: '2', guild_id: '1', type: 0, content: '続き', author: { id: '5', username: '参加者' }, timestamp: '2026-09-26T00:00:01Z' },
        { id: '3', channel_id: '2', guild_id: '1', type: 0, content: '最初', author: { id: '5', username: '参加者' }, timestamp: '2026-09-26T00:00:00Z' },
      ]);
    try {
      await client.guilds.fetch('1');
      const channel = await client.channels.fetch('2');
      assert(channel?.type === ChannelType.GuildText);

      const self = await client.users.fetch('7');
      const visibleMessageIds = new Set<string>();
      const { messages } = await getConversation.execute({ around: '3', limit: 100 }, {
        channel, self, targetMessageId: '3', visibleMessageIds,
        memory: { read: async () => ({ version: null, text: '' }), update: vi.fn() },
      }, new AbortController().signal);

      assert.deepEqual(messages.map(message => message.id), ['3', '4']);
      assert.deepEqual(messages.map(message => message.content), ['最初', '続き']);
      const [route, options] = get.mock.calls.at(-1)!;
      assert.equal(route, '/channels/2/messages');
      assert.equal(options?.query?.get('around'), '3');
      assert.equal(options?.query?.get('limit'), '100');
      assert.equal(channel.messages.cache.size, 0);
      assert.deepEqual([...visibleMessageIds], ['3', '4']);
    } finally {
      await client.destroy();
    }
  });

  it('スレッドの履歴を取得中に中断されたら、遅れて届いた結果を返さない', async () => {
    const client = new Client({ intents: [] });
    vi.spyOn(logger, 'log').mockImplementation(() => {});
    const response = Promise.withResolvers<unknown>();
    vi.spyOn(client.rest, 'get')
      .mockResolvedValueOnce({ id: '1', name: 'サーバー' })
      .mockResolvedValueOnce({ id: '2', guild_id: '1', parent_id: '9', type: ChannelType.PublicThread, name: '投稿' })
      .mockResolvedValueOnce({ id: '7', username: 'Bot', bot: true })
      .mockImplementationOnce(() => response.promise);
    try {
      await client.guilds.fetch('1');
      const channel = await client.channels.fetch('2');
      assert(channel?.type === ChannelType.PublicThread);
      const self = await client.users.fetch('7');
      const controller = new AbortController();
      const visibleMessageIds = new Set<string>();
      const read = vi.fn();
      const result = getConversation.execute({ before: '3', limit: 10 }, {
        channel, self, targetMessageId: '3', visibleMessageIds,
        memory: { read, update: vi.fn() },
      }, controller.signal);
      const error = new Error('時間切れ');
      const failure = assert.rejects(result, caught => caught === error);

      controller.abort(error);
      response.resolve([]);

      await failure;
      assert.equal(visibleMessageIds.size, 0);
      assert.equal(read.mock.calls.length, 0);
    } finally {
      await client.destroy();
    }
  });
});
