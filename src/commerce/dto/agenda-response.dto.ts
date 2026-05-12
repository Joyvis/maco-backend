import { SaleOrderState } from '../entities/sale-order.entity';

export interface AgendaAppointmentDto {
  id: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string;
  services: string;
  scheduled_start_at: string;
  scheduled_end_at: string | null;
  duration_minutes: number | null;
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
