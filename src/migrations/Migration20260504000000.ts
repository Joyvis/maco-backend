/* eslint-disable @typescript-eslint/require-await */
import { Migration } from '@mikro-orm/migrations';

export class Migration20260504000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`create type "product_unit" as enum ('ml', 'g', 'unit', 'kg', 'l');`);
    this.addSql(`create type "product_status" as enum ('draft', 'active', 'archived');`);

    this.addSql(`
      create table "categories" (
        "id" uuid not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "tenant_id" uuid not null,
        "name" varchar(255) not null,
        "display_order" integer null,
        constraint "categories_pkey" primary key ("id")
      );
    `);
    this.addSql(`create index "categories_tenant_id_index" on "categories" ("tenant_id");`);

    this.addSql(`
      create table "products" (
        "id" uuid not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "tenant_id" uuid not null,
        "name" varchar(255) not null,
        "description" text null,
        "category_id" uuid null,
        "unit" "product_unit" not null,
        "base_price" numeric(12, 2) not null,
        "status" "product_status" not null default 'draft',
        constraint "products_pkey" primary key ("id")
      );
    `);
    this.addSql(`create index "products_tenant_id_index" on "products" ("tenant_id");`);
    this.addSql(`create index "products_category_id_index" on "products" ("category_id");`);
    this.addSql(`
      alter table "products"
        add constraint "products_category_id_fkey"
        foreign key ("category_id") references "categories" ("id") on update cascade on delete set null;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`alter table "products" drop constraint if exists "products_category_id_fkey";`);
    this.addSql(`drop index if exists "products_category_id_index";`);
    this.addSql(`drop index if exists "products_tenant_id_index";`);
    this.addSql(`drop table if exists "products";`);

    this.addSql(`drop index if exists "categories_tenant_id_index";`);
    this.addSql(`drop table if exists "categories";`);

    this.addSql(`drop type if exists "product_status";`);
    this.addSql(`drop type if exists "product_unit";`);
  }
}
