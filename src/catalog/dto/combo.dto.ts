export type ComboStatus = 'active' | 'archived';
export type ComboItemType = 'service' | 'product';

export interface ComboItem {
  id: string;
  item_type: ComboItemType;
  item_id: string;
  name: string;
  base_price: number;
}

export interface ComboSummary {
  id: string;
  name: string;
  description?: string;
  discount_percentage: number;
  status: ComboStatus;
  item_count: number;
  created_at: string;
}

export interface Combo extends ComboSummary {
  items: ComboItem[];
}

export interface PaginationMeta {
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface ListCombosResponse {
  data: ComboSummary[];
  meta: PaginationMeta;
}

export interface ComboResponse {
  data: Combo;
}
