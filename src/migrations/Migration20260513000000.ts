/* eslint-disable @typescript-eslint/require-await */
import { Migration } from '@mikro-orm/migrations';

export class Migration20260513000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      alter table "sale_order_items"
        add column "name_snapshot" text null;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`
      alter table "sale_order_items"
        drop column if exists "name_snapshot";
    `);
  }
}
