import { Client, Events, GatewayIntentBits, type Message } from 'discord.js';
import { Queue } from '../conversation/queue.ts';
import { logger } from '../logging/logger.ts';

export function createDiscordClient(
  guildId: string,
  processMessage: (message: Message<true>) => Promise<void>,
) {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    allowedMentions: { parse: [], repliedUser: false },
    rest: { retries: 0, timeout: 30_000 },
  });
  const queue = new Queue();

  client.once(Events.ClientReady, () => {
    logger.log({ type: 'discord_ready', guildId });
  });
  client.on(Events.Error, error => { logger.log({ type: 'discord_error', error }); });
  client.on(Events.ShardError, error => { logger.log({ type: 'discord_error', error }); });
  client.on(Events.MessageCreate, message => {
    if (!message.inGuild() || message.guildId !== guildId) return;
    if (message.author.bot || message.webhookId || message.system) return;

    // 履歴取得から応答の完了までを、キューの一つの処理として扱う。
    void queue.enqueue(() => processMessage(message)).catch(error => {
      logger.log({
        type: 'discord_message_error', guildId,
        channelId: message.channelId, messageId: message.id, error,
      });
    });
  });

  return client;
}
