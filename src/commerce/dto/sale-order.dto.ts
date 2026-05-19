export interface SaleOrderItemDto {
  id: string;
  type: 'service' | 'product' | 'combo';
  name: string;
  price: number;
  quantity: number;
}

export interface SaleOrderResponseDto {
  id: string;
  state: string;
  fulfillment: 'appointment' | 'pickup';
  scheduled_at?: string;
  scheduled_start_at?: string;
  scheduled_end_at?: string;
  service_name?: string;
  service_price?: number;
  professional_name?: string;
  staff_name?: string;
  staff_id?: string;
  customer_id?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_email?: string;
  total_amount: number;
  prepayment_required?: boolean;
  picked_up_at?: string;
  checked_in_at?: string;
  started_at?: string;
  completed_at?: string;
  no_show_at?: string;
  cancelled_at?: string;
  order_number?: string;
  items?: SaleOrderItemDto[];
  booking_channel: string | null;
  payment_method?: string;
  notes: string | null;
  created_at: string;
}

export interface BookingResultDto {
  id: string;
  requires_payment: boolean;
  payment_url?: string;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  booking_channel: string | null;
  notes: string | null;
}

export interface RefundPolicyDto {
  id: string;
  description: string;
  refund_percentage: number;
}
