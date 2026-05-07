import type { Knex } from 'knex';

/**
 * Migration 003: Progress Tracking & Certificates
 * Converts Supabase migrations 006 + 007 + 008 + 031 + 032
 */
export async function up(knex: Knex): Promise<void> {
  // LESSON PROGRESS TABLE
  await knex.schema.createTable('lesson_progress', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('lesson_id').notNullable().references('id').inTable('lessons').onDelete('CASCADE');
    t.uuid('course_id').notNullable().references('id').inTable('courses').onDelete('CASCADE');
    t.timestamp('completed_at').notNullable().defaultTo(knex.fn.now());

    t.unique(['user_id', 'lesson_id']);
    t.index(['user_id', 'course_id']);
  });

  // CERTIFICATES TABLE
  await knex.schema.createTable('certificates', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('course_id').notNullable().references('id').inTable('courses').onDelete('CASCADE');
    t.string('verification_code').notNullable().unique();
    t.timestamp('issued_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('expires_at');
    t.boolean('revoked').notNullable().defaultTo(false);
    t.string('revoked_reason');

    t.unique(['user_id', 'course_id']);
    t.index(['verification_code']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('certificates');
  await knex.schema.dropTableIfExists('lesson_progress');
}
