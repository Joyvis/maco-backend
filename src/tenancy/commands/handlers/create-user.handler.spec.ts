import { EntityManager } from '@mikro-orm/core';
import { getRepositoryToken } from '@mikro-orm/nestjs';
import { ConflictException } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';

import { UserRoleType } from '../../dto/create-user.dto';
import { Role } from '../../entities/role.entity';
import { UserRole } from '../../entities/user-role.entity';
import { User, UserState } from '../../entities/user.entity';
import { UserCreatedEvent } from '../../events/user-created.event';
import { CreateUserCommand } from '../create-user.command';

import { CreateUserHandler } from './create-user.handler';

const TENANT_ID = 'aaaaaaaa-0000-7000-8000-000000000001';
const ACTOR_ID = 'bbbbbbbb-0000-7000-8000-000000000001';

function makeCommand(
  overrides: Partial<{
    email: string;
    full_name: string;
    phone?: string;
    initial_roles: UserRoleType[];
  }> = {},
) {
  return new CreateUserCommand(TENANT_ID, ACTOR_ID, {
    email: 'new@example.com',
    full_name: 'John Doe',
    initial_roles: [],
    ...overrides,
  });
}

describe('CreateUserHandler', () => {
  let handler: CreateUserHandler;
  let userRepo: { findOne: jest.Mock };
  let roleRepo: { find: jest.Mock };
  let em: { create: jest.Mock; persistAndFlush: jest.Mock };
  let eventBus: jest.Mocked<EventBus>;

  beforeEach(async () => {
    userRepo = { findOne: jest.fn().mockResolvedValue(null) };
    roleRepo = { find: jest.fn().mockResolvedValue([]) };
    em = {
      create: jest.fn().mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({
        ...data,
        id: (data['id'] as string) ?? 'generated-uuid',
        created_at: new Date(),
      })),
      persistAndFlush: jest.fn().mockResolvedValue(undefined),
    };
    eventBus = { publish: jest.fn() } as unknown as jest.Mocked<EventBus>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreateUserHandler,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Role), useValue: roleRepo },
        { provide: EntityManager, useValue: em },
        { provide: EventBus, useValue: eventBus },
      ],
    }).compile();

    handler = module.get(CreateUserHandler);
  });

  // AC1 — happy path: user created with role, correct response shape
  it('creates user with ACTIVE state and returns correct response', async () => {
    const staffRole = { name: 'staff', id: 'role-id-1', tenant_id: TENANT_ID };
    roleRepo.find.mockResolvedValue([staffRole]);

    const command = makeCommand({ initial_roles: [UserRoleType.STAFF] });
    const result = await handler.execute(command);

    expect(result.email).toBe('new@example.com');
    expect(result.full_name).toBe('John Doe');
    expect(result.state).toBe('active');
    expect(result.tenant_id).toBe(TENANT_ID);
    expect(result.roles).toEqual(['staff']);
    expect(result.phone).toBeNull();
    expect(result.created_at).toEqual(expect.any(String));
  });

  // AC1 — user entity persisted with correct fields
  it('persists user entity with correct fields', async () => {
    const command = makeCommand();
    await handler.execute(command);

    expect(em.persistAndFlush).toHaveBeenCalledTimes(1);
    const allCalls = em.create.mock.calls as [unknown, Record<string, unknown>][];
    const userCalls = allCalls.filter((c) => c[0] === User);
    expect(userCalls).toHaveLength(1);

    const userData = userCalls[0]?.[1];
    expect(userData?.['email']).toBe('new@example.com');
    expect(userData?.['state']).toBe(UserState.ACTIVE);
    expect(userData?.['tenant_id']).toBe(TENANT_ID);
    expect(userData?.['full_name']).toBe('John Doe');
  });

  // AC1 — password is hashed (bcrypt format), never the raw value
  it('stores bcrypt-hashed password_hash, not raw password', async () => {
    const command = makeCommand();
    await handler.execute(command);

    const allCalls = em.create.mock.calls as [unknown, Record<string, unknown>][];
    const userCalls = allCalls.filter((c) => c[0] === User);
    const passwordHash = userCalls[0]?.[1]['password_hash'] as string;

    expect(passwordHash).toBeDefined();
    expect(passwordHash.startsWith('$2b$')).toBe(true);
  });

  // AC1 — UserRole entries created for each initial role
  it('creates UserRole entries for each initial role', async () => {
    const staffRole = { name: 'staff', id: 'role-id-1', tenant_id: TENANT_ID };
    roleRepo.find.mockResolvedValue([staffRole]);

    const command = makeCommand({ initial_roles: [UserRoleType.STAFF] });
    await handler.execute(command);

    const allCalls = em.create.mock.calls as [unknown, Record<string, unknown>][];
    const urCalls = allCalls.filter((c) => c[0] === UserRole);
    expect(urCalls).toHaveLength(1);
  });

  // AC2 — happy path: no roles
  it('creates user without roles when initial_roles is empty', async () => {
    const command = makeCommand({ initial_roles: [] });
    const result = await handler.execute(command);

    expect(result.roles).toEqual([]);

    const allCalls = em.create.mock.calls as [unknown, Record<string, unknown>][];
    const urCalls = allCalls.filter((c) => c[0] === UserRole);
    expect(urCalls).toHaveLength(0);
  });

  // AC1 — UserCreatedEvent published with correct payload
  it('publishes UserCreatedEvent with correct payload', async () => {
    const staffRole = { name: 'staff', id: 'role-id-1', tenant_id: TENANT_ID };
    roleRepo.find.mockResolvedValue([staffRole]);

    const command = makeCommand({ initial_roles: [UserRoleType.STAFF] });
    await handler.execute(command);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    const event = eventBus.publish.mock.calls[0]?.[0] as UserCreatedEvent;
    expect(event).toBeInstanceOf(UserCreatedEvent);
    expect(event.tenant_id).toBe(TENANT_ID);
    expect(event.email).toBe('new@example.com');
    expect(event.full_name).toBe('John Doe');
    expect(event.roles).toEqual(['staff']);
    expect(event.correlation_id).toBe(command.correlation_id);
    expect(event.source_command).toBe('CreateUserCommand');
  });

  // AC3 — duplicate email within tenant → 409
  it('throws ConflictException when email already exists in tenant', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'existing-user', email: 'new@example.com' });

    const command = makeCommand();
    await expect(handler.execute(command)).rejects.toThrow(ConflictException);
  });

  // AC3 — no event emitted when conflict is detected
  it('does not publish event when ConflictException is thrown', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'existing-user', email: 'new@example.com' });

    const command = makeCommand();
    await expect(handler.execute(command)).rejects.toThrow(ConflictException);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  // AC4 — same email allowed in different tenant (uniqueness check is per tenant_id)
  it('queries uniqueness with both email and tenant_id', async () => {
    const command = makeCommand();
    await handler.execute(command);

    expect(userRepo.findOne).toHaveBeenCalledWith(
      { email: 'new@example.com', tenant_id: TENANT_ID },
      { filters: false },
    );
  });
});
