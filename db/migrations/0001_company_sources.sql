CREATE TABLE "company_sources" (
	"company_uid" text PRIMARY KEY NOT NULL,
	"history_fetched_at" timestamp with time zone NOT NULL,
	"shab_publication_count" integer NOT NULL,
	"earliest_shab_published" date,
	"formation_found" boolean NOT NULL,
	"founded_on" date,
	"foreign_mentions" integer DEFAULT 0 NOT NULL,
	"zefix_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"zefix_error" text
);
