/* eslint-disable @typescript-eslint/require-await */
import { Migration } from '@mikro-orm/migrations';

export class Migration20260506000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`create type "combo_status" as enum ('active', 'archived');`);
    this.addSql(`create type "combo_item_type" as enum ('service', 'product');`);

    this.addSql(`
      create table "combos" (
        "id" uuid not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "tenant_id" uuid not null,
        "name" varchar(255) not null,
        "description" text null,
        "discount_percentage" numeric(5, 2) not null,
        "status" "combo_status" not null default 'active',
        constraint "combos_pkey" primary key ("id"),
        constraint "combos_discount_percentage_check"
          check ("discount_percentage" >= 0 and "discount_percentage" <= 100)
      );
    `);
    this.addSql(`create index "combos_tenant_id_index" on "combos" ("tenant_id");`);

    this.addSql(`
      create table "combo_items" (
        "id" uuid not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "tenant_id" uuid not null,
        "combo_id" uuid not null,
        "item_type" "combo_item_type" not null,
        "service_id" uuid null,
        "product_id" uuid null,
        constraint "combo_items_pkey" primary key ("id"),
        constraint "combo_items_polymorphic_check" check (
          ("item_type" = 'service' and "service_id" is not null and "product_id" is null)
          or ("item_type" = 'product' and "product_id" is not null and "service_id" is null)
        )
      );
    `);
    this.addSql(`create index "combo_items_tenant_id_index" on "combo_items" ("tenant_id");`);
    this.addSql(`create index "combo_items_combo_id_index" on "combo_items" ("combo_id");`);
    this.addSql(`create index "combo_items_service_id_index" on "combo_items" ("service_id");`);
    this.addSql(`create index "combo_items_product_id_index" on "combo_items" ("product_id");`);

    this.addSql(`
      alter table "combo_items"
        add constraint "combo_items_combo_id_fkey"
        foreign key ("combo_id") references "combos" ("id") on update cascade on delete cascade;
    `);
    this.addSql(`
      alter table "combo_items"
        add constraint "combo_items_service_id_fkey"
        foreign key ("service_id") references "services" ("id") on update cascade on delete cascade;
    `);
    this.addSql(`
      alter table "combo_items"
        add constraint "combo_items_product_id_fkey"
        foreign key ("product_id") references "products" ("id") on update cascade on delete cascade;
    `);

    this.addSql(`
      create unique index "combo_items_combo_service_unique"
        on "combo_items" ("combo_id", "service_id")
        where "service_id" is not null;
    `);
    this.addSql(`
      create unique index "combo_items_combo_product_unique"
        on "combo_items" ("combo_id", "product_id")
        where "product_id" is not null;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "combo_items";`);
    this.addSql(`drop table if exists "combos";`);
    this.addSql(`drop type if exists "combo_item_type";`);
    this.addSql(`drop type if exists "combo_status";`);
  }
}
