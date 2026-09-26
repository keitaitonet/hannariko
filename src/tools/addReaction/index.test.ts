import assert from 'node:assert/strict';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelType, Client } from 'discord.js';
import { addReaction } from './index.ts';

describe('addReaction.execute', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('既知のメッセージには、再取得せず同じチャンネルでリアクションを付ける', async () => {
    const client = new Client({ intents: [] });
    const get = vi.spyOn(client.rest, 'get')
      .mockResolvedValueOnce({ id: '1', name: 'サーバー' })
      .mockResolvedValueOnce({ id: '2', guild_id: '1', type: ChannelType.GuildText, name: '雑談' })
      .mockResolvedValueOnce({ id: '7', username: 'Bot', bot: true });
    const put = vi.spyOn(client.rest, 'put').mockResolvedValue(undefined);
    try {
      await client.guilds.fetch('1');
      const channel = await client.channels.fetch('2');
      assert(channel?.type === ChannelType.GuildText);
      const self = await client.users.fetch('7');
      get.mockClear();

      await addReaction.execute({ messageId: '3', emoji: '👍' }, {
        channel, self, targetMessageId: '3', visibleMessageIds: new Set(['3']),
        memory: { read: vi.fn(), update: vi.fn() },
      }, new AbortController().signal);

      assert.equal(get.mock.calls.length, 0);
      expect(put).toHaveBeenCalledExactlyOnceWith('/channels/2/messages/3/reactions/%F0%9F%91%8D/@me');
    } finally {
      await client.destroy();
    }
  });

  it('取得していないメッセージには、リアクションを付けない', async () => {
    const client = new Client({ intents: [] });
    vi.spyOn(client.rest, 'get')
      .mockResolvedValueOnce({ id: '1', name: 'サーバー' })
      .mockResolvedValueOnce({ id: '2', guild_id: '1', type: ChannelType.GuildText, name: '雑談' })
      .mockResolvedValueOnce({ id: '7', username: 'Bot', bot: true });
    const put = vi.spyOn(client.rest, 'put').mockRejectedValue(new Error('呼び出してはいけない'));
    try {
      await client.guilds.fetch('1');
      const channel = await client.channels.fetch('2');
      assert(channel?.type === ChannelType.GuildText);

      const self = await client.users.fetch('7');
      await assert.rejects(addReaction.execute({ messageId: '8', emoji: '👍' }, {
        channel, self, targetMessageId: '3', visibleMessageIds: new Set(['3']),
        memory: { read: vi.fn(), update: vi.fn() },
      }, new AbortController().signal), /リアクション先/);

      assert.equal(put.mock.calls.length, 0);
    } finally {
      await client.destroy();
    }
  });
});
