/* eslint-disable @typescript-eslint/require-await */
import { Migration } from '@mikro-orm/migrations';

export class Migration20260505000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`create type "service_status" as enum ('draft', 'active', 'archived');`);

    this.addSql(`
      create table "services" (
        "id" uuid not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "tenant_id" uuid not null,
        "name" varchar(255) not null,
        "description" text null,
        "category_id" uuid null,
        "status" "service_status" not null default 'draft',
        "duration_minutes" integer not null,
        "base_price" numeric(12, 2) not null,
        constraint "services_pkey" primary key ("id"),
        constraint "services_duration_minutes_check" check ("duration_minutes" > 0),
        constraint "services_base_price_check" check ("base_price" >= 0)
      );
    `);
    this.addSql(`create index "services_tenant_id_index" on "services" ("tenant_id");`);
    this.addSql(`create index "services_category_id_index" on "services" ("category_id");`);
    this.addSql(`
      alter table "services"
        add constraint "services_category_id_fkey"
        foreign key ("category_id") references "categories" ("id") on update cascade on delete set null;
    `);

    this.addSql(`
      create table "service_consumptions" (
        "id" uuid not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "tenant_id" uuid not null,
        "service_id" uuid not null,
        "product_id" uuid not null,
        "quantity" numeric(12, 3) not null,
        constraint "service_consumptions_pkey" primary key ("id"),
        constraint "service_consumptions_quantity_check" check ("quantity" > 0)
      );
    `);
    this.addSql(
      `create index "service_consumptions_tenant_id_index" on "service_consumptions" ("tenant_id");`,
    );
    this.addSql(
      `create index "service_consumptions_service_id_index" on "service_consumptions" ("service_id");`,
    );
    this.addSql(
      `create index "service_consumptions_product_id_index" on "service_consumptions" ("product_id");`,
    );
    this.addSql(`
      alter table "service_consumptions"
        add constraint "service_consumptions_service_id_fkey"
        foreign key ("service_id") references "services" ("id") on update cascade on delete cascade;
    `);
    this.addSql(`
      alter table "service_consumptions"
        add constraint "service_consumptions_product_id_fkey"
        foreign key ("product_id") references "products" ("id") on update cascade on delete cascade;
    `);
    this.addSql(`
      alter table "service_consumptions"
        add constraint "service_consumptions_service_product_unique"
        unique ("service_id", "product_id");
    `);

    this.addSql(`
      create table "service_dependencies" (
        "id" uuid not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "tenant_id" uuid not null,
        "service_id" uuid not null,
        "depends_on_service_id" uuid not null,
        constraint "service_dependencies_pkey" primary key ("id"),
        constraint "service_dependencies_no_self_check" check ("service_id" <> "depends_on_service_id")
      );
    `);
    this.addSql(
      `create index "service_dependencies_tenant_id_index" on "service_dependencies" ("tenant_id");`,
    );
    this.addSql(
      `create index "service_dependencies_service_id_index" on "service_dependencies" ("service_id");`,
    );
    this.addSql(
      `create index "service_dependencies_depends_on_service_id_index" on "service_dependencies" ("depends_on_service_id");`,
    );
    this.addSql(`
      alter table "service_dependencies"
        add constraint "service_dependencies_service_id_fkey"
        foreign key ("service_id") references "services" ("id") on update cascade on delete cascade;
    `);
    this.addSql(`
      alter table "service_dependencies"
        add constraint "service_dependencies_depends_on_service_id_fkey"
        foreign key ("depends_on_service_id") references "services" ("id") on update cascade on delete cascade;
    `);
    this.addSql(`
      alter table "service_dependencies"
        add constraint "service_dependencies_pair_unique"
        unique ("service_id", "depends_on_service_id");
    `);
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "service_dependencies";`);
    this.addSql(`drop table if exists "service_consumptions";`);
    this.addSql(`alter table "services" drop constraint if exists "services_category_id_fkey";`);
    this.addSql(`drop table if exists "services";`);
    this.addSql(`drop type if exists "service_status";`);
  }
}
