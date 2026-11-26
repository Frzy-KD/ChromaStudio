CREATE TABLE "drawings" (
	"id" text PRIMARY KEY,
	"owner_id" text NOT NULL,
	"title" text DEFAULT 'Untitled' NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bg_mode" text DEFAULT 'white' NOT NULL,
	"image_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "drawings_owner_updated_idx" ON "drawings" ("owner_id","updated_at");