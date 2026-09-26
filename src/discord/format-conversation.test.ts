import assert from 'node:assert/strict';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelType, Client, MessageType } from 'discord.js';
import { formatConversation } from './format-conversation.ts';

describe('formatConversation', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('会話の順番と本文を保ち、表示名・返信先・添付などを会話入力へ整形する', async () => {
    const client = new Client({ intents: [] });
    const get = vi.spyOn(client.rest, 'get')
      .mockResolvedValueOnce({ id: '1', name: 'サーバー' })
      .mockResolvedValueOnce({ id: '2', guild_id: '1', type: ChannelType.GuildText, name: '雑談', topic: '気軽に話す場所' })
      .mockResolvedValueOnce({ id: '7', username: 'Bot', bot: true })
      .mockResolvedValueOnce([
        {
          id: '1552011035240701983', channel_id: '2', type: MessageType.Default,
          content: 'おれは，', author: { id: '5', username: 'user', global_name: '表示名' },
          member: { nick: 'えぐち', roles: [] },
        },
        {
          id: '1552011035240701984', channel_id: '2', type: MessageType.Reply,
          content: 'こうだと思う\n', author: { id: '5', username: 'user', global_name: '表示名' },
          message_reference: { message_id: '1552011035240701983', channel_id: '2' },
          edited_timestamp: '2026-09-26T01:00:00.000Z',
          attachments: [{ id: '8', filename: '画像.png', content_type: 'image/png', size: 123, width: 640, height: 480, url: 'https://example.com/signed', proxy_url: 'https://example.com/proxy' }],
          embeds: [{ title: '記事', description: '紹介文', url: 'https://example.com', fields: [{ name: '項目', value: '内容' }] }],
          sticker_items: [{ id: '9', name: 'こんにちは', format_type: 1 }],
          reactions: [{ count: 2, count_details: { normal: 2, burst: 0 }, me: true, emoji: { id: null, name: '👍' } }],
        },
      ]);
    try {
      await client.guilds.fetch('1');
      const channel = await client.channels.fetch('2');
      assert(channel?.type === ChannelType.GuildText);
      const self = await client.users.fetch('7');
      Object.defineProperty(client, 'user', { value: self });
      const messages = [...(await channel.messages.fetch({ limit: 100, cache: false })).values()];
      get.mockClear();

      const input = formatConversation(self, channel, messages[1]!.id, messages);

      expect(input).toMatchObject({
        self: { id: '7', name: 'Bot' },
        channel: { id: '2', name: '雑談', topic: '気軽に話す場所', parent: null },
        targetMessageId: messages[1]!.id,
      });
      expect(input.messages.map(message => message.content)).toEqual(['おれは，', 'こうだと思う\n']);
      expect(input.messages[1]).toMatchObject({
        author: { id: '5', name: 'えぐち', bot: false },
        webhook: false, type: 'Reply', replyTo: messages[0]!.id,
        createdAt: messages[1]!.createdAt.toISOString(), editedAt: '2026-09-26T01:00:00.000Z',
        attachments: [{ id: '8', name: '画像.png', contentType: 'image/png', size: 123, width: 640, height: 480 }],
        embeds: [{ title: '記事', description: '紹介文', url: 'https://example.com', fields: [{ name: '項目', value: '内容' }] }],
        stickers: [{ id: '9', name: 'こんにちは', description: null }],
        reactions: [{ emoji: { id: null, name: '👍' }, count: 2, me: true }],
      });
      expect(input.messages[1]!.attachments[0]).not.toHaveProperty('url');
      expect(get).not.toHaveBeenCalled();
    } finally {
      await client.destroy();
    }
  });

  it('未キャッシュのメンション先とスレッドの親は、追加取得せずIDを残す', async () => {
    const client = new Client({ intents: [] });
    const get = vi.spyOn(client.rest, 'get')
      .mockResolvedValueOnce({ id: '1', name: 'サーバー' })
      .mockResolvedValueOnce({ id: '2', guild_id: '1', parent_id: '9', type: ChannelType.PublicThread, name: '投稿' })
      .mockResolvedValueOnce({ id: '7', username: 'Bot', bot: true })
      .mockResolvedValueOnce([{
        id: '1552011035240701983', channel_id: '2', type: MessageType.Default,
        content: '<@1552011035240701991> <@&1552011035240701992> <#1552011035240701993> @everyone',
        mention_everyone: true, author: { id: '5', username: '投稿者' },
      }]);
    try {
      await client.guilds.fetch('1');
      const channel = await client.channels.fetch('2');
      assert(channel?.type === ChannelType.PublicThread);
      const self = await client.users.fetch('7');
      Object.defineProperty(client, 'user', { value: self });
      const messages = [...(await channel.messages.fetch({ limit: 100, cache: false })).values()];
      get.mockClear();

      const input = formatConversation(self, channel, messages[0]!.id, messages);

      expect(input.channel.parent).toEqual({ id: '9', name: null, topic: null });
      expect(input.messages[0]!.mentions).toEqual({
        users: [{ id: '1552011035240701991', name: null }],
        roles: [{ id: '1552011035240701992', name: null }],
        channels: [{ id: '1552011035240701993', name: null }],
        everyone: true,
      });
      expect(get).not.toHaveBeenCalled();
    } finally {
      await client.destroy();
    }
  });
});
