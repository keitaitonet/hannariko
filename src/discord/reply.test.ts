import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelType, Client } from 'discord.js';
import { reply } from './reply.ts';
import { logger } from '../logging/logger.ts';

describe('reply', () => {
  beforeEach(() => { vi.spyOn(logger, 'log').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('返信先を指定しない場合は、本文にメンションがあっても通知を無効にして通常投稿する', async () => {
    const client = new Client({ intents: [] });
    vi.spyOn(client.rest, 'get')
      .mockResolvedValueOnce({ id: '1', name: 'サーバー' })
      .mockResolvedValueOnce({ id: '2', guild_id: '1', type: ChannelType.GuildText, name: '雑談' });
    const post = vi.spyOn(client.rest, 'post').mockResolvedValue({
      id: '4', channel_id: '2', guild_id: '1', type: 0,
      content: '@everyone <@5> <@&6>', author: { id: '7', username: 'Bot', bot: true },
    });
    try {
      await client.guilds.fetch('1');
      const channel = await client.channels.fetch('2');
      assert(channel?.type === ChannelType.GuildText);

      const id = await reply({ type: 'reply', text: '@everyone <@5> <@&6>', replyTo: null }, channel, new Set(), new AbortController().signal);

      assert.equal(id, '4');
      expect(post).toHaveBeenCalledExactlyOnceWith('/channels/2/messages', expect.objectContaining({
        body: expect.objectContaining({
          content: '@everyone <@5> <@&6>',
          allowed_mentions: { parse: [], replied_user: false },
          message_reference: undefined,
        }),
      }));
    } finally {
      await client.destroy();
    }
  });

  it('スレッド内の既知の投稿へ返信すると、同じスレッドへ返信先付きで送信する', async () => {
    const client = new Client({ intents: [] });
    vi.spyOn(client.rest, 'get')
      .mockResolvedValueOnce({ id: '1', name: 'サーバー' })
      .mockResolvedValueOnce({ id: '2', guild_id: '1', parent_id: '9', type: ChannelType.PublicThread, name: '投稿' });
    const post = vi.spyOn(client.rest, 'post').mockResolvedValue({
      id: '4', channel_id: '2', guild_id: '1', type: 19,
      content: 'そうだね', author: { id: '7', username: 'Bot', bot: true },
    });
    try {
      await client.guilds.fetch('1');
      const channel = await client.channels.fetch('2');
      assert(channel?.type === ChannelType.PublicThread);

      await reply({ type: 'reply', text: 'そうだね', replyTo: '3' }, channel, new Set(['3']), new AbortController().signal);

      expect(post).toHaveBeenCalledExactlyOnceWith('/channels/2/messages', expect.objectContaining({
        body: expect.objectContaining({
          allowed_mentions: { parse: [], replied_user: false },
          message_reference: expect.objectContaining({ message_id: '3', fail_if_not_exists: true }),
        }),
      }));
    } finally {
      await client.destroy();
    }
  });

  it('会話で取得していない返信先を指定されると、Discordへ送信しない', async () => {
    const client = new Client({ intents: [] });
    vi.spyOn(client.rest, 'get')
      .mockResolvedValueOnce({ id: '1', name: 'サーバー' })
      .mockResolvedValueOnce({ id: '2', guild_id: '1', type: ChannelType.GuildText, name: '雑談' });
    const post = vi.spyOn(client.rest, 'post').mockRejectedValue(new Error('呼び出してはいけない'));
    try {
      await client.guilds.fetch('1');
      const channel = await client.channels.fetch('2');
      assert(channel?.type === ChannelType.GuildText);

      await assert.rejects(reply({ type: 'reply', text: '返信', replyTo: '8' }, channel, new Set(['3']), new AbortController().signal), /返信先/);

      assert.equal(post.mock.calls.length, 0);
    } finally {
      await client.destroy();
    }
  });
});
