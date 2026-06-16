import { SaleOrderState } from '../entities/sale-order.entity';

export interface AgendaAppointmentDto {
  id: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string;
  services: string;
  // Canonical order-level times. Same semantic as the field of the same name
  // on `/sale-orders`: the customer-facing "when was this booked for". The
  // detail sheet renders these so a multi-staff combo shows the same start
  // in every staff column.
  scheduled_start_at: string;
  scheduled_end_at: string | null;
  duration_minutes: number | null;
  // Per-column block placement for the agenda grid. For a multi-staff combo,
  // each staff column gets the slot window of the items that staff owns —
  // distinct from the order-level canonical times above. The grid renderer
  // uses these to position and size the block; never display them as "the
  // appointment time".
  block_start_at: string;
  block_end_at: string | null;
  block_duration_minutes: number | null;
  state: SaleOrderState;
  total: number;
  booking_channel: string | null;
  created_at: string;
  notes: string | null;
}

export interface AgendaStaffEntryDto {
  id: string;
  name: string;
  schedule_start: string | null;
  schedule_end: string | null;
  appointment_count: number;
  appointments: AgendaAppointmentDto[];
}

export interface AgendaResponseDto {
  staff: AgendaStaffEntryDto[];
  unassigned: AgendaAppointmentDto[];
}
