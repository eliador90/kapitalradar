CREATE TYPE "public"."contribution_type" AS ENUM('cash', 'set_off', 'in_kind', 'mixed', 'conditional_capital', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."event_match" AS ENUM('accepted', 'rejected', 'uncertain');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('capital_change', 'conversion_to_ag', 'capital_band', 'formation', 'cancellation', 'name_change');--> statement-breakpoint
CREATE TYPE "public"."match_confidence" AS ENUM('high', 'low');--> statement-breakpoint
CREATE TYPE "public"."release_status" AS ENUM('building', 'failed', 'ready', 'retired');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('capital_increased', 'abstain', 'likely_financing');--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"release_id" text NOT NULL,
	"event_id" uuid NOT NULL,
	"tier" "tier" NOT NULL,
	"rule_hits" text[] NOT NULL,
	"rules_score" real NOT NULL,
	"rules_positive" boolean NOT NULL,
	"reject_reason" text,
	"classification_id" uuid,
	"assessed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkpoints" (
	"job" text NOT NULL,
	"item_key" text NOT NULL,
	"status" text NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"input_hash" text NOT NULL,
	"model_id" text NOT NULL,
	"prompt_version" text NOT NULL,
	"score" real,
	"rationale" text,
	"cited_rule_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"error" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_names" (
	"release_id" text NOT NULL,
	"company_uid" text NOT NULL,
	"name" text NOT NULL,
	"published_at" date NOT NULL,
	"publication_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"release_id" text NOT NULL,
	"company_uid" text NOT NULL,
	"source_url" text NOT NULL,
	"published_at" date NOT NULL,
	"stated_amount" numeric(20, 2),
	"stated_currency" text,
	"stage" text,
	"match_method" text NOT NULL,
	"match_confidence" "match_confidence" NOT NULL,
	"event_match" "event_match" NOT NULL,
	"reviewed_at" timestamp with time zone,
	"matched_event_id" uuid
);
--> statement-breakpoint
CREATE TABLE "current_release" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"release_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "current_release_singleton" CHECK ("current_release"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"release_id" text NOT NULL,
	"publication_id" text NOT NULL,
	"seq" smallint NOT NULL,
	"company_uid" text NOT NULL,
	"type" "event_type" NOT NULL,
	"published_at" date NOT NULL,
	"legal_date" date NOT NULL,
	"currency" text,
	"capital_before" numeric(20, 2),
	"capital_after" numeric(20, 2),
	"shares_before" bigint,
	"shares_after" bigint,
	"contribution_type" "contribution_type",
	"payload" jsonb NOT NULL,
	"spans" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"corrects_publication_number" text,
	"cancels_publication_number" text
);
--> statement-breakpoint
CREATE TABLE "ingest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"release_id" text,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"spend" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publications" (
	"id" text PRIMARY KEY NOT NULL,
	"publication_number" text NOT NULL,
	"rubric" text NOT NULL,
	"sub_rubric" text NOT NULL,
	"language" text NOT NULL,
	"published_at" date NOT NULL,
	"company_uid" text,
	"raw_xml" text NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publications_publication_number_unique" UNIQUE("publication_number")
);
--> statement-breakpoint
CREATE TABLE "releases" (
	"id" text PRIMARY KEY NOT NULL,
	"status" "release_status" DEFAULT 'building' NOT NULL,
	"snapshot_date" date NOT NULL,
	"backfill_start" date NOT NULL,
	"config" jsonb NOT NULL,
	"eval_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_classification_id_classifications_id_fk" FOREIGN KEY ("classification_id") REFERENCES "public"."classifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_names" ADD CONSTRAINT "company_names_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_names" ADD CONSTRAINT "company_names_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmations" ADD CONSTRAINT "confirmations_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmations" ADD CONSTRAINT "confirmations_matched_event_id_events_id_fk" FOREIGN KEY ("matched_event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "current_release" ADD CONSTRAINT "current_release_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_runs" ADD CONSTRAINT "ingest_runs_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assessments_release_event" ON "assessments" USING btree ("release_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "checkpoints_job_item" ON "checkpoints" USING btree ("job","item_key");--> statement-breakpoint
CREATE UNIQUE INDEX "classifications_idempotency" ON "classifications" USING btree ("input_hash","model_id","prompt_version");--> statement-breakpoint
CREATE UNIQUE INDEX "company_names_pk" ON "company_names" USING btree ("release_id","company_uid","publication_id");--> statement-breakpoint
CREATE INDEX "company_names_release_uid_published" ON "company_names" USING btree ("release_id","company_uid","published_at");--> statement-breakpoint
CREATE INDEX "confirmations_release_event" ON "confirmations" USING btree ("release_id","matched_event_id");--> statement-breakpoint
CREATE INDEX "confirmations_release_uid_published" ON "confirmations" USING btree ("release_id","company_uid","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "events_release_publication_seq" ON "events" USING btree ("release_id","publication_id","seq");--> statement-breakpoint
CREATE INDEX "events_release_published" ON "events" USING btree ("release_id","published_at");--> statement-breakpoint
CREATE INDEX "events_release_uid_published" ON "events" USING btree ("release_id","company_uid","published_at");--> statement-breakpoint
CREATE INDEX "publications_uid_published" ON "publications" USING btree ("company_uid","published_at");--> statement-breakpoint
CREATE INDEX "publications_published" ON "publications" USING btree ("published_at");