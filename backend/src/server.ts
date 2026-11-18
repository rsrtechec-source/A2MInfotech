import "dotenv/config";
import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { z } from "zod";
import pool from "./db";
import { requireAuth, requireRole, signToken, type AuthUser } from "./auth";

const app = express();
const port = Number(process.env.PORT ?? 4000);
const emailSchema = z.string().email().max(255);
const registrationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: z.string().min(8).max(72),
});

app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? "*" }));
app.use(express.json({ limit: "1mb" }));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 }));

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (error) {
    console.error("Health check database failure:", error);
    res.status(503).json({ status: "unavailable", database: "disconnected" });
  }
});

app.post("/api/auth/register", async (req, res, next) => {
  const parsed = registrationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid registration details." });
    return;
  }
  try {
    const [existing] = await pool.execute("SELECT id FROM users WHERE email = ?", [parsed.data.email.toLowerCase()]);
    if ((existing as unknown[]).length) {
      res.status(409).json({ error: "An account with this email already exists." });
      return;
    }
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const [result] = await pool.execute(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'student')",
      [parsed.data.name, parsed.data.email.toLowerCase(), passwordHash],
    );
    const user: AuthUser = {
      id: Number((result as { insertId: number }).insertId),
      name: parsed.data.name,
      email: parsed.data.email.toLowerCase(),
      role: "student",
    };
    res.status(201).json({ token: signToken(user), user });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  const parsed = z.object({ email: emailSchema, password: z.string().min(1).max(72) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email and password." });
    return;
  }
  try {
    const [rows] = await pool.execute(
      "SELECT id, name, email, password_hash, role FROM users WHERE email = ? LIMIT 1",
      [parsed.data.email.toLowerCase()],
    );
    const userRow = (rows as Array<{ id: number; name: string; email: string; password_hash: string; role: AuthUser["role"] }>)[0];
    if (!userRow || !(await bcrypt.compare(parsed.data.password, userRow.password_hash))) {
      res.status(401).json({ error: "Email or password is incorrect." });
      return;
    }
    const user: AuthUser = { id: userRow.id, name: userRow.name, email: userRow.email, role: userRow.role };
    res.json({ token: signToken(user), user });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/courses", async (_req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.id, c.title, c.category, c.description, c.duration_weeks AS durationWeeks,
        u.name AS trainerName, COUNT(DISTINCT e.id) AS studentCount
       FROM courses c LEFT JOIN users u ON u.id = c.trainer_id
       LEFT JOIN enrollments e ON e.course_id = c.id
       WHERE c.published = TRUE GROUP BY c.id ORDER BY c.created_at DESC`,
    );
    res.json({ courses: rows });
  } catch (error) {
    next(error);
  }
});

app.post("/api/courses", requireAuth, requireRole("admin", "trainer"), async (req, res, next) => {
  const parsed = z.object({
    title: z.string().trim().min(3).max(180),
    category: z.string().trim().min(2).max(80),
    description: z.string().trim().min(10).max(5000),
    durationWeeks: z.number().int().min(1).max(104).default(8),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid course details." });
    return;
  }
  try {
    const [result] = await pool.execute(
      "INSERT INTO courses (title, category, description, duration_weeks, trainer_id) VALUES (?, ?, ?, ?, ?)",
      [parsed.data.title, parsed.data.category, parsed.data.description, parsed.data.durationWeeks, req.user!.id],
    );
    res.status(201).json({ id: (result as { insertId: number }).insertId, ...parsed.data });
  } catch (error) {
    next(error);
  }
});

app.post("/api/courses/:id/enroll", requireAuth, requireRole("student"), async (req, res, next) => {
  const courseId = Number(req.params.id);
  if (!Number.isSafeInteger(courseId) || courseId < 1) {
    res.status(400).json({ error: "Invalid course." });
    return;
  }
  try {
    await pool.execute("INSERT IGNORE INTO enrollments (user_id, course_id) VALUES (?, ?)", [req.user!.id, courseId]);
    const [rows] = await pool.execute("SELECT id FROM enrollments WHERE user_id = ? AND course_id = ?", [req.user!.id, courseId]);
    if (!(rows as unknown[]).length) {
      res.status(404).json({ error: "Course not found." });
      return;
    }
    res.status(201).json({ enrolled: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/learning", requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT c.id AS courseId, c.title, c.category, COUNT(DISTINCT l.id) AS totalLessons,
        COUNT(DISTINCT lp.lesson_id) AS completedLessons
       FROM enrollments e JOIN courses c ON c.id = e.course_id
       LEFT JOIN lessons l ON l.course_id = c.id
       LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = e.user_id
       WHERE e.user_id = ? GROUP BY c.id ORDER BY e.enrolled_at DESC`,
      [req.user!.id],
    );
    res.json({ courses: rows });
  } catch (error) {
    next(error);
  }
});

