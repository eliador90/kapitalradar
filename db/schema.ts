// Point-in-time store (plan "Data model", eng V3/A3/A4/P1, eng delta A14/Q7/V10/V14/P3).
// Raw publications are shared and immutable; every derived row carries release_id, and the
// app reads only the release that current_release points to. Every published_at is a Postgres
// date (the SHAB publication day), compared inclusively against asOf.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  CONTRIBUTION_TYPES,
  EVENT_MATCHES,
  EVENT_TYPES,
  MATCH_CONFIDENCES,
  TIERS,
  type ReleaseConfig,
} from "../lib/domain/schemas";

export const tierEnum = pgEnum("tier", TIERS);
export const eventTypeEnum = pgEnum("event_type", EVENT_TYPES);
export const contributionTypeEnum = pgEnum("contribution_type", CONTRIBUTION_TYPES);
export const matchConfidenceEnum = pgEnum("match_confidence", MATCH_CONFIDENCES);
export const eventMatchEnum = pgEnum("event_match", EVENT_MATCHES);
export const releaseStatusEnum = pgEnum("release_status", ["building", "failed", "ready", "retired"]);
export const runStatusEnum = pgEnum("run_status", ["running", "succeeded", "failed"]);

const money = (name: string) => numeric(name, { precision: 20, scale: 2 });

/** Immutable raw SHAB snapshots, shared by all releases. Raw XML holds person data: never exported. */
export const publications = pgTable(
  "publications",
  {
    id: text("id").primaryKey(), // SHAB publication UUID
    publicationNumber: text("publication_number").notNull().unique(), // e.g. HR02-1006772205
    rubric: text("rubric").notNull(),
    subRubric: text("sub_rubric").notNull(),
    language: text("language").notNull(),
    publishedAt: date("published_at").notNull(),
    companyUid: text("company_uid"),
    rawXml: text("raw_xml").notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("publications_uid_published").on(t.companyUid, t.publishedAt), index("publications_published").on(t.publishedAt)],
);

export const releases = pgTable("releases", {
  id: text("id").primaryKey(), // e.g. "r1"
  status: releaseStatusEnum("status").notNull().default("building"),
  /** Last SHAB publication day covered: the one definition behind default asOf, clamp and freshness. */
  snapshotDate: date("snapshot_date").notNull(),
  backfillStart: date("backfill_start").notNull(),
  /** Rule ids, weights, thresholds, display sentences, model and prompt version (eng delta V14). */
  config: jsonb("config").$type<ReleaseConfig>().notNull(),
  /** Release eval artifact: per-system n, cohort size, precision bounds, recall (T9, T19). */
  evalResult: jsonb("eval_result"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
});

/** Singleton pointer, flipped in one transaction after the gates pass (eng V3). */
export const currentRelease = pgTable(
  "current_release",
  {
    id: smallint("id").primaryKey().default(1),
    releaseId: text("release_id")
      .notNull()
      .references(() => releases.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("current_release_singleton", sql`${t.id} = 1`)],
);

/** Typed legal events parsed from publications, rebuilt per release. */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    releaseId: text("release_id")
      .notNull()
      .references(() => releases.id),
    publicationId: text("publication_id")
      .notNull()
      .references(() => publications.id),
    /** Position of the event inside its publication (one entry can hold several). */
    seq: smallint("seq").notNull(),
    companyUid: text("company_uid").notNull(),
    type: eventTypeEnum("type").notNull(),
    /** Denormalized from the publication for the as-of indexes. */
    publishedAt: date("published_at").notNull(),
    /** Statute-change date from the text, else the journal date. */
    legalDate: date("legal_date").notNull(),
    currency: text("currency"),
    capitalBefore: money("capital_before"),
    capitalAfter: money("capital_after"),
    sharesBefore: bigint("shares_before", { mode: "number" }),
    sharesAfter: bigint("shares_after", { mode: "number" }),
    contributionType: contributionTypeEnum("contribution_type"),
    /** Event-type specific fields (share classes, band limits, purpose, …), Zod-validated in lib/domain. */
    payload: jsonb("payload").notNull(),
    /** Evidence spans inside the publication text (CI: evidence-reference integrity). */
    spans: jsonb("spans").$type<{ start: number; end: number; kind: string }[]>().notNull().default([]),
    correctsPublicationNumber: text("corrects_publication_number"),
    cancelsPublicationNumber: text("cancels_publication_number"),
  },
  (t) => [
    uniqueIndex("events_release_publication_seq").on(t.releaseId, t.publicationId, t.seq),
    index("events_release_published").on(t.releaseId, t.publishedAt),
    index("events_release_uid_published").on(t.releaseId, t.companyUid, t.publishedAt),
  ],
);

