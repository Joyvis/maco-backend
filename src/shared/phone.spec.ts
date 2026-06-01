import { normalizeBrPhone } from './phone';

describe('normalizeBrPhone', () => {
  it.each([
    ['(11) 91212-3434', '+5511912123434'],
    ['11 91212-3434', '+5511912123434'],
    ['11912123434', '+5511912123434'],
    ['+5511912123434', '+5511912123434'],
    ['5511912123434', '+5511912123434'],
    [' (13) 9 1212 3434 ', '+5513912123434'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeBrPhone(input)).toBe(expected);
  });

  it.each([
    [null],
    [undefined],
    [''],
    ['   '],
    ['abc'],
    ['1234'],
    // 10-digit landline (no leading 9)
    ['1132121212'],
    // invalid DDD (10)
    ['10912123434'],
    // mobile without leading 9
    ['11812123434'],
    // too long
    ['551191212343400'],
  ])('returns null for invalid input %p', (input) => {
    expect(normalizeBrPhone(input)).toBeNull();
  });
});
