import * as v from 'valibot';

export const DiscordIdSchema = v.pipe(v.string(), v.regex(/^\d{1,20}$/));
