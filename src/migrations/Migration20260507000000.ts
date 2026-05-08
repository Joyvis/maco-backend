/* eslint-disable @typescript-eslint/require-await */
import { Migration } from '@mikro-orm/migrations';

export class Migration20260507000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`alter table "tenants" add column "slug" varchar(255) null;`);
    this.addSql(`alter table "tenants" add column "logo_url" varchar(1024) null;`);
    this.addSql(`alter table "tenants" add column "city" varchar(255) null;`);
    this.addSql(`alter table "tenants" add column "rating" numeric(3, 2) null;`);
    this.addSql(`
      create unique index "tenants_slug_unique" on "tenants" ("slug")
        where "slug" is not null;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`drop index if exists "tenants_slug_unique";`);
    this.addSql(`alter table "tenants" drop column if exists "rating";`);
    this.addSql(`alter table "tenants" drop column if exists "city";`);
    this.addSql(`alter table "tenants" drop column if exists "logo_url";`);
    this.addSql(`alter table "tenants" drop column if exists "slug";`);
  }
}
