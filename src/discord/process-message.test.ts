import assert from 'node:assert/strict';
import { ChannelType, Client } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationSession } from '../conversation/run-conversation.ts';
import { logger } from '../logging/logger.ts';
import type { MemoryRepository } from '../memory/index.ts';
import { processMessage } from './process-message.ts';

describe('processMessage', () => {
  beforeEach(() => { vi.spyOn(logger, 'log').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('初期履歴と追加履歴を同じ形式で渡し、追加取得した投稿へリアクションと返信ができる', async () => {
    const client = new Client({ intents: [] });
    const target = { id: '30', channel_id: '2', type: 0, content: 'どう思う？', author: { id: '5', username: '参加者' } };
    const older = { ...target, id: '20', content: '前の話', author: { id: '6', username: '別の参加者' } };
    const get = vi.spyOn(client.rest, 'get')
      .mockResolvedValueOnce({ id: '1', name: 'サーバー' })
      .mockResolvedValueOnce({ id: '2', guild_id: '1', type: ChannelType.GuildText, name: '雑談' })
      .mockResolvedValueOnce({ id: '7', username: 'Bot', bot: true })
      .mockResolvedValueOnce([target]);
    const put = vi.spyOn(client.rest, 'put').mockResolvedValue(undefined);
    const post = vi.spyOn(client.rest, 'post').mockResolvedValue({ ...target, id: '40', content: 'いいと思う' });
    const decide = vi.fn<ConversationSession['decide']>()
      .mockResolvedValueOnce({ type: 'tool_call', tool: { name: 'getConversation', arguments: { before: '30', limit: 50 } } })
      .mockResolvedValueOnce({ type: 'tool_call', tool: { name: 'addReaction', arguments: { messageId: '20', emoji: '👍' } } })
      .mockResolvedValueOnce({ type: 'reply', text: 'いいと思う', replyTo: '20' });
    const memory = {
      read: vi.fn<MemoryRepository['read']>(async target =>
        target.type === 'user' && target.userId === '5'
          ? { version: 'b88b3ce5-1cc6-44a5-b4c5-374cc424bc81', text: '技術の話が好き' }
          : { version: null, text: '' }),
      update: vi.fn<MemoryRepository['update']>(),
    };
    try {
      await client.guilds.fetch('1');
      const channel = await client.channels.fetch('2');
      assert(channel?.type === ChannelType.GuildText);
      const self = await client.users.fetch('7');
      Object.defineProperty(client, 'user', { value: self });
      const message = (await channel.messages.fetch({ limit: 1 })).get('30');
      assert(message);
      get.mockClear();
      get.mockResolvedValueOnce([target]).mockResolvedValueOnce([older]);

      const outcome = await processMessage(message, { createSession: () => ({ decide }), memory });

      expect(outcome).toEqual({ type: 'reply', messageId: '40' });
      expect(get.mock.calls.map(([, options]) => Object.fromEntries(options?.query ?? []))).toEqual([
        { around: '30', limit: '10' }, { before: '30', limit: '50' },
      ]);
      const initial = JSON.parse(decide.mock.calls[0]![0]);
      const additional = JSON.parse(decide.mock.calls[1]![0]).toolResult;
      expect(initial).toMatchObject({ targetMessageId: '30', messages: [{ id: '30', content: 'どう思う？' }] });
      expect(additional).toMatchObject({ name: 'getConversation', ok: true, data: {
        self: initial.self, channel: initial.channel, targetMessageId: '30',
        messages: [{ id: '20', content: '前の話' }],
      } });
      expect(initial.userMemories).toEqual([{ userId: '5', version: 'b88b3ce5-1cc6-44a5-b4c5-374cc424bc81', text: '技術の話が好き' }]);
      expect(initial.channelMemory).toEqual({ version: null, text: '' });
      expect(initial.personality).toEqual({ version: null, text: '' });
      expect(additional.data.userMemories).toEqual([{ userId: '6', version: null, text: '' }]);
      expect(additional.data).not.toHaveProperty('channelMemory');
      expect(additional.data).not.toHaveProperty('personality');
      expect(memory.read.mock.calls.map(([target]) => target)).toEqual(expect.arrayContaining([
        { type: 'user', guildId: '1', userId: '5' },
        { type: 'user', guildId: '1', userId: '6' },
        { type: 'channel', guildId: '1', channelId: '2' },
        { type: 'personality', guildId: '1' },
      ]));
      expect(memory.read).toHaveBeenCalledTimes(4);
      expect(put).toHaveBeenCalledOnce();
      expect(post).toHaveBeenCalledWith('/channels/2/messages', expect.objectContaining({ body: expect.objectContaining({
        message_reference: expect.objectContaining({ message_id: '20' }),
      }) }));
      expect(memory.update).not.toHaveBeenCalled();
    } finally {
      await client.destroy();
    }
  });

  it('初期履歴を取得できなければ、LLMの判断や投稿へ進まず失敗として終了する', async () => {
    const client = new Client({ intents: [] });
    const get = vi.spyOn(client.rest, 'get')
      .mockResolvedValueOnce({ id: '1', name: 'サーバー' })
      .mockResolvedValueOnce({ id: '2', guild_id: '1', type: ChannelType.GuildText, name: '雑談' })
      .mockResolvedValueOnce([{ id: '30', channel_id: '2', type: 0, content: 'こんにちは', author: { id: '5', username: '参加者' } }]);
    const decide = vi.fn<ConversationSession['decide']>();
    const memory: MemoryRepository = {
      read: async () => ({ version: null, text: '' }),
      update: vi.fn(),
    };
    const post = vi.spyOn(client.rest, 'post');
    try {
      await client.guilds.fetch('1');
      const channel = await client.channels.fetch('2');
      assert(channel?.type === ChannelType.GuildText);
      const message = (await channel.messages.fetch({ limit: 1 })).get('30');
      assert(message);
      const error = new Error('履歴取得に失敗');
      get.mockRejectedValueOnce(error);

      expect(await processMessage(message, { createSession: () => ({ decide }), memory })).toEqual({ type: 'failed', error });
      expect(decide).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
    } finally {
      await client.destroy();
    }
  });

  it('記憶の更新結果と競合をLLMへ返し、更新先を現在のguildに限定する', async () => {
    const client = new Client({ intents: [] });
    const target = { id: '30', channel_id: '2', type: 0, content: 'こんにちは', author: { id: '5', username: '参加者' } };
    vi.spyOn(client.rest, 'get')
      .mockResolvedValueOnce({ id: '1', name: 'サーバー' })
      .mockResolvedValueOnce({ id: '2', guild_id: '1', type: ChannelType.GuildText, name: '雑談' })
      .mockResolvedValueOnce({ id: '7', username: 'Bot', bot: true })
      .mockResolvedValueOnce([target])
      .mockResolvedValueOnce([target]);
    const updated = { version: 'b88b3ce5-1cc6-44a5-b4c5-374cc424bc81', text: '技術の話が好き' };
    const memory = {
      read: vi.fn<MemoryRepository['read']>().mockResolvedValue({ version: null, text: '' }),
      update: vi.fn<MemoryRepository['update']>()
        .mockResolvedValueOnce({ status: 'saved', memory: updated })
        .mockResolvedValueOnce({ status: 'conflict' }),
    };
    const decide = vi.fn<ConversationSession['decide']>()
      .mockResolvedValueOnce({ type: 'tool_call', tool: { name: 'setUserMemory', arguments: { userId: '5', readVersion: null, text: updated.text } } })
      .mockResolvedValueOnce({ type: 'tool_call', tool: { name: 'setUserMemory', arguments: { userId: '5', readVersion: null, text: '別の記憶' } } })
      .mockResolvedValueOnce({ type: 'silent' });
    try {
      await client.guilds.fetch('1');
      const channel = await client.channels.fetch('2');
      assert(channel?.type === ChannelType.GuildText);
      const self = await client.users.fetch('7');
      Object.defineProperty(client, 'user', { value: self });
      const message = (await channel.messages.fetch({ limit: 1 })).get('30');
      assert(message);

      expect(await processMessage(message, { createSession: () => ({ decide }), memory })).toEqual({ type: 'silent' });

      expect(memory.update.mock.calls.map(([target, input]) => [target, input])).toEqual([
        [{ type: 'user', guildId: '1', userId: '5' }, { readVersion: null, text: updated.text }],
        [{ type: 'user', guildId: '1', userId: '5' }, { readVersion: null, text: '別の記憶' }],
      ]);
      expect(JSON.parse(decide.mock.calls[1]![0]).toolResult).toEqual({
        name: 'setUserMemory', ok: true, data: { status: 'saved', memory: updated },
      });
      expect(JSON.parse(decide.mock.calls[2]![0]).toolResult).toEqual({
        name: 'setUserMemory', ok: true, data: { status: 'conflict' },
      });
    } finally {
      await client.destroy();
    }
  });

});
