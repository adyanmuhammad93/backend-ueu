import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('categories', (t) => {
    t.uuid('parent_id')
      .nullable()
      .references('id')
      .inTable('categories')
      .onDelete('CASCADE'); // If parent is deleted, delete all children
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('categories', (t) => {
    t.dropColumn('parent_id');
  });
}
