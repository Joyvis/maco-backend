/* eslint-disable @typescript-eslint/require-await */
import { Migration } from '@mikro-orm/migrations';

export class Migration20260427000000 extends Migration {
  async up(): Promise<void> {
    // Drop the old enum-based user_roles table and its FK
    this.addSql(`alter table "user_roles" drop constraint if exists "user_roles_user_id_fkey";`);
    this.addSql(`drop table if exists "user_roles";`);
    this.addSql(`drop type if exists "user_role_type";`);

    // Create tenants table
    this.addSql(`
      create type "account_type" as enum ('platform', 'wlc', 'standard');
    `);
    this.addSql(`
      create type "tenant_status" as enum ('active', 'trial', 'suspended', 'pending_payment');
    `);
    this.addSql(`
      create type "subscription_type" as enum ('free_trial', 'paid');
    `);

    this.addSql(`
      create table "tenants" (
        "id" uuid not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "name" varchar(255) not null,
        "account_type" "account_type" not null,
        "parent_tenant_id" uuid null,
        "status" "tenant_status" not null,
        "plan_id" uuid not null,
        "subscription_type" "subscription_type" not null,
        "trial_ends_at" timestamptz null,
        constraint "tenants_pkey" primary key ("id")
      );
    `);

    // Unique name among top-level tenants (parent_tenant_id IS NULL)
    this.addSql(`
      create unique index "tenants_name_no_parent_unique"
        on "tenants" ("name")
        where "parent_tenant_id" is null;
    `);

    // Unique name per parent tenant
    this.addSql(`
      create unique index "tenants_name_parent_unique"
        on "tenants" ("name", "parent_tenant_id")
        where "parent_tenant_id" is not null;
    `);

    // Create roles table (tenant-scoped)
    this.addSql(`
      create table "roles" (
        "id" uuid not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "tenant_id" uuid not null,
        "name" varchar(100) not null,
        "is_system" boolean not null default false,
        constraint "roles_pkey" primary key ("id")
      );
    `);

    this.addSql(`
      create index "roles_tenant_id_index" on "roles" ("tenant_id");
    `);

    // Create tenant_configs table (tenant-scoped)
    this.addSql(`
      create table "tenant_configs" (
        "id" uuid not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "tenant_id" uuid not null,
        "key" varchar(255) not null,
        "value" text null,
        constraint "tenant_configs_pkey" primary key ("id")
      );
    `);

    this.addSql(`
      create index "tenant_configs_tenant_id_index" on "tenant_configs" ("tenant_id");
    `);

    // Re-create user_roles with FK to roles table
    this.addSql(`
      create table "user_roles" (
        "user_id" uuid not null,
        "role_id" uuid not null,
        constraint "user_roles_pkey" primary key ("user_id", "role_id")
      );
    `);

    this.addSql(`
      alter table "user_roles"
        add constraint "user_roles_user_id_fkey"
        foreign key ("user_id") references "users" ("id") on update cascade;
    `);

    this.addSql(`
      alter table "user_roles"
        add constraint "user_roles_role_id_fkey"
        foreign key ("role_id") references "roles" ("id") on update cascade;
    `);
  }

  async down(): Promise<void> {
    // Reverse order: drop new user_roles first (FK references)
    this.addSql(`alter table "user_roles" drop constraint if exists "user_roles_role_id_fkey";`);
    this.addSql(`alter table "user_roles" drop constraint if exists "user_roles_user_id_fkey";`);
    this.addSql(`drop table if exists "user_roles";`);

    this.addSql(`drop table if exists "tenant_configs";`);
    this.addSql(`drop table if exists "roles";`);

    this.addSql(`drop index if exists "tenants_name_no_parent_unique";`);
    this.addSql(`drop index if exists "tenants_name_parent_unique";`);
    this.addSql(`drop table if exists "tenants";`);

    this.addSql(`drop type if exists "subscription_type";`);
    this.addSql(`drop type if exists "tenant_status";`);
    this.addSql(`drop type if exists "account_type";`);

    // Restore old enum-based user_roles
    this.addSql(`
      create type "user_role_type" as enum (
        'platform_admin', 'tenant_admin', 'staff', 'receptionist', 'customer'
      );
    `);

    this.addSql(`
      create table "user_roles" (
        "user_id" uuid not null,
        "role" "user_role_type" not null,
        constraint "user_roles_pkey" primary key ("user_id", "role")
      );
    `);

    this.addSql(`
      alter table "user_roles"
        add constraint "user_roles_user_id_fkey"
        foreign key ("user_id") references "users" ("id") on update cascade;
    `);
  }
}
