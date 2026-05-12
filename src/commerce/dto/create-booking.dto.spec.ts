import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateBookingDto } from './create-booking.dto';

describe('CreateBookingDto — booking_channel validation', () => {
  it.each(['app', 'walk_in', 'phone', 'whatsapp'])(
    'accepts valid booking_channel: %s',
    async (channel) => {
      const dto = plainToInstance(CreateBookingDto, { booking_channel: channel });
      const errors = await validate(dto);
      expect(errors.filter((e) => e.property === 'booking_channel')).toHaveLength(0);
    },
  );

  it('rejects invalid booking_channel with 400-style validation failure', async () => {
    const dto = plainToInstance(CreateBookingDto, { booking_channel: 'instagram' });
    const errors = await validate(dto);
    expect(errors.filter((e) => e.property === 'booking_channel').length).toBeGreaterThan(0);
  });

  it('accepts omitted booking_channel', async () => {
    const dto = plainToInstance(CreateBookingDto, {});
    const errors = await validate(dto);
    expect(errors.filter((e) => e.property === 'booking_channel')).toHaveLength(0);
  });
});

describe('CreateBookingDto — notes validation', () => {
  it('accepts notes within 1000 chars', async () => {
    const dto = plainToInstance(CreateBookingDto, { notes: 'x'.repeat(1000) });
    const errors = await validate(dto);
    expect(errors.filter((e) => e.property === 'notes')).toHaveLength(0);
  });

  it('rejects notes over 1000 chars', async () => {
    const dto = plainToInstance(CreateBookingDto, { notes: 'x'.repeat(1001) });
    const errors = await validate(dto);
    expect(errors.filter((e) => e.property === 'notes').length).toBeGreaterThan(0);
  });

  it('accepts omitted notes', async () => {
    const dto = plainToInstance(CreateBookingDto, {});
    const errors = await validate(dto);
    expect(errors.filter((e) => e.property === 'notes')).toHaveLength(0);
  });
});
