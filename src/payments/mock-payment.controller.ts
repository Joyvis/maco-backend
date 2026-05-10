import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Inject,
} from '@nestjs/common';
import { Public } from '@tenancy/auth/public.decorator';
import { Request } from 'express';

import { MockWebhookDto } from './dto/payments.dto';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment-provider.interface';
import { PaymentsService } from './payments.service';

/**
 * Mock-only routes. Mounted ONLY when `PAYMENT_PROVIDER=mock`
 * (see `PaymentsModule.register()`). The in-handler env guard is belt-and-
 * suspenders — Layer 3 of the four security layers documented in the plan.
 */
@Controller()
export class MockPaymentController {
  constructor(
    private readonly paymentsService: PaymentsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  @Public()
  @Post('payments/webhook/mock')
  @HttpCode(HttpStatus.OK)
  async handleMockWebhook(
    @Body() dto: MockWebhookDto,
    @Req() req: Request,
  ): Promise<{ status: string }> {
    if (process.env.PAYMENT_PROVIDER !== 'mock') {
      throw new ForbiddenException('Mock payment webhook is disabled');
    }

    const event = await this.provider.verifyWebhook({
      headers: req.headers,
      body: dto,
      rawBody: (req as unknown as { rawBody?: Buffer }).rawBody,
    });

    const result = await this.paymentsService.handleWebhookEvent(event);
    return { status: result.status };
  }

  /**
   * Test-only hook for forcing the expiration cron to run synchronously.
   * Gated by NODE_ENV=test — used by Playwright e2e to avoid waiting a minute
   * AND to force-expire payments whose `expires_at` is still in the future
   * (which is the normal case for a freshly-created order).
   */
  @Public()
  @Post('payments/_test/run-expiration')
  @HttpCode(HttpStatus.OK)
  async runExpiration(): Promise<{ expired: number }> {
    if (process.env.NODE_ENV !== 'test') {
      throw new ForbiddenException('Test-only endpoint');
    }
    const expired = await this.paymentsService.expirePending(new Date(), { force: true });
    return { expired };
  }
}
