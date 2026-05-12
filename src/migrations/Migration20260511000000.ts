/* eslint-disable @typescript-eslint/require-await */
import { Migration } from '@mikro-orm/migrations';

export class Migration20260511000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      alter table "sale_orders"
        add column "checked_in_at" timestamptz null,
        add column "started_at" timestamptz null,
        add column "completed_service_at" timestamptz null,
        add column "no_show_at" timestamptz null;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`
      alter table "sale_orders"
        drop column "checked_in_at",
        drop column "started_at",
        drop column "completed_service_at",
        drop column "no_show_at";
    `);
  }
}
