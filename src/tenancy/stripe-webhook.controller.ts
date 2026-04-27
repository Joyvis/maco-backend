import { createHmac, timingSafeEqual } from 'crypto';

import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Request } from 'express';

import { Public } from './auth/public.decorator';
import { TenancyService } from './tenancy.service';

@Controller('webhooks')
export class StripeWebhookController {
  constructor(private readonly tenancyService: TenancyService) {}

  @Public()
  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  async handleStripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') sig: string | undefined,
    @Body() body: Record<string, unknown>,
  ): Promise<{ received: boolean }> {
    const secret = process.env['STRIPE_WEBHOOK_SECRET'];
    if (!secret || !sig) {
      throw new BadRequestException('Missing Stripe signature');
    }

    const rawBody = req.rawBody?.toString() ?? JSON.stringify(body);
    if (!this.verifyStripeSignature(rawBody, sig, secret)) {
      throw new BadRequestException('Invalid Stripe signature');
    }

    if (body['type'] === 'checkout.session.completed') {
      const session = body['data'] as Record<string, unknown>;
      const metadata = (session['object'] as Record<string, unknown>)?.['metadata'] as
        | Record<string, string>
        | undefined;

      if (metadata?.['registration_pending']) {
        await this.tenancyService.activateTenantAfterPayment(metadata);
      }
    }

    return { received: true };
  }

  private verifyStripeSignature(payload: string, header: string, secret: string): boolean {
    const parts = header.split(',').reduce<Record<string, string>>((acc, part) => {
      const [k, v] = part.split('=');
      if (k && v) acc[k] = v;
      return acc;
    }, {});

    const timestamp = parts['t'];
    const expectedSig = parts['v1'];
    if (!timestamp || !expectedSig) return false;

    const signed = `${timestamp}.${payload}`;
    const computed = createHmac('sha256', secret).update(signed, 'utf8').digest('hex');

    try {
      return timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(expectedSig, 'hex'));
    } catch {
      return false;
    }
  }
}
