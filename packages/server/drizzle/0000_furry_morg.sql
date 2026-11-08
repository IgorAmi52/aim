CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_session_id" text NOT NULL,
	"target_session_id" text NOT NULL,
	"type" text NOT NULL,
	"confidence" real NOT NULL,
	"reason" text NOT NULL,
	"user_action" text,
	"acted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"slack_user_id" text,
	"slack_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"repository" text NOT NULL,
	"repository_root_path" text NOT NULL,
	"branch" text,
	"working_directory" text NOT NULL,
	"edited_files" text[] DEFAULT '{}'::text[] NOT NULL,
	"pull_request_urls" text[] DEFAULT '{}'::text[] NOT NULL,
	"source_byte_offset" bigint DEFAULT 0 NOT NULL,
	"distilled_byte_offset" bigint DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"distill_requested_at" timestamp with time zone,
	"distilled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_cards" (
	"session_id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"intent" text NOT NULL,
	"approach" text NOT NULL,
	"decisions" jsonb NOT NULL,
	"outcome" text NOT NULL,
	"symbols" text[] NOT NULL,
	"search_document" text NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', search_document)) STORED,
	"embedding" vector(1024) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_source_session_id_sessions_id_fk" FOREIGN KEY ("source_session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_target_session_id_sessions_id_fk" FOREIGN KEY ("target_session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_cards" ADD CONSTRAINT "work_cards_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "matches_source_target_index" ON "matches" USING btree ("source_session_id","target_session_id");--> statement-breakpoint
CREATE INDEX "sessions_person_index" ON "sessions" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "sessions_edited_files_index" ON "sessions" USING gin ("edited_files");--> statement-breakpoint
CREATE INDEX "sessions_distill_requested_index" ON "sessions" USING btree ("distill_requested_at");--> statement-breakpoint
CREATE INDEX "work_cards_embedding_index" ON "work_cards" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "work_cards_search_vector_index" ON "work_cards" USING gin ("search_vector");