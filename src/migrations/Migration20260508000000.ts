/* eslint-disable @typescript-eslint/require-await */
import { Migration } from '@mikro-orm/migrations';

export class Migration20260508000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      alter table "service_dependencies"
        add column "auto_include" boolean not null default true;
    `);

    this.addSql(`
      create table "staff_qualifications" (
        "id" uuid not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "tenant_id" uuid not null,
        "user_id" uuid not null,
        "service_id" uuid not null,
        constraint "staff_qualifications_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `create index "staff_qualifications_tenant_id_index" on "staff_qualifications" ("tenant_id");`,
    );
    this.addSql(
      `create index "staff_qualifications_user_id_index" on "staff_qualifications" ("user_id");`,
    );
    this.addSql(
      `create index "staff_qualifications_service_id_index" on "staff_qualifications" ("service_id");`,
    );
    this.addSql(`
      alter table "staff_qualifications"
        add constraint "staff_qualifications_user_id_fkey"
        foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;
    `);
    this.addSql(`
      alter table "staff_qualifications"
        add constraint "staff_qualifications_service_id_fkey"
        foreign key ("service_id") references "services" ("id") on update cascade on delete cascade;
    `);
    this.addSql(`
      alter table "staff_qualifications"
        add constraint "staff_qualifications_user_service_unique"
        unique ("user_id", "service_id");
    `);

    this.addSql(`
      create table "staff_schedules" (
        "id" uuid not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "tenant_id" uuid not null,
        "user_id" uuid not null,
        "day_of_week" integer not null,
        "start_time" time not null,
        "end_time" time not null,
        constraint "staff_schedules_pkey" primary key ("id"),
        constraint "staff_schedules_day_of_week_check" check ("day_of_week" >= 0 and "day_of_week" <= 6),
        constraint "staff_schedules_time_check" check ("start_time" < "end_time")
      );
    `);
    this.addSql(
      `create index "staff_schedules_tenant_id_index" on "staff_schedules" ("tenant_id");`,
    );
    this.addSql(`create index "staff_schedules_user_id_index" on "staff_schedules" ("user_id");`);
    this.addSql(`
      alter table "staff_schedules"
        add constraint "staff_schedules_user_id_fkey"
        foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;
    `);

    this.addSql(`create type "sale_order_state" as enum (
      'pending_payment', 'pending_checkout', 'confirmed', 'checked_in',
      'in_progress', 'completed', 'cancelled', 'no_show'
    );`);

    this.addSql(`
      create table "sale_orders" (
        "id" uuid not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "tenant_id" uuid not null,
        "customer_id" uuid not null,
        "service_id" uuid not null,
        "staff_id" uuid null,
        "state" "sale_order_state" not null,
        "scheduled_at" timestamptz not null,
        "scheduled_end_at" timestamptz not null,
        "total_amount" numeric(12, 2) not null,
        "requires_payment" boolean not null default false,
        "payment_url" text null,
        "cancellation_reason" varchar(64) null,
        "cancelled_at" timestamptz null,
        constraint "sale_orders_pkey" primary key ("id"),
        constraint "sale_orders_total_amount_check" check ("total_amount" >= 0)
      );
    `);
    this.addSql(`create index "sale_orders_tenant_id_index" on "sale_orders" ("tenant_id");`);
    this.addSql(`create index "sale_orders_customer_id_index" on "sale_orders" ("customer_id");`);
    this.addSql(`create index "sale_orders_staff_id_index" on "sale_orders" ("staff_id");`);
    this.addSql(`create index "sale_orders_state_index" on "sale_orders" ("state");`);
    this.addSql(`create index "sale_orders_scheduled_at_index" on "sale_orders" ("scheduled_at");`);

    this.addSql(`
      alter table "sale_orders"
        add constraint "sale_orders_customer_id_fkey"
        foreign key ("customer_id") references "users" ("id") on update cascade;
    `);
    this.addSql(`
      alter table "sale_orders"
        add constraint "sale_orders_service_id_fkey"
        foreign key ("service_id") references "services" ("id") on update cascade;
    `);
    this.addSql(`
      alter table "sale_orders"
        add constraint "sale_orders_staff_id_fkey"
        foreign key ("staff_id") references "users" ("id") on update cascade on delete set null;
    `);

    this.addSql(`
      create unique index "sale_orders_active_slot_unique"
        on "sale_orders" ("staff_id", "scheduled_at")
        where "state" in ('pending_payment','pending_checkout','confirmed','checked_in','in_progress')
          and "staff_id" is not null;
    `);

    this.addSql(`
      create table "sale_order_items" (
        "id" uuid not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "tenant_id" uuid not null,
        "sale_order_id" uuid not null,
        "service_id" uuid not null,
        "price" numeric(12, 2) not null,
        "is_dependency" boolean not null default false,
        constraint "sale_order_items_pkey" primary key ("id"),
        constraint "sale_order_items_price_check" check ("price" >= 0)
      );
    `);
    this.addSql(
      `create index "sale_order_items_tenant_id_index" on "sale_order_items" ("tenant_id");`,
    );
    this.addSql(
      `create index "sale_order_items_sale_order_id_index" on "sale_order_items" ("sale_order_id");`,
    );
    this.addSql(`
      alter table "sale_order_items"
        add constraint "sale_order_items_sale_order_id_fkey"
        foreign key ("sale_order_id") references "sale_orders" ("id") on update cascade on delete cascade;
    `);
    this.addSql(`
      alter table "sale_order_items"
        add constraint "sale_order_items_service_id_fkey"
        foreign key ("service_id") references "services" ("id") on update cascade;
    `);

    this.addSql(`
      create table "refund_policies" (
        "id" uuid not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "tenant_id" uuid not null,
        "description" varchar(500) not null,
        "refund_percentage" integer not null,
        "is_active" boolean not null default true,
        constraint "refund_policies_pkey" primary key ("id"),
        constraint "refund_policies_pct_check" check ("refund_percentage" >= 0 and "refund_percentage" <= 100)
      );
    `);
    this.addSql(
      `create index "refund_policies_tenant_id_index" on "refund_policies" ("tenant_id");`,
    );
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "refund_policies";`);
    this.addSql(`drop table if exists "sale_order_items";`);
    this.addSql(`drop index if exists "sale_orders_active_slot_unique";`);
    this.addSql(`drop table if exists "sale_orders";`);
    this.addSql(`drop type if exists "sale_order_state";`);
    this.addSql(`drop table if exists "staff_schedules";`);
    this.addSql(`drop table if exists "staff_qualifications";`);
    this.addSql(`alter table "service_dependencies" drop column if exists "auto_include";`);
  }
}
