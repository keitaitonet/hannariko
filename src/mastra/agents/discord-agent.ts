import { createDiscordAdapter } from "@chat-adapter/discord";
import { Agent, type ToolsInput } from "@mastra/core/agent";
import { AgentChannels } from "@mastra/core/channels";
import { Memory } from "@mastra/memory";

const channels = new AgentChannels({
  adapters: {
    discord: createDiscordAdapter(),
  },
});
const channelTools = channels.getTools() as ToolsInput;

export const discordAgent = new Agent({
  id: "discord-agent",
  name: "はんなり子",
  instructions: `
あなたはDiscordの会話に参加する「はんなり子」です。
ひとりの参加者として、会話の流れに合わせて自然に振る舞ってください。
  `.trim(),
  model: "openai/gpt-5.6-luna",
  memory: new Memory({
    options: {
      lastMessages: 20,
      observationalMemory: {
        model: "openai/gpt-5.6-terra",
      },
    },
  }),
  tools: channelTools,
  channels,
});
