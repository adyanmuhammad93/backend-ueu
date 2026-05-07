import 'dotenv/config';
import type { Knex } from 'knex';
import argon2 from 'argon2';
import { v4 as uuidv4 } from 'uuid';

/**
 * User Seeder
 * Seeds: 1 admin, 3 instructors, 20 students
 *
 * All users share the password defined below for easy dev/testing.
 * Change credentials before any staging/production use.
 *
 * Run with: pnpm seed:run
 */

const DEFAULT_PASSWORD = 'asdzxc123';

async function hash(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
}

const now = new Date();

export async function seed(knex: Knex): Promise<void> {
  // Wipe existing users & refresh tokens (cascade)
  await knex('refresh_tokens').del();
  await knex('users').del();

  const passwordHash = await hash(DEFAULT_PASSWORD);

  // ─── Admin ────────────────────────────────────────────────────────────────
  const admin = {
    id: uuidv4(),
    email: 'admin@nextskill.id',
    password_hash: passwordHash,
    full_name: 'Super Admin',
    role: 'admin',
    created_at: now,
    updated_at: now,
  };

  // ─── Instructors ──────────────────────────────────────────────────────────
  const instructors = [
    { id: uuidv4(), email: 'budi.instructor@nextskill.id',  full_name: 'Budi Santoso' },
    { id: uuidv4(), email: 'sari.instructor@nextskill.id',  full_name: 'Sari Dewi' },
    { id: uuidv4(), email: 'rizky.instructor@nextskill.id', full_name: 'Rizky Pratama' },
  ].map(u => ({
    ...u,
    password_hash: passwordHash,
    role: 'instructor',
    created_at: now,
    updated_at: now,
  }));

  // ─── Students ─────────────────────────────────────────────────────────────
  const studentData = [
    { name: 'Ahmad Fauzi' },
    { name: 'Dewi Rahayu' },
    { name: 'Eko Prasetyo' },
    { name: 'Fajar Nugroho' },
    { name: 'Gita Puspita' },
    { name: 'Hadi Wijaya' },
    { name: 'Indra Kusuma' },
    { name: 'Joko Supriyanto' },
    { name: 'Kartika Sari' },
    { name: 'Lia Fitriani' },
    { name: 'Maya Putri' },
    { name: 'Nina Lestari' },
    { name: 'Oki Firmansyah' },
    { name: 'Putri Handayani' },
    { name: 'Rina Agustina' },
    { name: 'Sandi Kurniawan' },
    { name: 'Toni Hermawan' },
    { name: 'Umar Hakim' },
    { name: 'Vina Oktaviani' },
    { name: 'Wahyu Setiawan' },
  ];

  const students = studentData.map(({ name }) => {
    const slug = name.toLowerCase().replace(/\s+/g, '.').replace(/[^a-z.]/g, '');
    return {
      id: uuidv4(),
      email: `${slug}@student.nextskill.id`,
      password_hash: passwordHash,
      full_name: name,
      role: 'student',
      created_at: now,
      updated_at: now,
    };
  });

  // ─── Insert all ───────────────────────────────────────────────────────────
  await knex('users').insert([admin, ...instructors, ...students]);

  console.log(`✅ Seeded ${1 + instructors.length + students.length} users`);
  console.log(`\n📋 Login credentials (all users):`);
  console.log(`   Password: ${DEFAULT_PASSWORD}\n`);
  console.log(`   Admin:       ${admin.email}`);
  instructors.forEach(i => console.log(`   Instructor:  ${i.email}`));
  console.log(`   Students:    ${students[0].email} ... ${students[students.length - 1].email}`);
}
