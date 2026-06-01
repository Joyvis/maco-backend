import { MikroOrmModule } from '@mikro-orm/nestjs';
import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { MagicLinkAttempt } from '@tenancy/entities/magic-link-attempt.entity';
import { Tenant } from '@tenancy/entities/tenant.entity';

import { MESSAGE_PROVIDER, MessageProvider } from './message-provider.interface';
import { MockMessageProvider } from './providers/mock-message.provider';
import { TwilioMessageProvider } from './providers/twilio-message.provider';
import { TestMagicLinkController } from './test-magic-link.controller';

/**
 * Conditional module — mirrors `PaymentsModule.register()`. The mock-only test
 * controller (`GET /_test/last-magic-link`) is ONLY registered when
 * `MESSAGE_PROVIDER=mock` AND `NODE_ENV=test`. With any other combination the
 * Nest router has no entry for that path and returns a real 404.
 */
@Global()
@Module({})
export class MessagingModule {
  static register(): DynamicModule {
    const providerName = (process.env.MESSAGE_PROVIDER ?? 'mock').toLowerCase();
    const isMock = providerName === 'mock';
    const isTest = process.env.NODE_ENV === 'test';

    const providerImpl: Provider = {
      provide: MESSAGE_PROVIDER,
      useClass: isMock ? MockMessageProvider : TwilioMessageProvider,
    };

    const controllers = isMock && isTest ? [TestMagicLinkController] : [];

    return {
      module: MessagingModule,
      global: true,
      imports: [MikroOrmModule.forFeature([MagicLinkAttempt, Tenant])],
      controllers,
      providers: [providerImpl, MockMessageProvider, TwilioMessageProvider],
      exports: [MESSAGE_PROVIDER],
    };
  }
}

export type { MessageProvider };
