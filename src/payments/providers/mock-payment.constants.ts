/**
 * Magic-amount table mirroring Stone's sandbox documented behaviour.
 * Reference: https://online.stone.com.br/reference/retorno-do-sandbox-old
 *
 * Stone's *Online* sandbox uses transaction values to deterministically simulate
 * declined codes and edge cases. Whether *Link de Pagamento* honours the same
 * amounts is unconfirmed in public docs — verify with Stone when wiring real
 * sandbox calls. Until then, this table is purely a mock convention so e2e
 * tests can drive auto-fail / auto-timeout flows without manual button clicks.
 */
export type SimulatedOutcome = 'auto_fail' | 'auto_timeout' | null;

/** Amounts (BRL, two decimals) that auto-fail the payment in mock mode. */
const AUTO_FAIL_AMOUNTS: ReadonlySet<string> = new Set(['0.33', '0.34', '0.41', '0.43']);

/** Amounts (BRL, two decimals) that auto-timeout (mock checkout never resolves). */
const AUTO_TIMEOUT_AMOUNTS: ReadonlySet<string> = new Set(['666.00']);

/**
 * Map an order's `total_amount` (decimal string from the DB) to the simulated
 * outcome the mock provider should record on the Payment row.
 */
export function getSimulatedOutcome(totalAmount: string): SimulatedOutcome {
  // Normalise to two decimals — `total_amount` is already `decimal(12,2)` so
  // this is mostly defensive against tests passing `'0.34000'` or similar.
  const parsed = Number(totalAmount);
  if (!Number.isFinite(parsed)) return null;
  const normalized = parsed.toFixed(2);
  if (AUTO_FAIL_AMOUNTS.has(normalized)) return 'auto_fail';
  if (AUTO_TIMEOUT_AMOUNTS.has(normalized)) return 'auto_timeout';
  return null;
}
