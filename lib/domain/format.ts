// Swiss display formats (design DS3): CHF 132’231.38 with a typographic apostrophe, cents
// dropped when zero; dates "29 Sep 2026"; amounts arrive as decimal strings (Postgres numeric).

const THOUSANDS = "’";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, THOUSANDS);

/** "132231.38" → "132’231.38"; "100000.00" → "100’000". Exact on decimal strings. */
export function formatAmount(value: string | number): string {
  const s = typeof value === "number" ? value.toFixed(2) : value.trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`not a decimal amount: ${value}`);
  const [, sign, int, frac = ""] = m;
  if (/[1-9]/.test(frac.slice(2))) throw new Error(`more than two decimals: ${value}`);
  const cents = frac.padEnd(2, "0").slice(0, 2);
  return `${sign}${group(int!.replace(/^0+(?=\d)/, ""))}${/^0*$/.test(frac) ? "" : `.${cents}`}`;
}

export const formatMoney = (value: string | number, currency = "CHF") => `${currency} ${formatAmount(value)}`;

/** Integer counts (shares): "13’282’500". */
export const formatCount = (n: number | bigint) => group(String(n));

/** "2026-09-29" → "29 Sep 2026". */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** "21–27 Sep 2026", "29 Sep – 5 Oct 2026", "29 Dec 2025 – 4 Jan 2026". */
export function formatDateRange(start: string, end: string): string {
  const [sy, sm] = start.split("-");
  const [ey, em] = end.split("-");
  if (start === end) return formatDate(start);
  if (sy !== ey) return `${formatDate(start)} – ${formatDate(end)}`;
  if (sm !== em) return `${formatDate(start).replace(` ${sy}`, "")} – ${formatDate(end)}`;
  return `${Number(start.slice(8))}–${formatDate(end)}`;
}

/** Share issuance as a percentage with one decimal: 0.1234 → "12.3%". */
export const formatPercent = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;
