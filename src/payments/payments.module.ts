import { SaleOrder } from '@commerce/entities/sale-order.entity';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { User } from '@tenancy/entities/user.entity';

import { Payment } from './entities/payment.entity';
import { MockPaymentController } from './mock-payment.controller';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment-provider.interface';
import { PaymentsController } from './payments.controller';
import { PaymentsCron } from './payments.cron';
import { PaymentsService } from './payments.service';
import { MockPaymentProvider } from './providers/mock-payment.provider';
import { StonePaymentProvider } from './providers/stone-payment.provider';

/**
 * Conditional module — Layer 2 of the four security layers documented in the
 * plan. The mock-only controllers (`POST /payments/webhook/mock`,
 * `POST /payments/_test/run-expiration`) are ONLY registered when
 * `PAYMENT_PROVIDER=mock`. With `stone` (or anything else) Nest's router
 * literally has no entry for those paths and returns a real 404.
 */
@Global()
@Module({})
export class PaymentsModule {
  static register(): DynamicModule {
    const providerName = (process.env.PAYMENT_PROVIDER ?? 'mock').toLowerCase();
    const isMock = providerName === 'mock';

    const providerImpl: Provider = {
      provide: PAYMENT_PROVIDER,
      useClass: isMock ? MockPaymentProvider : StonePaymentProvider,
    };

    const controllers = isMock ? [PaymentsController, MockPaymentController] : [PaymentsController];

    return {
      module: PaymentsModule,
      global: true,
      imports: [MikroOrmModule.forFeature([Payment, SaleOrder, User])],
      controllers,
      providers: [
        PaymentsService,
        PaymentsCron,
        providerImpl,
        // Also expose concrete classes so Nest can DI them where useful in tests.
        MockPaymentProvider,
        StonePaymentProvider,
      ],
      exports: [PaymentsService, PAYMENT_PROVIDER],
    };
  }
}

export type { PaymentProvider };
