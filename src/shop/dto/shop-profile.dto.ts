export interface ShopServiceDto {
  id: string;
  name: string;
  description?: string;
  category?: string;
  duration_minutes: number;
  base_price: number;
}

export interface ShopStaffQualifiedServiceDto {
  id: string;
  name: string;
}

export interface ShopStaffDto {
  user_id: string;
  name: string;
  photo_url?: string;
  qualified_services: ShopStaffQualifiedServiceDto[];
}

export interface ShopProductDto {
  id: string;
  name: string;
  description?: string;
  category?: string;
  base_price: number;
  unit: 'ml' | 'g' | 'unit' | 'kg' | 'l';
}

export interface ShopComboItemDto {
  catalog_item_type: 'service' | 'product';
  catalog_item_id: string;
  name: string;
  base_price: number;
  duration_minutes?: number;
  quantity: number;
}

export interface ShopComboDto {
  id: string;
  name: string;
  description?: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  items: ShopComboItemDto[];
  total_duration_minutes: number;
  subtotal: number;
  total: number;
}

export interface ShopAddressDto {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postal_code: string;
  coordinates?: { lat: number; lng: number };
}

export interface ShopProfileDto {
  slug: string;
  name: string;
  logo_url?: string;
  city?: string;
  rating?: number;
  services: ShopServiceDto[];
  staff: ShopStaffDto[];
  combos: ShopComboDto[];
  products: ShopProductDto[];
  address?: ShopAddressDto;
}
