import { JwtStrategy } from './jwt.strategy';

// AC10: @CurrentUser() shape comes from JwtStrategy.validate()
describe('JwtStrategy', () => {
  it('validate: maps JWT payload to RequestUser shape', () => {
    process.env['JWT_SECRET'] = 'test-secret';
    const strategy = new JwtStrategy();

    const payload = {
      sub: 'user-uuid',
      tenant_id: 'tenant-uuid',
      roles: ['staff'],
      iat: 1700000000,
      exp: 1700000900,
    };

    const result = strategy.validate(payload);

    expect(result).toEqual({
      id: 'user-uuid',
      tenantId: 'tenant-uuid',
      roles: ['staff'],
    });
  });
});
