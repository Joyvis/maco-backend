import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotImplementedException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '@tenancy/auth/current-user.decorator';
import { RequestUser } from '@tenancy/auth/jwt-payload.interface';
import { Public } from '@tenancy/auth/public.decorator';

import { PaymentResponseDto } from './dto/payments.dto';
import { Payment } from './entities/payment.entity';
import { PaymentsService } from './payments.service';

@Controller()
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Stone webhook target — STUB. Will be implemented when Stone wiring lands.
   * Always returns 501 today; the route is mounted permanently so the diff to
   * enable real Stone is small. The HMAC-signature check (using
   * STONE_WEBHOOK_SECRET) will live here against the raw request body.
   */
  @Public()
  @Post('payments/webhook/stone')
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  handleStoneWebhook(): { error: string } {
    throw new NotImplementedException(
      'Stone webhook handler is not implemented yet — enable when STONE_* env is set.',
    );
  }

  @Get('sale-orders/:id/payments')
  async listForOrder(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<{ data: PaymentResponseDto[] }> {
    const payments = await this.paymentsService.listPaymentsForOrder(user.tenantId, user.id, id);
    return { data: payments.map(toPaymentDto) };
  }
}

export function toPaymentDto(p: Payment): PaymentResponseDto {
  return {
    id: p.id,
    sale_order_id: p.sale_order.id,
    amount: Number(p.amount),
    currency: p.currency,
    state: p.state,
    provider: p.provider,
    provider_session_id: p.provider_session_id,
    provider_metadata: p.provider_metadata,
    error_message: p.error_message,
    expires_at: p.expires_at.toISOString(),
    created_at: p.created_at.toISOString(),
  };
}
