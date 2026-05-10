import { ComboItemType } from './entities/combo-item.entity';
import { Combo } from './entities/combo.entity';

export interface ComboPricingItem {
  catalog_item_type: 'service' | 'product';
  catalog_item_id: string;
  name: string;
  base_price: number;
  duration_minutes?: number;
  quantity: number;
}

export interface ComboPricing {
  items: ComboPricingItem[];
  total_duration_minutes: number;
  subtotal: number;
  total: number;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
}

export function computeComboPricing(combo: Combo): ComboPricing {
  const items: ComboPricingItem[] = combo.items.getItems().map((item) => {
    if (item.item_type === ComboItemType.SERVICE) {
      const service = item.service!;
      return {
        catalog_item_type: 'service' as const,
        catalog_item_id: service.id,
        name: service.name,
        base_price: Number(service.base_price),
        duration_minutes: service.duration_minutes,
        quantity: 1,
      };
    }
    const product = item.product!;
    return {
      catalog_item_type: 'product' as const,
      catalog_item_id: product.id,
      name: product.name,
      base_price: Number(product.base_price),
      quantity: 1,
    };
  });

  const total_duration_minutes = items.reduce((acc, i) => acc + (i.duration_minutes ?? 0), 0);
  const subtotal = items.reduce((acc, i) => acc + i.base_price * i.quantity, 0);
  const discount_value = Number(combo.discount_percentage);
  const total = round2(subtotal * (1 - discount_value / 100));

  return {
    items,
    total_duration_minutes,
    subtotal: round2(subtotal),
    total,
    discount_type: 'percentage',
    discount_value,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
