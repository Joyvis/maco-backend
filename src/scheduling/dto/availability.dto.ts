export interface TimeSlot {
  date: string;
  start_time: string;
  end_time: string;
  available: boolean;
}

export interface AvailabilitySlot {
  datetime: string;
  available: boolean;
}

export interface QualifiedStaff {
  user_id: string;
  name: string;
  email: string;
}
