import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('categories', (t) => {
    t.enu('status', ['active', 'inactive']).notNullable().defaultTo('active');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('categories', (t) => {
    t.dropColumn('status');
  });
}
