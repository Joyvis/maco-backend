/* eslint-disable @typescript-eslint/require-await */
import { Migration } from '@mikro-orm/migrations';

export class Migration20260510000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `create type "payment_state" as enum ('pending', 'succeeded', 'failed', 'expired', 'cancelled');`,
    );
    this.addSql(`create type "payment_provider_name" as enum ('mock', 'stone');`);

    this.addSql(`
      create table "payments" (
        "id" uuid not null,
        "tenant_id" uuid not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "sale_order_id" uuid not null,
        "customer_id" uuid not null,
        "amount" numeric(12, 2) not null,
        "currency" varchar(8) not null default 'BRL',
        "state" "payment_state" not null default 'pending',
        "provider" "payment_provider_name" not null,
        "provider_session_id" varchar(128) null,
        "provider_metadata" jsonb not null default '{}'::jsonb,
        "error_message" text null,
        "expires_at" timestamptz not null,
        constraint "payments_pkey" primary key ("id")
      );
    `);

    this.addSql(
      `alter table "payments" add constraint "payments_sale_order_id_unique" unique ("sale_order_id");`,
    );
    this.addSql(`
      alter table "payments"
        add constraint "payments_sale_order_id_fkey"
        foreign key ("sale_order_id") references "sale_orders" ("id")
        on update cascade on delete cascade;
    `);
    this.addSql(`
      alter table "payments"
        add constraint "payments_customer_id_fkey"
        foreign key ("customer_id") references "users" ("id")
        on update cascade;
    `);

    this.addSql(
      `create index "payments_tenant_state_expires_idx" on "payments" ("tenant_id", "state", "expires_at");`,
    );
    this.addSql(
      `create index "payments_provider_session_id_idx" on "payments" ("provider_session_id");`,
    );
  }

  async down(): Promise<void> {
    this.addSql(`drop index if exists "payments_provider_session_id_idx";`);
    this.addSql(`drop index if exists "payments_tenant_state_expires_idx";`);
    this.addSql(`drop table if exists "payments" cascade;`);
    this.addSql(`drop type if exists "payment_provider_name";`);
    this.addSql(`drop type if exists "payment_state";`);
  }
}
