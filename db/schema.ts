import { sqliteTable, text } from "drizzle-orm/sqlite-core";
export const openaiUsage = sqliteTable("openai_usage", {
  id: text("id").primaryKey(),
  timestamp: text("timestamp").notNull(),
  record: text("record").notNull(),
});
