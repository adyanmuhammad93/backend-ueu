import { db } from '../../db/knex.js';
import { NotFoundError, ForbiddenError } from '../../shared/errors.js';
import { paginate, buildPaginatedResult } from '../../shared/pagination.js';

// --- Mapper helpers ---
function mapCourse(d: any) {
  return {
    id: d.id,
    title: d.title,
    subtitle: d.subtitle,
    instructor: d.instructor_name,
    instructorId: d.instructor_id,
    description: d.description,
    price: Number(d.price),
    rating: Number(d.rating),
    ratingCount: Number(d.rating_count),
    thumbnailUrl: d.thumbnail_url,
    category: d.category,
    level: d.level,
    language: d.language,
    learningObjectives: d.learning_objectives || [],
    requirements: d.requirements || [],
    lastUpdated: new Date(d.updated_at).toLocaleDateString(),
    isPublished: d.is_published,
    approvalStatus: d.approval_status,
    accessType: d.access_type || 'paid',
    accessConfig: d.access_config || {},
    certificateConfig: d.certificate_config || { enabled: true, minScore: 0 },
    syllabus: d.modules ? d.modules : [],
    lessonCount: d.lesson_count || 0,
  };
}

function mapModule(d: any) {
  return {
    id: d.id,
    title: d.title,
    orderIndex: d.order_index,
    prerequisites: d.prerequisites || [],
    lessons: d.lessons ? d.lessons.sort((a: any, b: any) => a.order_index - b.order_index) : [],
  };
}

function mapLesson(d: any) {
  return {
    id: d.id,
    title: d.title,
    duration: d.duration || '0:00',
    type: d.type,
    content: d.content,
    videoUrl: d.video_url,
    isPublished: d.is_published,
    orderIndex: d.order_index,
    prerequisites: d.prerequisites || [],
  };
}

