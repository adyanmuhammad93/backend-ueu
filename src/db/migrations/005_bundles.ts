import type { Knex } from 'knex';

/**
 * Migration 005: Bundles
 * Converts Supabase migration 013
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('bundles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.string('title').notNullable();
    t.text('description').notNullable();
    t.uuid('instructor_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.decimal('price', 15, 2).notNullable().defaultTo(0);
    t.string('thumbnail_url');
    t.boolean('is_published').notNullable().defaultTo(false);
    t.timestamps(true, true);
    t.index(['instructor_id']);
  });

  await knex.schema.createTable('bundle_courses', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('bundle_id').notNullable().references('id').inTable('bundles').onDelete('CASCADE');
    t.uuid('course_id').notNullable().references('id').inTable('courses').onDelete('CASCADE');
    t.unique(['bundle_id', 'course_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('bundle_courses');
  await knex.schema.dropTableIfExists('bundles');
}
