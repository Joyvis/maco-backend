export interface SaleOrderResponseDto {
  id: string;
  state: string;
  scheduled_at: string;
  service_name: string;
  professional_name?: string;
  total_amount: number;
  created_at: string;
}

export interface BookingResultDto {
  id: string;
  requires_payment: boolean;
  payment_url?: string;
}

export interface RefundPolicyDto {
  id: string;
  description: string;
  refund_percentage: number;
}
