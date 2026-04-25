import { Test, TestingModule } from '@nestjs/testing';
import { CommandBus, EventBus, CqrsModule } from '@nestjs/cqrs';
import { AppModule } from '../src/app.module';
import { CreateTenantCommand } from '../src/tenancy/commands/create-tenant.command';
import { TenantCreatedEvent } from '../src/tenancy/events/tenant-created.event';

// AC7: full round-trip, AC8: CqrsModule available in any module
describe('CQRS Round-Trip (e2e)', () => {
  let app: TestingModule;
  let commandBus: CommandBus;
  let eventBus: EventBus;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    await app.init();

    commandBus = app.get<CommandBus>(CommandBus);
    eventBus = app.get<EventBus>(EventBus);
  });

  afterAll(async () => {
    await app.close();
  });

  // AC8: CommandBus and EventBus available after bootstrap
  it('CommandBus and EventBus are injectable after bootstrap', () => {
    expect(commandBus).toBeDefined();
    expect(eventBus).toBeDefined();
  });

  // AC7: full command → handler → event → event-handler round-trip
  it('dispatching CreateTenantCommand triggers TenantCreatedEvent handler', async () => {
    const receivedEvents: TenantCreatedEvent[] = [];
    const subscription = eventBus.subscribe((event) => {
      if (event instanceof TenantCreatedEvent) {
        receivedEvents.push(event);
      }
    });

    const command = new CreateTenantCommand('tenant-uuid', 'user-uuid', 'Acme Corp');
    await commandBus.execute(command);

    // Allow async event propagation
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(receivedEvents.length).toBeGreaterThanOrEqual(1);
    const event = receivedEvents[0];
    expect(event.tenant_id).toBe('tenant-uuid');
    expect(event.source_command).toBe('CreateTenantCommand');
    expect(event.correlation_id).toBeTruthy();
    expect(event.timestamp).toBeInstanceOf(Date);

    subscription.unsubscribe();
  });
});
