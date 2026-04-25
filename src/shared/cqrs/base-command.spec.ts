import { BaseCommand } from './base-command';

class TestCommand extends BaseCommand {
  constructor(tenant_id: string, user_id: string) {
    super(tenant_id, user_id);
  }
}

describe('BaseCommand', () => {
  it('sets tenant_id, user_id, and timestamp on valid construction', () => {
    const cmd = new TestCommand('tenant-uuid', 'user-uuid');
    expect(cmd.tenant_id).toBe('tenant-uuid');
    expect(cmd.user_id).toBe('user-uuid');
    expect(cmd.timestamp).toBeInstanceOf(Date);
  });

  // AC3
  it('throws when tenant_id is missing', () => {
    expect(() => new TestCommand('', 'user-uuid')).toThrow('tenant_id is required');
  });

  // AC4
  it('throws when user_id is missing', () => {
    expect(() => new TestCommand('tenant-uuid', '')).toThrow('user_id is required');
  });

  it('throws when tenant_id is null-ish', () => {
    expect(() => new TestCommand(null as unknown as string, 'user-uuid')).toThrow('tenant_id is required');
  });
});
