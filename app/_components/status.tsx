import type { Status } from "../../lib/domain/status";

// Pips are decoration (aria-hidden); the label carries the meaning (design DS1).
export function StatusLabel({ status }: { status: Status }) {
  return (
    <span className="status">
      {status.pips && (
        <span className="pips" aria-hidden="true">
          {status.pips}
        </span>
      )}
      {status.label}
    </span>
  );
}
