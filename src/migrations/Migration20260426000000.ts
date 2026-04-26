/* eslint-disable @typescript-eslint/require-await */
import { Migration } from '@mikro-orm/migrations';

export class Migration20260426000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create type "user_state" as enum ('active', 'inactive', 'suspended');
    `);

    this.addSql(`
      create type "user_role_type" as enum (
        'platform_admin', 'tenant_admin', 'staff', 'receptionist', 'customer'
      );
    `);

    this.addSql(`
      create table "users" (
        "id" uuid not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "tenant_id" uuid not null,
        "email" varchar(255) not null,
        "password_hash" varchar(255) not null,
        "full_name" varchar(255) not null,
        "phone" varchar(50) null,
        "state" "user_state" not null default 'active',
        constraint "users_pkey" primary key ("id"),
        constraint "users_tenant_id_email_unique" unique ("tenant_id", "email")
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

    this.addSql(`
      create table "refresh_tokens" (
        "id" uuid not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "user_id" uuid not null,
        "token_hash" varchar(255) not null,
        "expires_at" timestamptz not null,
        "revoked_at" timestamptz null,
        constraint "refresh_tokens_pkey" primary key ("id")
      );
    `);

    this.addSql(`
      create index "refresh_tokens_user_id_index" on "refresh_tokens" ("user_id");
    `);

    this.addSql(`
      create index "refresh_tokens_token_hash_index" on "refresh_tokens" ("token_hash");
    `);

    this.addSql(`
      alter table "refresh_tokens"
        add constraint "refresh_tokens_user_id_fkey"
        foreign key ("user_id") references "users" ("id") on update cascade;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`alter table "user_roles" drop constraint if exists "user_roles_user_id_fkey";`);
    this.addSql(
      `alter table "refresh_tokens" drop constraint if exists "refresh_tokens_user_id_fkey";`,
    );

    this.addSql(`drop table if exists "user_roles";`);
    this.addSql(`drop table if exists "refresh_tokens";`);
    this.addSql(`drop table if exists "users";`);

    this.addSql(`drop type if exists "user_role_type";`);
    this.addSql(`drop type if exists "user_state";`);
  }
}
