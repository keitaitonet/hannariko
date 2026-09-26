import type { GuildTextBasedChannel, User } from 'discord.js';
import type { MemoryRepository } from '../memory/index.ts';

// 実行中の投稿から決まる情報で、LLMには指定させない。
export type ToolContext = {
  channel: GuildTextBasedChannel;
  self: User;
  targetMessageId: string;
  visibleMessageIds: Set<string>;
  memory: MemoryRepository;
};
