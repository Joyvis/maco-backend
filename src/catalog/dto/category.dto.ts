export interface Category {
  id: string;
  name: string;
  display_order?: number;
}

export interface ListCategoriesResponse {
  data: Category[];
}

export interface CategoryResponse {
  data: Category;
}
