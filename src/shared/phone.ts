/**
 * Brazilian mobile phone normalizer.
 *
 * Strips non-digits, accepts inputs like:
 *   - "(11) 91212-3434"
 *   - "11912123434"
 *   - "+5511912123434"
 *   - "5511912123434"
 *
 * Returns E.164 with the BR country code: `+55DDDNNNNNNNN` (13 chars total).
 *
 * Validation rules:
 *  - 11 digits after stripping country code (2-digit DDD + 9-digit mobile number)
 *  - DDD must be between 11 and 99 inclusive
 *  - The mobile number's first digit (after DDD) must be 9 (Brazilian mobile)
 *  - Rejects 10-digit landlines — SMS magic links don't reach them
 *
 * Returns `null` for anything that doesn't fit.
 */
export function normalizeBrPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  let national: string;
  if (digits.length === 13 && digits.startsWith('55')) {
    national = digits.slice(2);
  } else if (digits.length === 11) {
    national = digits;
  } else {
    return null;
  }

  if (national.length !== 11) return null;
  const ddd = Number(national.slice(0, 2));
  if (Number.isNaN(ddd) || ddd < 11 || ddd > 99) return null;

  // Brazilian mobile numbers always start with 9 after the DDD.
  if (national.charAt(2) !== '9') return null;

  return `+55${national}`;
}
