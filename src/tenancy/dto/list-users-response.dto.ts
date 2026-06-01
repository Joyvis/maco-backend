export interface ManagedRoleDto {
  id: string;
  name: string;
}

export class ManagedUserDto {
  id!: string;
  email!: string;
  name!: string;
  phone?: string | null;
  roles!: ManagedRoleDto[];
  status!: 'active' | 'inactive';
  created_at!: string;
  // Count of sale_orders the user has as a customer. Used by the customer
  // typeahead chip in the TA novo-agendamento form. Returned for every user
  // — for staff/owner personas it's effectively always 0.
  visit_count!: number;
}

export class ListUsersResponseDto {
  data!: ManagedUserDto[];
  meta!: {
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
  };
}
