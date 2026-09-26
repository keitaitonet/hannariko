import * as v from 'valibot';
import { DiscordIdSchema } from './discord/id.ts';

const RequiredString = v.pipe(v.string(), v.trim(), v.minLength(1));
const ConfigSchema = v.object({
  DISCORD_BOT_TOKEN: RequiredString,
  DISCORD_GUILD_ID: DiscordIdSchema,
  OPENAI_API_KEY: RequiredString,
  OPENAI_MODEL: RequiredString,
  AWS_REGION: RequiredString,
  DYNAMODB_TABLE_NAME: RequiredString,
});

export function readConfig() {
  const result = v.safeParse(ConfigSchema, process.env);
  if (!result.success) {
    const names = [...new Set(result.issues.map(issue => issue.path?.[0]?.key))];
    throw new Error(`環境変数を確認してください: ${names.join(', ')}`);
  }
  return result.output;
}
