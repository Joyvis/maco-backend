/* eslint-disable @typescript-eslint/require-await */
import { Migration } from '@mikro-orm/migrations';

export class Migration20260509000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      alter table "tenants"
        add column "address_line1" varchar(255) null,
        add column "address_line2" varchar(255) null,
        add column "state" varchar(255) null,
        add column "postal_code" varchar(32) null,
        add column "latitude" numeric(9, 6) null,
        add column "longitude" numeric(9, 6) null;
    `);

    this.addSql(`create type "sale_order_fulfillment" as enum ('appointment', 'pickup');`);
    this.addSql(
      `alter table "sale_orders" add column "fulfillment" "sale_order_fulfillment" null;`,
    );
    this.addSql(
      `update "sale_orders" set "fulfillment" = 'appointment' where "fulfillment" is null;`,
    );
    this.addSql(`alter table "sale_orders" alter column "fulfillment" set not null;`);
    this.addSql(`alter table "sale_orders" add column "picked_up_at" timestamptz null;`);

    this.addSql(`alter table "sale_orders" alter column "service_id" drop not null;`);
    this.addSql(`alter table "sale_orders" alter column "scheduled_at" drop not null;`);
    this.addSql(`alter table "sale_orders" alter column "scheduled_end_at" drop not null;`);

    this.addSql(`drop index if exists "sale_orders_active_slot_unique";`);

    this.addSql(`create type "sale_order_item_type" as enum ('service', 'product', 'combo');`);

    this.addSql(`
      alter table "sale_order_items"
        add column "catalog_item_type" "sale_order_item_type" null,
        add column "catalog_item_id" uuid null,
        add column "product_id" uuid null,
        add column "combo_id" uuid null,
        add column "assigned_staff_id" uuid null,
        add column "slot_start_at" timestamptz null,
        add column "slot_end_at" timestamptz null,
        add column "quantity" integer not null default 1,
        add column "combo_components" jsonb null;
    `);

    this.addSql(`
      update "sale_order_items" i set
        "catalog_item_type" = 'service',
        "catalog_item_id" = i."service_id",
        "assigned_staff_id" = (select "staff_id" from "sale_orders" so where so."id" = i."sale_order_id"),
        "slot_start_at" = (select "scheduled_at" from "sale_orders" so where so."id" = i."sale_order_id"),
        "slot_end_at" = (select "scheduled_end_at" from "sale_orders" so where so."id" = i."sale_order_id")
      where "catalog_item_type" is null;
    `);

    this.addSql(`alter table "sale_order_items" alter column "catalog_item_type" set not null;`);
    this.addSql(`alter table "sale_order_items" alter column "catalog_item_id" set not null;`);
    this.addSql(`alter table "sale_order_items" alter column "service_id" drop not null;`);

    this.addSql(`
      alter table "sale_order_items"
        add constraint "sale_order_items_quantity_check" check ("quantity" >= 1);
    `);
    this.addSql(`
      alter table "sale_order_items"
        add constraint "sale_order_items_product_id_fkey"
        foreign key ("product_id") references "products" ("id") on update cascade;
    `);
    this.addSql(`
      alter table "sale_order_items"
        add constraint "sale_order_items_combo_id_fkey"
        foreign key ("combo_id") references "combos" ("id") on update cascade;
    `);
    this.addSql(`
      alter table "sale_order_items"
        add constraint "sale_order_items_assigned_staff_id_fkey"
        foreign key ("assigned_staff_id") references "users" ("id") on update cascade on delete set null;
    `);

    this.addSql(
      `create index "sale_order_items_assigned_staff_id_index" on "sale_order_items" ("assigned_staff_id");`,
    );
    this.addSql(
      `create index "sale_order_items_slot_start_at_index" on "sale_order_items" ("slot_start_at");`,
    );
    this.addSql(
      `create index "sale_order_items_catalog_item_id_index" on "sale_order_items" ("catalog_item_id");`,
    );
  }

  async down(): Promise<void> {
    this.addSql(`drop index if exists "sale_order_items_catalog_item_id_index";`);
    this.addSql(`drop index if exists "sale_order_items_slot_start_at_index";`);
    this.addSql(`drop index if exists "sale_order_items_assigned_staff_id_index";`);

    this.addSql(
      `alter table "sale_order_items" drop constraint if exists "sale_order_items_assigned_staff_id_fkey";`,
    );
    this.addSql(
      `alter table "sale_order_items" drop constraint if exists "sale_order_items_combo_id_fkey";`,
    );
    this.addSql(
      `alter table "sale_order_items" drop constraint if exists "sale_order_items_product_id_fkey";`,
    );
    this.addSql(
      `alter table "sale_order_items" drop constraint if exists "sale_order_items_quantity_check";`,
    );

    this.addSql(`alter table "sale_order_items" alter column "service_id" set not null;`);
    this.addSql(`
      alter table "sale_order_items"
        drop column "catalog_item_type",
        drop column "catalog_item_id",
        drop column "product_id",
        drop column "combo_id",
        drop column "assigned_staff_id",
        drop column "slot_start_at",
        drop column "slot_end_at",
        drop column "quantity",
        drop column "combo_components";
    `);
    this.addSql(`drop type if exists "sale_order_item_type";`);

    this.addSql(`
      create unique index "sale_orders_active_slot_unique"
        on "sale_orders" ("staff_id", "scheduled_at")
        where "state" in ('pending_payment','pending_checkout','confirmed','checked_in','in_progress')
          and "staff_id" is not null;
    `);

    this.addSql(`alter table "sale_orders" alter column "scheduled_end_at" set not null;`);
    this.addSql(`alter table "sale_orders" alter column "scheduled_at" set not null;`);
    this.addSql(`alter table "sale_orders" alter column "service_id" set not null;`);
    this.addSql(`alter table "sale_orders" drop column "picked_up_at";`);
    this.addSql(`alter table "sale_orders" drop column "fulfillment";`);
    this.addSql(`drop type if exists "sale_order_fulfillment";`);

    this.addSql(`
      alter table "tenants"
        drop column "address_line1",
        drop column "address_line2",
        drop column "state",
        drop column "postal_code",
        drop column "latitude",
        drop column "longitude";
    `);
  }
}
