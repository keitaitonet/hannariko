import type { GuildTextBasedChannel, MessageCreateOptions } from 'discord.js';
import type { Action } from '../conversation/action.ts';
import { logger } from '../logging/logger.ts';

export async function reply(
  action: Extract<Action, { type: 'reply' }>,
  channel: GuildTextBasedChannel,
  visibleMessageIds: ReadonlySet<string>,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  if (action.replyTo !== null && !visibleMessageIds.has(action.replyTo)) {
    throw new Error('返信先は、この会話で取得したメッセージに限ります');
  }

  const options: MessageCreateOptions = {
    content: action.text,
    allowedMentions: { parse: [], repliedUser: false },
  };
  if (action.replyTo !== null) {
    options.reply = { messageReference: action.replyTo, failIfNotExists: true };
  }
  const message = await channel.send(options);
  logger.log({ type: 'discord_reply', channelId: channel.id, message: message.toJSON() });
  signal.throwIfAborted();
  return message.id;
}