export const coursesService = {
  async getAllCourses() {
    const courses = await db('courses')
      .select([
        'courses.*',
        db.raw(`(
          SELECT COUNT(l.id) FROM lessons l
          JOIN modules m ON l.module_id = m.id
          WHERE m.course_id = courses.id
        ) as lesson_count`),
      ])
      .orderBy('created_at', 'desc');

    return courses.map((c: any) => ({ ...mapCourse(c), syllabus: [] }));
  },

  async getPaginatedCourses(page: number, limit: number, search = '') {
    const { offset, limit: safeLimit } = paginate(page, limit);

    let baseQuery = db('courses').leftJoin('users', 'courses.instructor_id', 'users.id');

    if (search) {
      baseQuery = baseQuery.whereILike('courses.title', `%${search}%`);
    }

    const [{ count }] = await baseQuery.clone().count('courses.id as count');
    const data = await baseQuery
      .select('courses.*', 'users.email as instructor_email')
      .orderBy('courses.created_at', 'desc')
      .limit(safeLimit).offset(offset);

    return buildPaginatedResult(data.map(mapCourse), Number(count), page, safeLimit);
  },

  async getCourseById(id: string, publishedOnly = false, user?: any) {
    let courseQuery = db('courses').where('courses.id', id).first();
    const course = await courseQuery;
    if (!course) throw new NotFoundError('Course');

    if (publishedOnly && (!course.is_published || course.approval_status !== 'approved')) {
      throw new NotFoundError('Course');
    }

    const modules = await db('modules')
      .where({ course_id: id })
      .orderBy('order_index', 'asc');

    let lessons = await db('lessons')
      .whereIn('module_id', modules.map((m: any) => m.id))
      .modify((qb) => {
        if (publishedOnly) qb.where({ is_published: true });
      })
      .orderBy('order_index', 'asc');

    let canViewContent = false;
    if (user) {
      if (user.role === 'admin' || user.id === course.instructor_id) {
        canViewContent = true;
      } else {
        const enrollment = await db('enrollments').where({ course_id: id, user_id: user.id, status: 'active' }).first();
        if (enrollment) canViewContent = true;
      }
    }

    const modulesWithLessons = modules.map((m: any) => ({
      ...mapModule(m),
      lessons: lessons.filter((l: any) => l.module_id === m.id).map((l: any) => {
        const mapped = mapLesson(l);
        if (!canViewContent) {
           mapped.content = null;
           mapped.videoUrl = null;
        }
        return mapped;
      }),
    }));

    return mapCourse({ ...course, modules: modulesWithLessons });
  },

  async createCourse(data: any, instructorId: string, instructorName: string) {
    const [course] = await db('courses').insert({
      title: data.title,
      subtitle: data.subtitle,
      description: data.description || '',
      price: data.price || 0,
      category: data.category || 'General',
      thumbnail_url: data.thumbnailUrl,
      instructor_id: instructorId,
      instructor_name: instructorName,
      level: data.level || 'Beginner',
      learning_objectives: data.learningObjectives || [],
      requirements: data.requirements || [],
      is_published: false,
      approval_status: 'draft',
      access_type: 'paid',
    }).returning('*');
    return mapCourse(course);
  },

  async updateCourse(id: string, data: any, requesterId: string, requesterRole: string) {
    const course = await db('courses').where({ id }).first();
    if (!course) throw new NotFoundError('Course');

    // Authorization: only owner instructor or admin can update
    if (requesterRole !== 'admin' && course.instructor_id !== requesterId) {
      throw new ForbiddenError('You do not own this course');
    }

    const payload: Record<string, any> = { updated_at: new Date() };
    const fields = ['title', 'subtitle', 'description', 'price', 'category', 'level', 'language'];
    for (const f of fields) {
      if (data[f] !== undefined) payload[f] = data[f];
    }
    if (data.thumbnailUrl) payload.thumbnail_url = data.thumbnailUrl;
    if (data.learningObjectives) payload.learning_objectives = data.learningObjectives;
    if (data.requirements) payload.requirements = data.requirements;
    if (data.accessType) payload.access_type = data.accessType;
    if (data.accessConfig) payload.access_config = JSON.stringify(data.accessConfig);
    if (data.certificateConfig) payload.certificate_config = JSON.stringify(data.certificateConfig);

    if (data.isPublished === true) {
      const setting = await db('settings').where({ key: 'course_moderation' }).first();
      const moderationEnabled = setting?.value?.enabled ?? false;
      payload.is_published = moderationEnabled ? false : true;
      payload.approval_status = moderationEnabled ? 'pending' : 'approved';
    } else if (data.isPublished === false) {
      payload.is_published = false;
      payload.approval_status = 'draft';
    }

    await db('courses').where({ id }).update(payload);
  },

  async approveCourse(id: string) {
    await db('courses').where({ id }).update({ is_published: true, approval_status: 'approved' });
  },

  async rejectCourse(id: string) {
    await db('courses').where({ id }).update({ is_published: false, approval_status: 'rejected' });
  },

  async deleteCourse(id: string) {
    await db('courses').where({ id }).delete();
  },

  // --- Modules ---
  async createModule(courseId: string, title: string, orderIndex: number) {
    const [m] = await db('modules').insert({ course_id: courseId, title, order_index: orderIndex }).returning('*');
    return mapModule(m);
  },

  async updateModule(moduleId: string, updates: any) {
    const payload: Record<string, any> = {};
    if (updates.title) payload.title = updates.title;
    if (updates.prerequisites) payload.prerequisites = updates.prerequisites;
    await db('modules').where({ id: moduleId }).update(payload);
  },

  async deleteModule(moduleId: string) {
    await db('modules').where({ id: moduleId }).delete();
  },

  async reorderModules(updates: { id: string; orderIndex: number }[]) {
    await db.transaction(async (trx) => {
      for (const u of updates) {
        await trx('modules').where({ id: u.id }).update({ order_index: u.orderIndex });
      }
    });
  },

  // --- Lessons ---
  async createLesson(moduleId: string, title: string, orderIndex: number, type = 'video') {
    const [l] = await db('lessons').insert({ module_id: moduleId, title, order_index: orderIndex, type, is_published: false }).returning('*');
    return mapLesson(l);
  },

  async updateLesson(lessonId: string, updates: any) {
    const payload: Record<string, any> = {};
    if (updates.title) payload.title = updates.title;
    if (updates.content !== undefined) payload.content = updates.content;
    if (updates.videoUrl !== undefined) payload.video_url = updates.videoUrl;
    if (updates.duration) payload.duration = updates.duration;
    if (updates.isPublished !== undefined) payload.is_published = updates.isPublished;
    if (updates.prerequisites) payload.prerequisites = updates.prerequisites;
    await db('lessons').where({ id: lessonId }).update(payload);
  },

  async updateLessonStatusBatch(lessonIds: string[], isPublished: boolean) {
    await db('lessons').whereIn('id', lessonIds).update({ is_published: isPublished });
  },

  async reorderLessons(updates: { id: string; orderIndex: number; moduleId: string }[]) {
    await db.transaction(async (trx) => {
      for (const u of updates) {
        await trx('lessons').where({ id: u.id }).update({ order_index: u.orderIndex, module_id: u.moduleId });
      }
    });
  },

  async deleteLesson(lessonId: string) {
    await db('lessons').where({ id: lessonId }).delete();
  },

  // --- Progress ---
  async markLessonComplete(userId: string, lessonId: string, courseId: string) {
    await db('lesson_progress')
      .insert({ user_id: userId, lesson_id: lessonId, course_id: courseId })
      .onConflict(['user_id', 'lesson_id'])
      .ignore();
  },

  async getStudentProgress(userId: string, courseId: string): Promise<string[]> {
    const rows = await db('lesson_progress').where({ user_id: userId, course_id: courseId }).select('lesson_id');
    return rows.map((r: any) => r.lesson_id);
  },

  // --- Instructor Stats ---
  async getInstructorStats(instructorId: string) {
    const courses = await db('courses')
      .where({ instructor_id: instructorId })
      .select('id', 'title', 'price', 'is_published', 'category', 'created_at', 'rating', 'rating_count');

    const courseIds = courses.map((c: any) => c.id);
    const enrollments = courseIds.length > 0
      ? await db('enrollments').whereIn('course_id', courseIds).where({ status: 'active' }).select('course_id')
      : [];

    return courses.map((c: any) => {
      const studentCount = enrollments.filter((e: any) => e.course_id === c.id).length;
      return { ...c, students: studentCount, revenue: studentCount * Number(c.price) };
    });
  },

  // --- Certificates ---
  async issueCertificate(userId: string, courseId: string) {
    const verificationCode = Array.from(crypto.getRandomValues(new Uint8Array(4)))
      .map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

    const course = await db('courses').where({ id: courseId }).select('certificate_config').first();
    let expiresAt = null;
    if (course?.certificate_config?.validityDays) {
      const d = new Date();
      d.setDate(d.getDate() + course.certificate_config.validityDays);
      expiresAt = d.toISOString();
    }

    const [cert] = await db('certificates')
      .insert({ user_id: userId, course_id: courseId, verification_code: verificationCode, expires_at: expiresAt })
      .onConflict(['user_id', 'course_id'])
      .ignore()
      .returning('*');

    if (!cert) {
      return db('certificates').where({ user_id: userId, course_id: courseId }).first();
    }
    return cert;
  },

  async getCertificate(userId: string, courseId: string) {
    return db('certificates').where({ user_id: userId, course_id: courseId }).first();
  },

  async verifyCertificate(code: string) {
    return db('certificates as c')
      .join('courses', 'c.course_id', 'courses.id')
      .join('users', 'c.user_id', 'users.id')
      .where('c.verification_code', code.toUpperCase())
      .select('c.*', 'courses.title as course_title', 'courses.thumbnail_url as course_thumbnail', 'courses.instructor_name', 'courses.certificate_config', 'users.full_name as student_name')
      .first();
  },

  async getUserCertificates(userId: string) {
    return db('certificates as c')
      .join('courses', 'c.course_id', 'courses.id')
      .where('c.user_id', userId)
      .orderBy('c.issued_at', 'desc')
      .select('c.*', 'courses.title as course_title', 'courses.thumbnail_url as course_thumbnail', 'courses.instructor_name', 'courses.certificate_config');
  },
};
