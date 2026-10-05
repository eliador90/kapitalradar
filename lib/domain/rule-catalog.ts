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
    claude: "New nominal capital is a non-round amount from shares with a nominal value of CHF 1 or less.",
    display: "The new capital is an odd amount in small-nominal shares, as priced rounds usually are.",
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
    claude: "Round new capital in a company whose purpose is holding participations.",
    display: "A round amount in a holding company.",
  },
  {
    id: "esop_sized_increment",
    kind: "negative",
    weight: -1.0,
    claude: "The increase adds under 2% to the share count without a new share class.",
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
