/* eslint-disable @typescript-eslint/require-await */
import { Migration } from '@mikro-orm/migrations';

export class Migration20260428000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create type "tenant_status_new" as enum ('active', 'trial', 'suspended', 'cancelled', 'pending_payment');
    `);
    this.addSql(`
      alter table "tenants"
        alter column "status" type "tenant_status_new"
        using "status"::text::"tenant_status_new";
    `);
    this.addSql(`drop type "tenant_status";`);
    this.addSql(`alter type "tenant_status_new" rename to "tenant_status";`);

    this.addSql(`alter table "users" add column "last_login_at" timestamptz null;`);
  }

  async down(): Promise<void> {
    this.addSql(`alter table "users" drop column "last_login_at";`);

    this.addSql(`
      create type "tenant_status_new" as enum ('active', 'trial', 'suspended', 'pending_payment');
    `);
    this.addSql(`
      alter table "tenants"
        alter column "status" type "tenant_status_new"
        using "status"::text::"tenant_status_new";
    `);
    this.addSql(`drop type "tenant_status";`);
    this.addSql(`alter type "tenant_status_new" rename to "tenant_status";`);
  }
}
