import { createClient } from "@libsql/client";
import { databaseUrl } from "../database.ts";
import { ContextRecordStore } from "./store.ts";

// Same database as Mastra memory, with a separate connection for application data.
const client = createClient({ url: databaseUrl });
if (client.protocol === "file") await client.execute("PRAGMA busy_timeout = 5000");
export const contextRecords = new ContextRecordStore(client);