app.post("/api/learning/:lessonId/progress", requireAuth, requireRole("student"), async (req, res, next) => {
  const lessonId = Number(req.params.lessonId);
  if (!Number.isSafeInteger(lessonId) || lessonId < 1) {
    res.status(400).json({ error: "Invalid lesson." });
    return;
  }
  try {
    const [access] = await pool.execute(
      `SELECT l.id FROM lessons l JOIN enrollments e ON e.course_id = l.course_id
       WHERE l.id = ? AND e.user_id = ?`,
      [lessonId, req.user!.id],
    );
    if (!(access as unknown[]).length) {
      res.status(404).json({ error: "Lesson not found in your enrolled courses." });
      return;
    }
    await pool.execute("INSERT IGNORE INTO lesson_progress (user_id, lesson_id) VALUES (?, ?)", [req.user!.id, lessonId]);
    res.json({ completed: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/learning/:courseId/lessons", requireAuth, requireRole("student"), async (req, res, next) => {
  const courseId = Number(req.params.courseId);
  if (!Number.isSafeInteger(courseId) || courseId < 1) {
    res.status(400).json({ error: "Invalid course." });
    return;
  }
  try {
    const [lessons] = await pool.execute(
      `SELECT l.id, l.title, l.sort_order AS sortOrder, lp.completed_at AS completedAt
       FROM lessons l JOIN enrollments e ON e.course_id = l.course_id
       LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = e.user_id
       WHERE e.user_id = ? AND l.course_id = ? ORDER BY l.sort_order`,
      [req.user!.id, courseId],
    );
    res.json({ lessons });
  } catch (error) {
    next(error);
  }
});

app.get("/api/announcements", requireAuth, async (_req, res, next) => {
  try {
    const [announcements] = await pool.query("SELECT id, title, body, created_at AS createdAt FROM announcements ORDER BY created_at DESC LIMIT 20");
    res.json({ announcements });
  } catch (error) {
    next(error);
  }
});

app.get("/api/placements", requireAuth, async (_req, res, next) => {
  try {
    const [placements] = await pool.query(
      "SELECT id, company, role_title AS roleTitle, location, description, application_url AS applicationUrl, created_at AS createdAt FROM placements ORDER BY created_at DESC LIMIT 30",
    );
    res.json({ placements });
  } catch (error) {
    next(error);
  }
});

app.post("/api/placements", requireAuth, requireRole("admin", "trainer"), async (req, res, next) => {
  const parsed = z.object({
    company: z.string().trim().min(2).max(160),
    roleTitle: z.string().trim().min(2).max(180),
    location: z.string().trim().min(2).max(120),
    description: z.string().trim().min(10).max(5000),
    applicationUrl: z.string().url().max(500).optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid placement listing." });
    return;
  }
  try {
    const [result] = await pool.execute(
      `INSERT INTO placements (company, role_title, location, description, application_url)
       VALUES (?, ?, ?, ?, ?)`,
      [parsed.data.company, parsed.data.roleTitle, parsed.data.location, parsed.data.description, parsed.data.applicationUrl ?? null],
    );
    res.status(201).json({ id: (result as { insertId: number }).insertId, ...parsed.data });
  } catch (error) {
    next(error);
  }
});

app.post("/api/announcements", requireAuth, requireRole("admin"), async (req, res, next) => {
  const parsed = z.object({
    title: z.string().trim().min(3).max(180),
    body: z.string().trim().min(5).max(5000),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid announcement." });
    return;
  }
  try {
    const [result] = await pool.execute(
      "INSERT INTO announcements (title, body) VALUES (?, ?)",
      [parsed.data.title, parsed.data.body],
    );
    res.status(201).json({ id: (result as { insertId: number }).insertId, ...parsed.data });
  } catch (error) {
    next(error);
  }
});

app.get("/api/branches", requireAuth, requireRole("admin", "trainer"), async (_req, res, next) => {
  try {
    const [branches] = await pool.query("SELECT id, name, city, address FROM branches ORDER BY name");
    res.json({ branches });
  } catch (error) {
    next(error);
  }
});

app.post("/api/branches", requireAuth, requireRole("admin"), async (req, res, next) => {
  const parsed = z.object({
    name: z.string().trim().min(2).max(120),
    city: z.string().trim().min(2).max(120),
    address: z.string().trim().max(255).optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid branch." });
    return;
  }
  try {
    const [result] = await pool.execute(
      "INSERT INTO branches (name, city, address) VALUES (?, ?, ?)",
      [parsed.data.name, parsed.data.city, parsed.data.address ?? null],
    );
    res.status(201).json({ id: (result as { insertId: number }).insertId, ...parsed.data });
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
      res.status(409).json({ error: "A branch with this name already exists in that city." });
      return;
    }
    next(error);
  }
});

app.get("/api/batches", requireAuth, async (req, res, next) => {
  try {
    const roleFilter = req.user?.role === "student"
      ? "AND EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = b.course_id AND e.user_id = ?)"
      : req.user?.role === "trainer" ? "AND b.trainer_id = ?" : "";
    const parameters = req.user?.role === "admin" ? [] : [req.user!.id];
    const [batches] = await pool.execute(
      `SELECT b.id, b.name, b.course_id AS courseId, c.title AS courseTitle,
        b.trainer_id AS trainerId, u.name AS trainerName, b.branch_id AS branchId,
        br.name AS branchName, b.start_date AS startDate, b.end_date AS endDate,
        b.capacity, b.status, COUNT(DISTINCT be.student_id) AS studentCount
       FROM batches b JOIN courses c ON c.id = b.course_id
       LEFT JOIN users u ON u.id = b.trainer_id
       LEFT JOIN branches br ON br.id = b.branch_id
       LEFT JOIN batch_enrollments be ON be.batch_id = b.id
       WHERE 1 = 1 ${roleFilter}
       GROUP BY b.id ORDER BY b.start_date DESC`,
      parameters,
    );
    res.json({ batches });
  } catch (error) {
    next(error);
  }
});

app.post("/api/batches/:id/enroll", requireAuth, requireRole("student"), async (req, res, next) => {
  const batchId = Number(req.params.id);
  if (!Number.isSafeInteger(batchId) || batchId < 1) {
    res.status(400).json({ error: "Invalid batch." });
    return;
  }
  let connection: Awaited<ReturnType<typeof pool.getConnection>> | undefined;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT b.course_id AS courseId, b.capacity, b.status,
        (SELECT COUNT(*) FROM batch_enrollments be WHERE be.batch_id = b.id) AS studentCount
       FROM batches b WHERE b.id = ? FOR UPDATE`,
      [batchId],
    );
    const batch = (rows as Array<{ courseId: number; capacity: number; status: string; studentCount: number }>)[0];
    if (!batch || !["upcoming", "active"].includes(batch.status)) {
      await connection.rollback();
      res.status(404).json({ error: "Available batch not found." });
      return;
    }
    const [enrollment] = await connection.execute(
      "SELECT id FROM enrollments WHERE user_id = ? AND course_id = ? FOR UPDATE",
      [req.user!.id, batch.courseId],
    );
    if (!(enrollment as unknown[]).length) {
      await connection.rollback();
      res.status(403).json({ error: "Enroll in the course before joining its batch." });
      return;
    }
    const [otherBatch] = await connection.execute(
      `SELECT be.id FROM batch_enrollments be JOIN batches enrolled_batch ON enrolled_batch.id = be.batch_id
       WHERE be.student_id = ? AND enrolled_batch.course_id = ? AND be.batch_id != ?`,
      [req.user!.id, batch.courseId, batchId],
    );
    if ((otherBatch as unknown[]).length) {
      await connection.rollback();
      res.status(409).json({ error: "You are already enrolled in another batch for this course." });
      return;
    }
    const [existing] = await connection.execute(
      "SELECT id FROM batch_enrollments WHERE batch_id = ? AND student_id = ?",
      [batchId, req.user!.id],
    );
    if ((existing as unknown[]).length) {
      await connection.commit();
      res.json({ enrolled: true });
      return;
    }
    if (Number(batch.studentCount) >= Number(batch.capacity)) {
      await connection.rollback();
      res.status(409).json({ error: "This batch has reached its seat capacity." });
      return;
    }
    await connection.execute(
      "INSERT IGNORE INTO batch_enrollments (batch_id, student_id) VALUES (?, ?)",
      [batchId, req.user!.id],
    );
    await connection.commit();
    res.status(201).json({ enrolled: true });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

app.post("/api/batches", requireAuth, requireRole("admin", "trainer"), async (req, res, next) => {
  const parsed = z.object({
    courseId: z.number().int().positive(),
    name: z.string().trim().min(2).max(120),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    capacity: z.number().int().min(1).max(500).default(30),
    branchId: z.number().int().positive().nullable().optional(),
    trainerId: z.number().int().positive().nullable().optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid batch." });
    return;
  }
  try {
    const [courseRows] = req.user!.role === "trainer"
      ? await pool.execute("SELECT id FROM courses WHERE id = ? AND trainer_id = ?", [parsed.data.courseId, req.user!.id])
      : await pool.execute("SELECT id FROM courses WHERE id = ?", [parsed.data.courseId]);
    if (!(courseRows as unknown[]).length) {
      res.status(404).json({ error: "Course not found or not assigned to this trainer." });
      return;
    }
    if (req.user!.role === "admin" && parsed.data.trainerId) {
      const [trainerRows] = await pool.execute("SELECT id FROM users WHERE id = ? AND role = 'trainer'", [parsed.data.trainerId]);
      if (!(trainerRows as unknown[]).length) {
        res.status(400).json({ error: "Choose an existing trainer account." });
        return;
      }
    }
    const trainerId = req.user!.role === "trainer" ? req.user!.id : parsed.data.trainerId ?? null;
    if (parsed.data.branchId) {
      const [branchRows] = await pool.execute("SELECT id FROM branches WHERE id = ?", [parsed.data.branchId]);
      if (!(branchRows as unknown[]).length) {
        res.status(400).json({ error: "Choose an existing branch." });
        return;
      }
    }
    const [result] = await pool.execute(
      `INSERT INTO batches (course_id, trainer_id, branch_id, name, start_date, end_date, capacity)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [parsed.data.courseId, trainerId, parsed.data.branchId ?? null, parsed.data.name,
        parsed.data.startDate, parsed.data.endDate ?? null, parsed.data.capacity],
    );
    res.status(201).json({ id: (result as { insertId: number }).insertId, ...parsed.data, trainerId });
  } catch (error) {
    next(error);
  }
});

app.get("/api/attendance", requireAuth, async (req, res, next) => {
  try {
    const isStudent = req.user?.role === "student";
    const accessFilter = isStudent ? "a.student_id = ?" : req.user?.role === "trainer" ? "b.trainer_id = ?" : "1 = 1";
    const parameters = isStudent || req.user?.role === "trainer" ? [req.user!.id] : [];
    const [records] = await pool.execute(
      `SELECT a.id, a.batch_id AS batchId, b.name AS batchName, c.title AS courseTitle,
        a.student_id AS studentId, s.name AS studentName, a.attendance_date AS attendanceDate,
        a.status
       FROM attendance a JOIN batches b ON b.id = a.batch_id
       JOIN courses c ON c.id = b.course_id JOIN users s ON s.id = a.student_id
       WHERE ${accessFilter} ORDER BY a.attendance_date DESC LIMIT 200`,
      parameters,
    );
    res.json({ attendance: records });
  } catch (error) {
    next(error);
  }
});

app.post("/api/attendance", requireAuth, requireRole("admin", "trainer"), async (req, res, next) => {
  const parsed = z.object({
    batchId: z.number().int().positive(),
    studentId: z.number().int().positive(),
    attendanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(["present", "absent", "late"]),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid attendance record." });
    return;
  }
  try {
    const [access] = await pool.execute(
      `SELECT b.id FROM batches b JOIN batch_enrollments be ON be.batch_id = b.id
       WHERE b.id = ? AND be.student_id = ? AND (? = 'admin' OR b.trainer_id = ?)`,
      [parsed.data.batchId, parsed.data.studentId, req.user!.role, req.user!.id],
    );
    if (!(access as unknown[]).length) {
      res.status(404).json({ error: "Batch or enrolled student not found." });
      return;
    }
    await pool.execute(
      `INSERT INTO attendance (batch_id, student_id, attendance_date, status, marked_by)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), marked_by = VALUES(marked_by)`,
      [parsed.data.batchId, parsed.data.studentId, parsed.data.attendanceDate, parsed.data.status, req.user!.id],
    );
    res.status(201).json({ saved: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/invoices", requireAuth, requireRole("admin", "student"), async (req, res, next) => {
  try {
    const studentFilter = req.user?.role === "student" ? "WHERE i.student_id = ?" : "";
    const [invoices] = await pool.execute(
      `SELECT i.id, i.student_id AS studentId, u.name AS studentName,
        i.course_id AS courseId, c.title AS courseTitle, i.amount, i.amount_paid AS amountPaid,
        i.due_date AS dueDate, i.status, i.notes, i.created_at AS createdAt
       FROM invoices i JOIN users u ON u.id = i.student_id
       LEFT JOIN courses c ON c.id = i.course_id ${studentFilter}
       ORDER BY i.created_at DESC LIMIT 200`,
      req.user?.role === "student" ? [req.user.id] : [],
    );
    res.json({ invoices });
  } catch (error) {
    next(error);
  }
});

app.post("/api/invoices", requireAuth, requireRole("admin"), async (req, res, next) => {
  const parsed = z.object({
    studentId: z.number().int().positive(),
    courseId: z.number().int().positive().nullable().optional(),
    amount: z.number().positive().max(10000000),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    notes: z.string().trim().max(500).optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid invoice." });
    return;
  }
  try {
    const [studentRows] = await pool.execute("SELECT id FROM users WHERE id = ? AND role = 'student'", [parsed.data.studentId]);
    if (!(studentRows as unknown[]).length) {
      res.status(400).json({ error: "Choose an existing student account." });
      return;
    }
    const [result] = await pool.execute(
      "INSERT INTO invoices (student_id, course_id, amount, due_date, notes) VALUES (?, ?, ?, ?, ?)",
      [parsed.data.studentId, parsed.data.courseId ?? null, parsed.data.amount, parsed.data.dueDate ?? null, parsed.data.notes ?? null],
    );
    res.status(201).json({ id: (result as { insertId: number }).insertId, ...parsed.data, status: "pending", amountPaid: 0 });
  } catch (error) {
    next(error);
  }
});

app.post("/api/invoices/:id/payments", requireAuth, requireRole("admin"), async (req, res, next) => {
  const invoiceId = Number(req.params.id);
  const parsed = z.object({ amount: z.number().positive().max(10000000) }).safeParse(req.body);
  if (!Number.isSafeInteger(invoiceId) || invoiceId < 1 || !parsed.success) {
    res.status(400).json({ error: "Enter a valid invoice and payment amount." });
    return;
  }
  try {
    const [result] = await pool.execute(
      `UPDATE invoices
       SET amount_paid = amount_paid + ?,
         status = CASE WHEN amount_paid + ? >= amount THEN 'paid' ELSE 'partial' END
       WHERE id = ? AND amount_paid + ? <= amount`,
      [parsed.data.amount, parsed.data.amount, invoiceId, parsed.data.amount],
    );
    if ((result as { affectedRows: number }).affectedRows === 0) {
      const [invoices] = await pool.execute("SELECT id FROM invoices WHERE id = ?", [invoiceId]);
      if (!(invoices as unknown[]).length) {
        res.status(404).json({ error: "Invoice not found." });
        return;
      }
      res.status(400).json({ error: "Payment exceeds the outstanding invoice balance." });
      return;
    }
    const [rows] = await pool.execute("SELECT amount_paid AS amountPaid, status FROM invoices WHERE id = ?", [invoiceId]);
    res.json({ invoiceId, ...(rows as Array<{ amountPaid: number; status: string }>)[0] });
  } catch (error) {
    next(error);
  }
});

app.get("/api/expenses", requireAuth, requireRole("admin"), async (_req, res, next) => {
  try {
    const [expenses] = await pool.query(
      `SELECT e.id, e.category, e.description, e.amount, e.transaction_date AS transactionDate,
        e.branch_id AS branchId, b.name AS branchName, u.name AS createdBy
       FROM expenses e LEFT JOIN branches b ON b.id = e.branch_id
       JOIN users u ON u.id = e.created_by ORDER BY e.transaction_date DESC LIMIT 300`,
    );
    res.json({ expenses });
  } catch (error) {
    next(error);
  }
});

app.post("/api/expenses", requireAuth, requireRole("admin"), async (req, res, next) => {
  const parsed = z.object({
    category: z.string().trim().min(2).max(100),
    description: z.string().trim().min(3).max(500),
    amount: z.number().positive().max(10000000),
    transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    branchId: z.number().int().positive().nullable().optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid expense." });
    return;
  }
  try {
    if (parsed.data.branchId) {
      const [branches] = await pool.execute("SELECT id FROM branches WHERE id = ?", [parsed.data.branchId]);
      if (!(branches as unknown[]).length) {
        res.status(400).json({ error: "Choose an existing branch." });
        return;
      }
    }
    const [result] = await pool.execute(
      `INSERT INTO expenses (category, description, amount, transaction_date, branch_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [parsed.data.category, parsed.data.description, parsed.data.amount,
        parsed.data.transactionDate, parsed.data.branchId ?? null, req.user!.id],
    );
    res.status(201).json({ id: (result as { insertId: number }).insertId, ...parsed.data });
  } catch (error) {
    next(error);
  }
});

app.get("/api/staff/leave-requests", requireAuth, requireRole("admin", "trainer"), async (req, res, next) => {
  try {
    const filter = req.user?.role === "trainer" ? "WHERE r.user_id = ?" : "";
    const [requests] = await pool.execute(
      `SELECT r.id, r.user_id AS userId, u.name AS userName, r.start_date AS startDate,
        r.end_date AS endDate, r.reason, r.status, a.name AS approvedBy
       FROM staff_leave_requests r JOIN users u ON u.id = r.user_id
       LEFT JOIN users a ON a.id = r.approved_by ${filter}
       ORDER BY r.created_at DESC LIMIT 200`,
      req.user?.role === "trainer" ? [req.user.id] : [],
    );
    res.json({ requests });
  } catch (error) {
    next(error);
  }
});

app.post("/api/staff/leave-requests", requireAuth, requireRole("admin", "trainer"), async (req, res, next) => {
  const parsed = z.object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().trim().min(3).max(1000),
  }).safeParse(req.body);
  if (!parsed.success || (parsed.success && parsed.data.endDate < parsed.data.startDate)) {
    res.status(400).json({ error: "Enter valid leave dates and a reason; the end date must not precede the start date." });
    return;
  }
  try {
    const [result] = await pool.execute(
      "INSERT INTO staff_leave_requests (user_id, start_date, end_date, reason) VALUES (?, ?, ?, ?)",
      [req.user!.id, parsed.data.startDate, parsed.data.endDate, parsed.data.reason],
    );
    res.status(201).json({ id: (result as { insertId: number }).insertId, ...parsed.data, status: "pending" });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/staff/leave-requests/:id", requireAuth, requireRole("admin"), async (req, res, next) => {
  const requestId = Number(req.params.id);
  const parsed = z.object({ status: z.enum(["approved", "declined"]) }).safeParse(req.body);
  if (!Number.isSafeInteger(requestId) || requestId < 1 || !parsed.success) {
    res.status(400).json({ error: "Enter a valid leave request and decision." });
    return;
  }
  try {
    const [result] = await pool.execute(
      "UPDATE staff_leave_requests SET status = ?, approved_by = ? WHERE id = ? AND status = 'pending'",
      [parsed.data.status, req.user!.id, requestId],
    );
    if ((result as { affectedRows: number }).affectedRows === 0) {
      res.status(404).json({ error: "Pending leave request not found." });
      return;
    }
    res.json({ id: requestId, status: parsed.data.status });
  } catch (error) {
    next(error);
  }
});

app.get("/api/leads", requireAuth, requireRole("admin", "trainer"), async (_req, res, next) => {
  try {
    const [leads] = await pool.query(
      `SELECT l.id, l.name, l.email, l.phone, l.source, l.interest, l.status, l.notes,
        l.assigned_to AS assignedTo, u.name AS assigneeName, l.created_at AS createdAt
       FROM leads l LEFT JOIN users u ON u.id = l.assigned_to ORDER BY l.created_at DESC LIMIT 200`,
    );
    res.json({ leads });
  } catch (error) {
    next(error);
  }
});

app.post("/api/leads", requireAuth, requireRole("admin", "trainer"), async (req, res, next) => {
  const parsed = z.object({
    name: z.string().trim().min(2).max(120),
    email: emailSchema.optional(),
    phone: z.string().trim().max(40).optional(),
    source: z.string().trim().min(2).max(80).default("Website"),
    interest: z.string().trim().max(180).optional(),
    notes: z.string().trim().max(5000).optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid lead." });
    return;
  }
  try {
    const [result] = await pool.execute(
      "INSERT INTO leads (name, email, phone, source, interest, notes, assigned_to) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [parsed.data.name, parsed.data.email?.toLowerCase() ?? null, parsed.data.phone ?? null,
        parsed.data.source, parsed.data.interest ?? null, parsed.data.notes ?? null, req.user!.id],
    );
    res.status(201).json({ id: (result as { insertId: number }).insertId, ...parsed.data, status: "new" });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/leads/:id", requireAuth, requireRole("admin", "trainer"), async (req, res, next) => {
  const leadId = Number(req.params.id);
  const parsed = z.object({ status: z.enum(["new", "contacted", "qualified", "enrolled", "lost"]) }).safeParse(req.body);
  if (!Number.isSafeInteger(leadId) || leadId < 1 || !parsed.success) {
    res.status(400).json({ error: "Enter a valid lead status." });
    return;
  }
  try {
    const [result] = await pool.execute("UPDATE leads SET status = ? WHERE id = ?", [parsed.data.status, leadId]);
    if ((result as { affectedRows: number }).affectedRows === 0) {
      res.status(404).json({ error: "Lead not found." });
      return;
    }
    res.json({ id: leadId, status: parsed.data.status });
  } catch (error) {
    next(error);
  }
});

app.get("/api/assessments", requireAuth, async (req, res, next) => {
  try {
    const visibility = req.user?.role === "student"
      ? `AND EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = a.course_id AND e.user_id = ?)
         AND (a.batch_id IS NULL OR EXISTS (SELECT 1 FROM batch_enrollments be WHERE be.batch_id = a.batch_id AND be.student_id = ?))`
      : req.user?.role === "trainer" ? "AND c.trainer_id = ?" : "";
    const visibilityParameters = req.user?.role === "admin"
      ? []
      : req.user?.role === "student" ? [req.user.id, req.user.id] : [req.user!.id];
    const [assessments] = await pool.execute(
      `SELECT a.id, a.course_id AS courseId, c.title AS courseTitle, a.batch_id AS batchId,
        a.title, a.assessment_type AS type, a.due_date AS dueDate, a.max_score AS maxScore
       FROM assessments a JOIN courses c ON c.id = a.course_id
       WHERE 1 = 1 ${visibility} ORDER BY a.due_date`,
      visibilityParameters,
    );
    res.json({ assessments });
  } catch (error) {
    next(error);
  }
});

app.post("/api/assessments", requireAuth, requireRole("admin", "trainer"), async (req, res, next) => {
  const parsed = z.object({
    courseId: z.number().int().positive(),
    batchId: z.number().int().positive().nullable().optional(),
    title: z.string().trim().min(3).max(180),
    type: z.enum(["quiz", "assignment", "project"]).default("assignment"),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    maxScore: z.number().positive().max(100000).default(100),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid assessment." });
    return;
  }
  try {
    if (req.user!.role === "trainer") {
      const [owned] = await pool.execute("SELECT id FROM courses WHERE id = ? AND trainer_id = ?", [parsed.data.courseId, req.user!.id]);
      if (!(owned as unknown[]).length) {
        res.status(403).json({ error: "Trainers can create assessments only for their own courses." });
        return;
      }
    }
    const [result] = await pool.execute(
      `INSERT INTO assessments (course_id, batch_id, title, assessment_type, due_date, max_score, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [parsed.data.courseId, parsed.data.batchId ?? null, parsed.data.title, parsed.data.type,
        parsed.data.dueDate ?? null, parsed.data.maxScore, req.user!.id],
    );
    res.status(201).json({ id: (result as { insertId: number }).insertId, ...parsed.data });
  } catch (error) {
    next(error);
  }
});

app.post("/api/assessments/:id/submissions", requireAuth, requireRole("student"), async (req, res, next) => {
  const assessmentId = Number(req.params.id);
  const parsed = z.object({ submissionText: z.string().trim().min(1).max(20000) }).safeParse(req.body);
  if (!Number.isSafeInteger(assessmentId) || assessmentId < 1 || !parsed.success) {
    res.status(400).json({ error: "Enter a valid assessment submission." });
    return;
  }
  try {
    const [access] = await pool.execute(
      `SELECT a.id FROM assessments a JOIN enrollments e ON e.course_id = a.course_id
       WHERE a.id = ? AND e.user_id = ?
       AND (a.batch_id IS NULL OR EXISTS (
         SELECT 1 FROM batch_enrollments be WHERE be.batch_id = a.batch_id AND be.student_id = e.user_id
       ))`,
      [assessmentId, req.user!.id],
    );
    if (!(access as unknown[]).length) {
      res.status(404).json({ error: "Assessment not found in your enrolled courses." });
      return;
    }
    await pool.execute(
      `INSERT INTO assessment_submissions (assessment_id, student_id, submission_text)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE submission_text = VALUES(submission_text), submitted_at = CURRENT_TIMESTAMP`,
      [assessmentId, req.user!.id, parsed.data.submissionText],
    );
    res.status(201).json({ submitted: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/assessments/:id/submissions", requireAuth, requireRole("admin", "trainer"), async (req, res, next) => {
  const assessmentId = Number(req.params.id);
  if (!Number.isSafeInteger(assessmentId) || assessmentId < 1) {
    res.status(400).json({ error: "Invalid assessment." });
    return;
  }
  try {
    const [access] = await pool.execute(
      `SELECT a.id FROM assessments a JOIN courses c ON c.id = a.course_id
       WHERE a.id = ? AND (? = 'admin' OR c.trainer_id = ?)`,
      [assessmentId, req.user!.role, req.user!.id],
    );
    if (!(access as unknown[]).length) {
      res.status(404).json({ error: "Assessment not found or not assigned to this trainer." });
      return;
    }
    const [submissions] = await pool.execute(
      `SELECT s.id, s.student_id AS studentId, u.name AS studentName,
        s.submission_text AS submissionText, s.score, s.submitted_at AS submittedAt
       FROM assessment_submissions s JOIN users u ON u.id = s.student_id
       WHERE s.assessment_id = ? ORDER BY s.submitted_at DESC`,
      [assessmentId],
    );
    res.json({ submissions });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/assessment-submissions/:id/grade", requireAuth, requireRole("admin", "trainer"), async (req, res, next) => {
  const submissionId = Number(req.params.id);
  const parsed = z.object({ score: z.number().min(0).max(100000) }).safeParse(req.body);
  if (!Number.isSafeInteger(submissionId) || submissionId < 1 || !parsed.success) {
    res.status(400).json({ error: "Enter a valid submission and score." });
    return;
  }
  try {
    const [rows] = await pool.execute(
      `SELECT a.max_score AS maxScore, c.trainer_id AS trainerId
       FROM assessment_submissions s JOIN assessments a ON a.id = s.assessment_id
       JOIN courses c ON c.id = a.course_id WHERE s.id = ?`,
      [submissionId],
    );
    const submission = (rows as Array<{ maxScore: number; trainerId: number | null }>)[0];
    if (!submission || (req.user!.role === "trainer" && submission.trainerId !== req.user!.id)) {
      res.status(404).json({ error: "Submission not found or not assigned to this trainer." });
      return;
    }
    if (parsed.data.score > Number(submission.maxScore)) {
      res.status(400).json({ error: "Score cannot exceed the assessment maximum." });
      return;
    }
    await pool.execute("UPDATE assessment_submissions SET score = ? WHERE id = ?", [parsed.data.score, submissionId]);
    res.json({ id: submissionId, score: parsed.data.score });
  } catch (error) {
    next(error);
  }
});

app.get("/api/certificates", requireAuth, requireRole("admin", "student"), async (req, res, next) => {
  try {
    const filter = req.user?.role === "student" ? "WHERE cert.student_id = ?" : "";
    const [certificates] = await pool.execute(
      `SELECT cert.id, cert.student_id AS studentId, u.name AS studentName,
        cert.course_id AS courseId, c.title AS courseTitle, cert.certificate_code AS certificateCode,
        cert.issued_at AS issuedAt
       FROM certificates cert JOIN users u ON u.id = cert.student_id
       JOIN courses c ON c.id = cert.course_id ${filter} ORDER BY cert.issued_at DESC`,
      req.user?.role === "student" ? [req.user.id] : [],
    );
    res.json({ certificates });
  } catch (error) {
    next(error);
  }
});

app.post("/api/certificates/:courseId", requireAuth, requireRole("student"), async (req, res, next) => {
  const courseId = Number(req.params.courseId);
  if (!Number.isSafeInteger(courseId) || courseId < 1) {
    res.status(400).json({ error: "Invalid course." });
    return;
  }
  try {
    const [completion] = await pool.execute(
      `SELECT COUNT(DISTINCT l.id) AS total, COUNT(DISTINCT lp.lesson_id) AS completed
       FROM enrollments e JOIN lessons l ON l.course_id = e.course_id
       LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = e.user_id
       WHERE e.user_id = ? AND e.course_id = ?`,
      [req.user!.id, courseId],
    );
    const progress = (completion as Array<{ total: number; completed: number }>)[0];
    if (!progress || Number(progress.total) === 0 || Number(progress.total) !== Number(progress.completed)) {
      res.status(400).json({ error: "Complete every lesson in the course before requesting a certificate." });
      return;
    }
    const certificateCode = `A2M-${randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
    await pool.execute(
      "INSERT IGNORE INTO certificates (student_id, course_id, certificate_code) VALUES (?, ?, ?)",
      [req.user!.id, courseId, certificateCode],
    );
    const [certificates] = await pool.execute(
      "SELECT id, certificate_code AS certificateCode, issued_at AS issuedAt FROM certificates WHERE student_id = ? AND course_id = ?",
      [req.user!.id, courseId],
    );
    res.status(201).json({ certificate: (certificates as unknown[])[0] });
  } catch (error) {
    next(error);
  }
});

app.get("/api/internships", requireAuth, async (_req, res, next) => {
  try {
    const [internships] = await pool.query(
      `SELECT id, company, role_title AS roleTitle, location, description,
        application_url AS applicationUrl, status, created_at AS createdAt
       FROM internships WHERE status = 'open' ORDER BY created_at DESC LIMIT 100`,
    );
    res.json({ internships });
  } catch (error) {
    next(error);
  }
});

app.post("/api/internships", requireAuth, requireRole("admin", "trainer"), async (req, res, next) => {
  const parsed = z.object({
    company: z.string().trim().min(2).max(160),
    roleTitle: z.string().trim().min(2).max(180),
    location: z.string().trim().min(2).max(120),
    description: z.string().trim().min(10).max(5000),
    applicationUrl: z.string().url().max(500).optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid internship listing." });
    return;
  }
  try {
    const [result] = await pool.execute(
      `INSERT INTO internships (company, role_title, location, description, application_url, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [parsed.data.company, parsed.data.roleTitle, parsed.data.location, parsed.data.description,
        parsed.data.applicationUrl ?? null, req.user!.id],
    );
    res.status(201).json({ id: (result as { insertId: number }).insertId, ...parsed.data, status: "open" });
  } catch (error) {
    next(error);
  }
});

app.get("/api/dashboard", requireAuth, async (req, res, next) => {
  try {
    if (req.user?.role === "student") {
      const [[summary]] = await pool.execute(
        `SELECT COUNT(DISTINCT e.course_id) AS enrolledCourses,
          COUNT(DISTINCT lp.lesson_id) AS completedLessons,
          (SELECT COUNT(*) FROM invoices i WHERE i.student_id = ? AND i.status != 'paid') AS pendingInvoices,
          (SELECT COUNT(*) FROM certificates cert WHERE cert.student_id = ?) AS certificates
         FROM enrollments e LEFT JOIN lessons l ON l.course_id = e.course_id
         LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = e.user_id
         WHERE e.user_id = ?`,
        [req.user.id, req.user.id, req.user.id],
      ) as [Array<{ enrolledCourses: number; completedLessons: number; pendingInvoices: number; certificates: number }>, unknown];
      res.json({ role: "student", summary });
      return;
    }
    if (req.user?.role === "trainer") {
      const [[summary]] = await pool.execute(
        `SELECT COUNT(DISTINCT e.user_id) AS students,
          COUNT(DISTINCT c.id) AS courses,
          (SELECT COUNT(*) FROM batches b WHERE b.trainer_id = ?) AS batches,
          (SELECT COUNT(*) FROM assessment_submissions s
           JOIN assessments a ON a.id = s.assessment_id
           JOIN courses owned ON owned.id = a.course_id
           WHERE owned.trainer_id = ? AND s.score IS NULL) AS submissionsToReview
         FROM courses c LEFT JOIN enrollments e ON e.course_id = c.id
         WHERE c.trainer_id = ?`,
        [req.user.id, req.user.id, req.user.id],
      ) as [Array<{ students: number; courses: number; batches: number; submissionsToReview: number }>, unknown];
      res.json({ role: "trainer", summary });
      return;
    }
    const [[summary]] = await pool.query(
      `SELECT (SELECT COUNT(*) FROM users WHERE role = 'student') AS students,
        (SELECT COUNT(*) FROM users WHERE role = 'trainer') AS trainers,
        (SELECT COUNT(*) FROM courses WHERE published = TRUE) AS courses,
        (SELECT COUNT(*) FROM enrollments) AS enrollments,
        (SELECT COUNT(*) FROM branches) AS branches,
        (SELECT COUNT(*) FROM batches) AS batches,
        (SELECT COUNT(*) FROM leads WHERE status IN ('new', 'contacted', 'qualified')) AS activeLeads,
        (SELECT COUNT(*) FROM invoices WHERE status != 'paid') AS pendingInvoices,
        (SELECT COUNT(*) FROM assessment_submissions WHERE score IS NULL) AS submissionsToReview`,
    ) as [Array<Record<string, number>>, unknown];
    res.json({ role: req.user?.role, summary });
  } catch (error) {
    next(error);
  }
});

app.get("/api/users", requireAuth, requireRole("admin"), async (_req, res, next) => {
  try {
    const [users] = await pool.query("SELECT id, name, email, role, created_at AS createdAt FROM users ORDER BY created_at DESC LIMIT 200");
    res.json({ users });
  } catch (error) {
    next(error);
  }
});

app.get("/api/users/students", requireAuth, requireRole("admin", "trainer"), async (_req, res, next) => {
  try {
    const [students] = await pool.query(
      "SELECT id, name, email, role FROM users WHERE role = 'student' ORDER BY name LIMIT 500",
    );
    res.json({ users: students });
  } catch (error) {
    next(error);
  }
});

app.post("/api/users/trainers", requireAuth, requireRole("admin"), async (req, res, next) => {
  const parsed = registrationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid trainer details." });
    return;
  }
  try {
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const [result] = await pool.execute(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'trainer')",
      [parsed.data.name, parsed.data.email.toLowerCase(), passwordHash],
    );
    res.status(201).json({ id: (result as { insertId: number }).insertId, name: parsed.data.name, email: parsed.data.email.toLowerCase(), role: "trainer" });
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
      res.status(409).json({ error: "An account with this email already exists." });
      return;
    }
    next(error);
  }
});

app.post("/api/chat", requireAuth, async (req, res) => {
  const parsed = z.object({ message: z.string().trim().min(1).max(1000) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a message up to 1000 characters." });
    return;
  }
  const text = parsed.data.message.toLowerCase();
  const reply = text.includes("course") || text.includes("train")
    ? "Explore the Courses tab to see our web, mobile, AI, data analytics, cloud, and DevOps programs. Sign in as a student to enroll."
    : text.includes("placement") || text.includes("job")
      ? "Open the Opportunities section in your dashboard to review current placement listings."
      : text.includes("progress") || text.includes("lesson")
        ? "Your enrolled programs and lesson progress are available in the Learning tab."
        : "Welcome to A2M Infotech! I can help with courses, learning progress, and placement opportunities. For personal support, please contact the A2M team.";
  res.json({ reply });
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("API request failed:", error);
  if (error instanceof jwt.JsonWebTokenError) {
    res.status(401).json({ error: "Your session is invalid. Please sign in again." });
    return;
  }
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

app.listen(port, () => {
  console.log(`A2M Infotech API listening on port ${port}`);
});
