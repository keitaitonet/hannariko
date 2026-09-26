import { ChannelType, MessageMentions, MessageType, type GuildTextBasedChannel, type Message, type User } from 'discord.js';

export function formatConversation(
  self: User,
  channel: GuildTextBasedChannel,
  targetMessageId: string,
  messages: readonly Message<true>[],
) {
  const parent = channel.isThread() ? channel.parent : null;
  return {
    self: { id: self.id, name: channel.guild.members.cache.get(self.id)?.displayName ?? self.displayName },
    channel: {
      id: channel.id,
      name: channel.name,
      type: ChannelType[channel.type],
      topic: 'topic' in channel ? channel.topic : null,
      parent: channel.isThread() && channel.parentId ? {
        id: channel.parentId,
        name: parent?.name ?? null,
        topic: parent && 'topic' in parent ? parent.topic : null,
      } : null,
    },
    targetMessageId,
    messages: messages.map(formatMessage),
  };
}

function formatMessage(message: Message<true>) {
  const userIds = new Set([
    ...message.mentions.users.keys(),
    ...mentionIds(message.content, MessageMentions.UsersPattern),
  ]);
  const roleIds = new Set([
    ...message.mentions.roles.keys(),
    ...mentionIds(message.content, MessageMentions.RolesPattern),
  ]);
  const channelIds = new Set([
    ...message.mentions.crosspostedChannels.keys(),
    ...mentionIds(message.content, MessageMentions.ChannelsPattern),
  ]);

  return {
    id: message.id,
    type: MessageType[message.type] ?? message.type,
    author: {
      id: message.author.id,
      name: message.member?.displayName ?? message.author.displayName,
      bot: message.author.bot,
    },
    webhook: message.webhookId !== null,
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
    content: message.content,
    replyTo: message.type === MessageType.Reply ? message.reference?.messageId ?? null : null,
    mentions: {
      users: [...userIds].map(id => ({
        id,
        name: message.guild.members.cache.get(id)?.displayName
          ?? message.mentions.users.get(id)?.displayName
          ?? message.client.users.cache.get(id)?.displayName
          ?? null,
      })),
      roles: [...roleIds].map(id => ({ id, name: message.guild.roles.cache.get(id)?.name ?? null })),
      channels: [...channelIds].map(id => ({
        id,
        name: message.guild.channels.cache.get(id)?.name
          ?? message.mentions.crosspostedChannels.get(id)?.name
          ?? null,
      })),
      everyone: message.mentions.everyone,
    },
    attachments: message.attachments.map(attachment => ({
      id: attachment.id,
      name: attachment.name,
      contentType: attachment.contentType,
      size: attachment.size,
      width: attachment.width,
      height: attachment.height,
    })),
    embeds: message.embeds.map(embed => ({
      title: embed.title,
      description: embed.description,
      url: embed.url,
      author: embed.author ? { name: embed.author.name, url: embed.author.url ?? null } : null,
      provider: embed.provider ? { name: embed.provider.name ?? null, url: embed.provider.url ?? null } : null,
      fields: embed.fields.map(field => ({ name: field.name, value: field.value })),
      footer: embed.footer?.text ?? null,
      timestamp: embed.timestamp,
    })),
    stickers: message.stickers.map(sticker => ({
      id: sticker.id,
      name: sticker.name,
      description: sticker.description ?? message.guild.stickers.cache.get(sticker.id)?.description ?? null,
    })),
    reactions: message.reactions.cache.map(reaction => ({
      emoji: { id: reaction.emoji.id, name: reaction.emoji.name },
      count: reaction.count,
      me: reaction.me || reaction.meBurst,
    })),
  };
}

// SDKのコレクションには未キャッシュの参照先が含まれないため、本文のIDも残す。
function mentionIds(content: string, pattern: RegExp): string[] {
  return [...content.matchAll(new RegExp(pattern.source, 'g'))].map(match => match.groups!.id);
}
