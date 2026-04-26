import { JwtRefreshStrategy } from './jwt-refresh.strategy';
import { JwtPayload } from './jwt-payload.interface';

describe('JwtRefreshStrategy', () => {
  it('validate: returns the payload as-is', () => {
    process.env['JWT_REFRESH_SECRET'] = 'test-refresh-secret';
    const strategy = new JwtRefreshStrategy();

    const payload: JwtPayload = {
      sub: 'user-uuid',
      tenant_id: 'tenant-uuid',
      roles: ['admin'],
      iat: 1700000000,
      exp: 1700604800,
    };

    const result = strategy.validate(payload);
    expect(result).toEqual(payload);
  });
});
