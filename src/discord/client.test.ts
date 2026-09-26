import assert from 'node:assert/strict';
import { afterEach, describe, it, vi } from 'vitest';
import { ChannelType, Events, type Message } from 'discord.js';
import { createDiscordClient } from './client.ts';
import { logger } from '../logging/logger.ts';

describe('createDiscordClient', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('対象外の投稿が混ざっていても、指定guildの人間の新着だけを処理する', async () => {
    vi.spyOn(logger, 'log').mockImplementation(() => {});
    const finished = Promise.withResolvers<void>();
    const processMessage = vi.fn(async (message: Message<true>) => {
      if (message.id === '16') finished.resolve();
    });
    const client = createDiscordClient('1', processMessage);
    vi.spyOn(client.rest, 'get')
      .mockResolvedValueOnce({ id: '1', name: 'サーバー' })
      .mockResolvedValueOnce({ id: '2', guild_id: '1', type: ChannelType.GuildText, name: '雑談' })
      .mockResolvedValueOnce([
        { id: '11', channel_id: '2', guild_id: '1', type: 0, author: { id: '5', username: 'Bot', bot: true } },
        { id: '12', channel_id: '2', guild_id: '1', type: 0, webhook_id: '8', author: { id: '6', username: 'Webhook' } },
        { id: '13', channel_id: '2', guild_id: '1', type: 7, author: { id: '7', username: '参加者' } },
        { id: '14', channel_id: '20', guild_id: '10', type: 0, author: { id: '7', username: '参加者' } },
        { id: '15', channel_id: '30', type: 0, author: { id: '7', username: '参加者' } },
        { id: '16', channel_id: '2', guild_id: '1', type: 0, author: { id: '7', username: '参加者' } },
      ]);
    try {
      await client.guilds.fetch('1');
      const channel = await client.channels.fetch('2');
      assert(channel?.type === ChannelType.GuildText);
      const messages = await channel.messages.fetch({ limit: 6, cache: false });

      for (const message of messages.values()) client.emit(Events.MessageCreate, message);
      await finished.promise;

      assert.deepEqual(processMessage.mock.calls.map(([message]) => message.id), ['16']);
    } finally {
      await client.destroy();
    }
  });

  it('処理中に次の投稿が届いたら待機し、先行処理が失敗しても次へ進む', async () => {
    const log = vi.spyOn(logger, 'log').mockImplementation(() => {});
    const started = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<void>();
    const error = new Error('会話処理に失敗');
    const processMessage = vi.fn(async (message: Message<true>) => {
      if (message.id === '3') {
        started.resolve();
        await gate.promise;
        throw error;
      }
      finished.resolve();
    });
    const client = createDiscordClient('1', processMessage);
    vi.spyOn(client.rest, 'get')
      .mockResolvedValueOnce({ id: '1', name: 'サーバー' })
      .mockResolvedValueOnce({ id: '2', guild_id: '1', parent_id: '9', type: ChannelType.PublicThread, name: '投稿' })
      .mockResolvedValueOnce([
        { id: '3', channel_id: '2', guild_id: '1', type: 0, author: { id: '5', username: '参加者' } },
        { id: '4', channel_id: '2', guild_id: '1', type: 0, author: { id: '5', username: '参加者' } },
      ]);
    try {
      await client.guilds.fetch('1');
      const channel = await client.channels.fetch('2');
      assert(channel?.type === ChannelType.PublicThread);
      const messages = await channel.messages.fetch({ limit: 2, cache: false });
      client.emit(Events.MessageCreate, messages.get('3')!);
      await started.promise;
      client.emit(Events.MessageCreate, messages.get('4')!);
      await Promise.resolve();
      assert.deepEqual(processMessage.mock.calls.map(([message]) => message.id), ['3']);

      gate.resolve();
      await finished.promise;

      assert.deepEqual(processMessage.mock.calls.map(([message]) => message.id), ['3', '4']);
      assert.deepEqual(log.mock.calls.at(-1)?.[0], {
        type: 'discord_message_error', guildId: '1', channelId: '2', messageId: '3', error,
      });
    } finally {
      await client.destroy();
    }
  });
});
