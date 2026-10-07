// One rule catalog (design D1): id, kind, weight, the one-line description Claude receives,
// and the display sentence the evidence block shows. Weights and the threshold are provisional
// until T6 fits them on dev data; each release snapshots the catalog into releases.config, so
// later edits never change how an old release renders (eng delta V14).
import { RULE_KINDS } from "./schemas";

export type RuleKind = (typeof RULE_KINDS)[number];

export interface Rule {
  id: string;
  kind: RuleKind;
  /** Rules-only score contribution; ignored for hard negatives (they exclude the candidate). */
  weight: number;
  /** One line in the classifier prompt's rule catalog. */
  claude: string;
  /** Plain sentence in the UI evidence block, next to the field that fired it. */
  display: string;
}

export const RULES = [
  {
    id: "odd_amount_small_nominal",
    kind: "positive",
    weight: 1.0,
    claude: "The capital increase is a non-round amount (not a multiple of 1,000) in shares with a nominal value of 1 or less.",
    display: "The increase is an odd amount in small-nominal shares, as priced rounds usually are.",
  },
  {
    id: "young_company",
    kind: "positive",
    weight: 0.5,
    claude: "The company was founded less than six years before this event.",
    display: "The company was founded less than six years before this capital increase.",
  },
  {
    id: "tech_purpose",
    kind: "positive",
    weight: 0.5,
    claude: "The statutory purpose describes technology, software, biotech, medtech or R&D.",
    display: "The company's purpose describes technology or life-sciences development.",
  },
  {
    id: "new_preferred_class",
    kind: "positive",
    weight: 1.5,
    claude: "A new class of preferred shares is created in this capital change.",
    display: "A new class of preferred shares was created.",
  },
  {
    id: "round_amount_holding",
    kind: "negative",
    weight: -1.0,
    claude: "A round increase (a multiple of 10,000) in a company whose stated business is holding participations.",
    display: "A round increase in a holding company.",
  },
  {
    id: "esop_sized_increment",
    kind: "negative",
    weight: -1.0,
    claude: "The new shares are under 2% of all shares after the increase, with no new preferred class.",
    display: "A small increment typical of employee share options.",
  },
  {
    id: "set_off_only",
    kind: "negative",
    weight: -1.5,
    claude: "The whole increase is paid by setting off claims (conversion), with no new cash.",
    display: "Paid entirely by converting existing claims, with no new money.",
  },
  {
    id: "in_kind_only",
    kind: "negative",
    weight: -1.5,
    claude: "The increase is paid by a contribution in kind (assets or shares), with no new cash.",
    display: "Paid with assets or shares contributed in kind, with no new money.",
  },
  {
    id: "conditional_capital_issuance",
    kind: "negative",
    weight: -1.0,
    claude: "Shares are issued out of conditional capital (options or conversion rights being exercised).",
    display: "Shares issued out of conditional capital, as when options are exercised.",
  },
  {
    // v3 (decision log #45/#46): weight by analogy with the other "no new money" rules.
    id: "reserves_funded",
    kind: "negative",
    weight: -1.5,
    claude: "The increase is paid out of the company's own freely available equity (a bonus issue), with no new money.",
    display: "Paid out of the company's own reserves, with no new money.",
  },
  {
    // v3: softer than the no-new-money rules, since real rounds do happen at conversion.
    id: "conversion_from_gmbh",
    kind: "negative",
    weight: -1.0,
    claude: "The capital change happens as part of converting a GmbH into an AG.",
    display: "Part of converting the company from a GmbH into an AG.",
  },
  {
    id: "restructuring_pair",
    kind: "hard_negative",
    weight: 0,
    claude: "Capital is reduced and re-increased in the same entry (restructuring).",
    display: "Capital was reduced and re-increased in the same entry, a restructuring.",
  },
  {
    id: "capital_reduction",
    kind: "hard_negative",
    weight: 0,
    claude: "Nominal capital decreases.",
    display: "Nominal capital decreased.",
  },
] as const satisfies readonly Rule[];

export type RuleId = (typeof RULES)[number]["id"];

const BY_ID: ReadonlyMap<string, Rule> = new Map(RULES.map((r) => [r.id, r]));

export const getRule = (id: string): Rule | undefined => BY_ID.get(id);
export const isRuleId = (id: string): id is RuleId => BY_ID.has(id);

/** The one-line catalog the classifier prompt embeds. */
export const claudeCatalog = () => RULES.map((r) => `- ${r.id}: ${r.claude}`).join("\n");

/** Fingerprint of what the rules compute (ids, kinds, weights): part of the system an eval measured. */
export const RULES_FINGERPRINT = RULES.map((r) => `${r.id}:${r.kind}:${r.weight}`).join("|");
