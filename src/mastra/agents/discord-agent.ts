import { createDiscordAdapter } from "@chat-adapter/discord";
import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";

export const discordAgent = new Agent({
  id: "discord-agent",
  name: "Discord Agent",
  instructions:
    "You are a helpful assistant. Answer questions clearly and concisely.",
  model: "openai/gpt-5.6-luna",
  memory: new Memory(),
  channels: {
    adapters: {
      discord: createDiscordAdapter(),
    },
  },
});
