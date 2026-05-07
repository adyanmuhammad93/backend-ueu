import type { Knex } from 'knex';

/**
 * Migration 006: Live Classes
 * Converts Supabase migration 014
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('live_classes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('course_id').notNullable().references('id').inTable('courses').onDelete('CASCADE');
    t.string('title').notNullable();
    t.text('description');
    t.timestamp('start_time').notNullable();
    t.timestamp('end_time').notNullable();
    t.enu('platform', ['google_meet', 'zoom', 'other']).notNullable().defaultTo('other');
    t.string('meeting_url').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['course_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('live_classes');
}
