export interface SaleOrderItemDto {
  id: string;
  catalog_item_type: 'service' | 'product' | 'combo';
  name: string;
  quantity: number;
  assigned_staff_name?: string;
  slot_start_at?: string;
}

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
  items: SaleOrderItemDto[];
}

export interface BookingResultDto {
  id: string;
  requires_payment: boolean;
  payment_url?: string;
  booking_channel: string | null;
  notes: string | null;
}

export interface RefundPolicyDto {
  id: string;
  description: string;
  refund_percentage: number;
}
