import { EntityManager, EntityRepository, RequestContext } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EventsHandler } from '@nestjs/cqrs';
import { BaseEventHandler } from '@shared/cqrs/base-event-handler';

import { TenantConfig } from '../../entities/tenant-config.entity';
import { TenantRegisteredEvent } from '../tenant-registered.event';

const DEFAULT_CONFIGS = [
  { key: 'locale', value: 'en' },
  { key: 'timezone', value: 'UTC' },
  { key: 'max_users', value: '50' },
] as const;

@EventsHandler(TenantRegisteredEvent)
export class TenantOnboardingHandler extends BaseEventHandler<TenantRegisteredEvent> {
  constructor(
    @InjectRepository(TenantConfig)
    private readonly configRepo: EntityRepository<TenantConfig>,
    private readonly em: EntityManager,
  ) {
    super();
  }

  async process(event: TenantRegisteredEvent): Promise<void> {
    await RequestContext.create(this.em, async () => {
      const configs = DEFAULT_CONFIGS.map(({ key, value }) =>
        this.em.create(TenantConfig, { tenant_id: event.tenant_id, key, value }),
      );
      await this.em.persistAndFlush(configs);
    });

    this.logger.log('Tenant onboarded: default configs seeded', {
      tenant_id: event.tenant_id,
      correlation_id: event.correlation_id,
    });
  }
}
