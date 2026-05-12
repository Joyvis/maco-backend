import { IsIn, IsString, MinLength } from 'class-validator';

export class MockWebhookDto {
  @IsString()
  @MinLength(1)
  session_id!: string;

  @IsIn(['success', 'failure'])
  outcome!: 'success' | 'failure';
}

export interface PaymentResponseDto {
  id: string;
  sale_order_id: string;
  amount: number;
  currency: string;
  state: string;
  provider: string;
  provider_session_id?: string;
  provider_metadata: Record<string, unknown>;
  error_message?: string;
  expires_at: string;
  created_at: string;
}
