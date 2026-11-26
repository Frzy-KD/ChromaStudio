import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";

export const drawings = pgTable(
  "drawings",
  {
    id: text().primaryKey(),
    ownerId: text("owner_id").notNull(),
    title: text().notNull().default("Untitled"),
    width: integer().notNull(),
    height: integer().notNull(),
    bgMode: text("bg_mode").notNull().default("white"),
    imageKey: text("image_key").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("drawings_owner_updated_idx").on(t.ownerId, t.updatedAt)],
);
