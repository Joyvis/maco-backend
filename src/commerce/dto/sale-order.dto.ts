export interface SaleOrderResponseDto {
  id: string;
  state: string;
  fulfillment: 'appointment' | 'pickup';
  scheduled_at?: string;
  service_name?: string;
  professional_name?: string;
  total_amount: number;
  picked_up_at?: string;
  booking_channel: string | null;
  notes: string | null;
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
