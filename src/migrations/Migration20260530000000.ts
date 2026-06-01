/* eslint-disable @typescript-eslint/require-await */
import { Migration } from '@mikro-orm/migrations';

export class Migration20260530000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      alter table "users"
        add column "auth_method" varchar(16) not null default 'password';
    `);
    this.addSql(`
      alter table "users"
        add constraint "users_auth_method_check"
        check ("auth_method" in ('password', 'phone'));
    `);
    this.addSql(`alter table "users" alter column "password_hash" drop not null;`);
    this.addSql(`alter table "users" alter column "full_name" drop not null;`);
    this.addSql(`
      alter table "users"
        add constraint "users_password_required_for_password_auth"
        check ("auth_method" = 'phone' or "password_hash" is not null);
    `);
    this.addSql(`
      alter table "users"
        add constraint "users_full_name_required_for_password_auth"
        check ("auth_method" = 'phone' or "full_name" is not null);
    `);

    this.addSql(`
      create table "magic_link_attempts" (
        "id" uuid not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "tenant_id" uuid not null,
        "phone_e164" varchar(20) not null,
        "token" varchar(64) not null,
        "token_hash" varchar(128) not null,
        "expires_at" timestamptz not null,
        "consumed_at" timestamptz null,
        "user_id" uuid null,
        constraint "magic_link_attempts_pkey" primary key ("id")
      );
    `);
    this.addSql(`
      create index "magic_link_attempts_tenant_phone_idx"
        on "magic_link_attempts" ("tenant_id", "phone_e164");
    `);
    this.addSql(`
      create index "magic_link_attempts_token_hash_idx"
        on "magic_link_attempts" ("token_hash");
    `);

    this.addSql(`
      create table "magic_link_rate_limits" (
        "tenant_id" uuid not null,
        "phone_e164" varchar(20) not null,
        "window_started_at" timestamptz not null,
        "attempt_count" int not null,
        constraint "magic_link_rate_limits_pkey" primary key ("tenant_id", "phone_e164")
      );
    `);
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "magic_link_rate_limits";`);
    this.addSql(`drop table if exists "magic_link_attempts";`);
    this.addSql(`alter table "users" drop constraint if exists "users_full_name_required_for_password_auth";`);
    this.addSql(`alter table "users" drop constraint if exists "users_password_required_for_password_auth";`);
    this.addSql(`alter table "users" drop constraint if exists "users_auth_method_check";`);
    this.addSql(`alter table "users" drop column if exists "auth_method";`);
    this.addSql(`alter table "users" alter column "full_name" set not null;`);
    this.addSql(`alter table "users" alter column "password_hash" set not null;`);
  }
}
