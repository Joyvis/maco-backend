export type ProductUnit = 'ml' | 'g' | 'unit' | 'kg' | 'l';
export type ProductStatus = 'draft' | 'active' | 'archived';

export interface Product {
  id: string;
  name: string;
  description?: string;
  category?: string;
  unit: ProductUnit;
  base_price: number;
  status: ProductStatus;
  created_at: string;
}

export interface PaginationMeta {
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface ListProductsResponse {
  data: Product[];
  meta: PaginationMeta;
}

export interface ProductResponse {
  data: Product;
}