/** Company names folded as of asOf (eng A3): one row per name taking effect. */
export const companyNames = pgTable(
  "company_names",
  {
    releaseId: text("release_id")
      .notNull()
      .references(() => releases.id),
    companyUid: text("company_uid").notNull(),
    name: text("name").notNull(),
    publishedAt: date("published_at").notNull(),
    publicationId: text("publication_id")
      .notNull()
      .references(() => publications.id),
  },
  (t) => [
    uniqueIndex("company_names_pk").on(t.releaseId, t.companyUid, t.publicationId),
    index("company_names_release_uid_published").on(t.releaseId, t.companyUid, t.publishedAt),
  ],
);

/**
 * Raw classifier outputs, release-independent, so no input is ever classified twice
 * (idempotency key: input hash + model + prompt version).
 */
export const classifications = pgTable(
  "classifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inputHash: text("input_hash").notNull(),
    modelId: text("model_id").notNull(),
    promptVersion: text("prompt_version").notNull(),
    score: real("score"),
    rationale: text("rationale"),
    citedRuleIds: text("cited_rule_ids").array().notNull().default(sql`'{}'::text[]`),
    /** null = valid; otherwise malformed_json | refusal | empty | invalid_rule_ids | usage_limit. */
    error: text("error"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("classifications_idempotency").on(t.inputHash, t.modelId, t.promptVersion)],
);

/** One assessment per capital-change event per release, rejects included (eng Q2). */
export const assessments = pgTable(
  "assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    releaseId: text("release_id")
      .notNull()
      .references(() => releases.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    tier: tierEnum("tier").notNull(),
    ruleHits: text("rule_hits").array().notNull(),
    rulesScore: real("rules_score").notNull(),
    rulesPositive: boolean("rules_positive").notNull(),
    /** Reason for a pre-filter reject (hard negative, not AG, …); null when the candidate passed. */
    rejectReason: text("reject_reason"),
    classificationId: uuid("classification_id").references(() => classifications.id),
    assessedAt: timestamp("assessed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("assessments_release_event").on(t.releaseId, t.eventId)],
);

/** External evidence of announced rounds (hand-curated in v1, OQ4). */
export const confirmations = pgTable(
  "confirmations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    releaseId: text("release_id")
      .notNull()
      .references(() => releases.id),
    companyUid: text("company_uid").notNull(),
    sourceUrl: text("source_url").notNull(),
    publishedAt: date("published_at").notNull(),
    statedAmount: money("stated_amount"),
    statedCurrency: text("stated_currency"),
    stage: text("stage"),
    matchMethod: text("match_method").notNull(),
    matchConfidence: matchConfidenceEnum("match_confidence").notNull(),
    eventMatch: eventMatchEnum("event_match").notNull(),
    /** Manual review time; a low-confidence match counts only once reviewed (eng Q5/Q7). */
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    matchedEventId: uuid("matched_event_id").references(() => events.id),
  },
  (t) => [
    index("confirmations_release_event").on(t.releaseId, t.matchedEventId),
    index("confirmations_release_uid_published").on(t.releaseId, t.companyUid, t.publishedAt),
  ],
);

/** One row per build run: counts, errors, spend, status (plan: failure visibility). */
export const ingestRuns = pgTable("ingest_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  releaseId: text("release_id").references(() => releases.id),
  status: runStatusEnum("status").notNull().default("running"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  counts: jsonb("counts").notNull().default({}),
  errors: jsonb("errors").notNull().default([]),
  spend: jsonb("spend").notNull().default({}),
});

/** Resumable batch state for history fetches and classification runs. */
export const checkpoints = pgTable(
  "checkpoints",
  {
    job: text("job").notNull(),
    itemKey: text("item_key").notNull(),
    status: text("status").notNull(), // pending | done | failed
    attempts: smallint("attempts").notNull().default(0),
    lastError: text("last_error"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("checkpoints_job_item").on(t.job, t.itemKey)],
);
