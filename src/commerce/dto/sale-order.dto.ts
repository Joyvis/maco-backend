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
  // Canonical slot start (UTC ISO); null for pickup orders. The FE uses this
  // for the post-create redirect instead of re-deriving the date locally.
  scheduled_start_at: string | null;
  booking_channel: string | null;
  notes: string | null;
}

export interface BookingQuoteLineDto {
  catalog_item_type: 'service' | 'product' | 'combo';
  catalog_item_id: string;
  name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  duration_minutes: number;
  is_dependency: boolean;
  assigned_staff_id?: string;
  // Resolved server-side from `assigned_staff_id` so the review screen can
  // render the staff label ("com Ana Lima") without a second round-trip.
  // Undefined when no staff is assigned ("Qualquer Profissional").
  assigned_staff_name?: string;
  slot_start_at?: string;
  slot_end_at?: string;
}

export interface BookingQuoteDto {
  fulfillment: 'appointment' | 'pickup';
  scheduled_start_at?: string;
  scheduled_end_at?: string;
  total_duration_minutes: number;
  total_amount: number;
  lines: BookingQuoteLineDto[];
}

export interface RefundPolicyDto {
  id: string;
  description: string;
  refund_percentage: number;
}
