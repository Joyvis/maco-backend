import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PaymentsService } from './payments.service';

@Injectable()
export class PaymentsCron {
  private readonly logger = new Logger(PaymentsCron.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  // Every minute, on the second :00 mark.
  @Cron('0 */1 * * * *')
  async expirePending(): Promise<void> {
    try {
      const expired = await this.paymentsService.expirePending();
      if (expired > 0) {
        this.logger.log(`Expired ${expired} pending payment(s)`);
      }
    } catch (err) {
      this.logger.error('Failed to expire pending payments', err as Error);
    }
  }
}
