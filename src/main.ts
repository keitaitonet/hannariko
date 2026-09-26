import OpenAI from 'openai';
import { readConfig } from './config.ts';
import { instructions } from './instructions.ts';
import { createDiscordClient } from './discord/client.ts';
import { processMessage } from './discord/process-message.ts';
import { createSession } from './openai/session.ts';
import { createMemoryRepository } from './memory/dynamodb.ts';

const config = readConfig();
const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
const memory = createMemoryRepository(config.DYNAMODB_TABLE_NAME);

const client = createDiscordClient(config.DISCORD_GUILD_ID, async message => {
  await processMessage(message, {
    memory,
    createSession: () => createSession({
      client: openai,
      model: config.OPENAI_MODEL,
      instructions,
    }),
  });
});

try {
  await client.login(config.DISCORD_BOT_TOKEN);
} catch (error) {
  await client.destroy();
  throw error;
}
