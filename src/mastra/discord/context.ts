import { DiscordAdapter, DiscordFormatConverter } from "@chat-adapter/discord";
import type { ChannelHandler } from "@mastra/core/channels";
import { z } from "zod";

const snowflake = z.string().regex(/^\d{1,20}$/);
const channelSchema = z.object({
  id: snowflake,
  guild_id: snowflake.optional(),
  name: z.string().optional(),
  type: z.number(),
  topic: z.string().nullable().optional(),
  parent_id: snowflake.nullable().optional(),
});
const referenceSchema = z.object({
  message_id: snowflake.optional(),
  channel_id: snowflake.optional(),
  guild_id: snowflake.optional(),
  type: z.number().optional(),
});
export const discordMessageSchema = z.object({
  id: snowflake,
  channel_id: snowflake,
  content: z.string().default(""),
  author: z.object({
    id: snowflake,
    username: z.string().optional(),
    global_name: z.string().nullable().optional(),
    bot: z.boolean().optional(),
  }),
  timestamp: z.string(),
  edited_timestamp: z.string().nullable().optional(),
  message_reference: referenceSchema.optional(),
  mentions: z.array(z.object({ id: snowflake })).default([]),
  mention_roles: z.array(snowflake).default([]),
  mention_everyone: z.boolean().default(false),
  attachments: z.array(z.object({
    id: snowflake.optional(),
    filename: z.string().optional(),
    content_type: z.string().optional(),
    size: z.number().optional(),
    url: z.string().optional(),
  })).default([]),
});
export type DiscordMessage = z.infer<typeof discordMessageSchema>;
type DiscordChannel = z.infer<typeof channelSchema>;
export type IncomingMessage = Parameters<ChannelHandler>[1];

// Use the adapter's credentials/base URL without exporting credentials into context.
export class ContextDiscordAdapter extends DiscordAdapter {
  private async read(path: string): Promise<unknown> {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      headers: { Authorization: `Bot ${await this.resolveBotToken()}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Discord GET failed (${response.status})`);
    return response.json();
  }

  async readChannel(id: string) {
    return channelSchema.parse(await this.read(`/channels/${snowflake.parse(id)}`));
  }

  async readMessage(channelId: string, messageId: string) {
    return discordMessageSchema.parse(await this.read(
      `/channels/${snowflake.parse(channelId)}/messages/${snowflake.parse(messageId)}`,
    ));
  }

  async readMessages(channelId: string, before: string, limit = 50) {
    return z.array(discordMessageSchema).parse(await this.read(
      `/channels/${snowflake.parse(channelId)}/messages?before=${snowflake.parse(before)}&limit=${limit}`,
    ));
  }

  async readMessagesAround(channelId: string, messageId: string) {
    return z.array(discordMessageSchema).parse(await this.read(
      `/channels/${snowflake.parse(channelId)}/messages?around=${snowflake.parse(messageId)}&limit=25`,
    ));
  }
}

export interface DiscordContext {
  guildId: string | null;
  channelId: string;
  channel?: DiscordChannel;
  parent?: DiscordChannel;
  category?: DiscordChannel;
  messageId: string;
  messageUrl: string;
  mentions: { users: string[]; roles: string[]; everyone: boolean; bot: boolean };
  reply?: {
    reference: z.infer<typeof referenceSchema>;
    status: "available" | "unavailable" | "outside-channel";
    message?: DiscordMessage;
  };
  unavailable: string[];
}

export function originalMessage(message: IncomingMessage): DiscordMessage {
  const raw = discordMessageSchema.safeParse(message.raw);
  const attachments = message.attachments.map(a => ({ filename: a.name, content_type: a.mimeType, size: a.size, url: a.url }));
  if (raw.success) return { ...raw.data, attachments: raw.data.attachments.length ? raw.data.attachments : attachments };
  const coordinates = message.threadId.split(":");
  return {
    id: message.id,
    channel_id: coordinates[3] ?? coordinates[2],
    content: message.text,
    author: { id: message.author.userId, username: message.author.userName, bot: message.author.isBot === true },
    timestamp: message.metadata.dateSent.toISOString(),
    mentions: [], mention_roles: [], mention_everyone: false,
    attachments,
  };
}

export function createContextResolver(adapter: ContextDiscordAdapter, cacheTtlMs = 60_000) {
  const cache = new Map<string, { until: number; value: Promise<DiscordChannel> }>();
  const channel = (id: string) => {
    const previous = cache.get(id);
    if (previous && previous.until > Date.now()) return previous.value;
    if (cache.size >= 256) cache.delete(cache.keys().next().value!);
    const value = adapter.readChannel(id);
    cache.set(id, { until: Date.now() + cacheTtlMs, value });
    // Failed lookups are cached briefly too, so a missing permission doesn't flood Discord.
    value.catch(() => { const entry = cache.get(id); if (entry?.value === value) entry.until = Date.now() + 10_000; });
    return value;
  };

  return async (message: IncomingMessage): Promise<DiscordContext> => {
    const raw = originalMessage(message);
    const { guildId, channelId, threadId } = adapter.decodeThreadId(message.threadId);
    const actualChannelId = threadId ?? channelId;
    const context: DiscordContext = {
      guildId: guildId === "@me" ? null : guildId,
      channelId: actualChannelId,
      messageId: message.id,
      messageUrl: `https://discord.com/channels/${guildId}/${actualChannelId}/${message.id}`,
      mentions: {
        users: raw.mentions.map(u => u.id), roles: raw.mention_roles,
        everyone: raw.mention_everyone,
        bot: raw.mentions.some(u => u.id === adapter.botUserId),
      },
      unavailable: [],
    };
    try {
      context.channel = await channel(actualChannelId);
      if (context.channel.parent_id) {
        const parent = await channel(context.channel.parent_id);
        if (parent.type === 4) context.category = parent;
        else {
          context.parent = parent;
          if (parent.parent_id) context.category = await channel(parent.parent_id);
        }
      }
    } catch {
      context.unavailable.push("channel metadata unavailable");
    }
    if (raw.message_reference?.message_id) {
      const reference = raw.message_reference;
      context.reply = { reference, status: "unavailable" };
      if ((reference.channel_id && reference.channel_id !== actualChannelId) ||
          (reference.guild_id && reference.guild_id !== guildId)) {
        context.reply.status = "outside-channel";
      } else {
        try {
          context.reply.message = await adapter.readMessage(actualChannelId, reference.message_id!);
          context.reply.status = "available";
        } catch {
          context.unavailable.push("referenced message unavailable");
        }
      }
    }
    return context;
  };
}

const formatter = new DiscordFormatConverter();
export function attachContext(message: IncomingMessage, context: DiscordContext) {
  // Per-message content, not run-level context: subsequent signals delivered to an
  // already-running agent must carry their own channel and reply relationship too.
  const text = `[Discord context]\n${JSON.stringify(context)}\n\n${message.text}`;
  message.text = text;
  message.formatted = formatter.toAst(text);
}

export function createDiscordHandler(adapter: ContextDiscordAdapter): ChannelHandler {
  const resolve = createContextResolver(adapter);
  return async (thread, message, next, ctx) => {
    const context = await resolve(message);
    ctx.signalMetadata.discordContext = context;
    attachContext(message, context);
    await next(thread, message);
  };
}
