import type { Knex } from 'knex';

/**
 * Migration 009: Resources, Assignments, and Question Bank
 * Converts Supabase migrations 025, 027, 028
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('resources', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('lesson_id').notNullable().references('id').inTable('lessons').onDelete('CASCADE');
    t.string('title').notNullable();
    t.string('file_url').notNullable();
    t.string('file_type');
    t.integer('file_size');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['lesson_id']);
  });

  await knex.schema.createTable('submissions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('lesson_id').notNullable().references('id').inTable('lessons').onDelete('CASCADE');
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('file_url');
    t.text('content');
    t.integer('grade').checkBetween([0, 100]);
    t.text('feedback');
    t.timestamp('submitted_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    t.unique(['lesson_id', 'user_id']);
    t.index(['lesson_id']);
    t.index(['user_id']);
  });

  await knex.schema.createTable('question_bank', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('course_id').references('id').inTable('courses').onDelete('CASCADE');
    t.uuid('created_by').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('question').notNullable();
    t.enu('type', ['single', 'multiple', 'text']).notNullable().defaultTo('single');
    t.jsonb('options').defaultTo('[]');
    t.jsonb('tags').defaultTo('[]');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['course_id']);
    t.index(['created_by']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('question_bank');
  await knex.schema.dropTableIfExists('submissions');
  await knex.schema.dropTableIfExists('resources');
}
