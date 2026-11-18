const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { readFile } = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { test } = require("node:test");
const { Pool } = require("pg");

test("PostgreSQL schema and API workflows", { timeout: 60000 }, async () => {
  assert.ok(process.env.TEST_DATABASE_URL, "Set TEST_DATABASE_URL to a disposable PostgreSQL database.");
  const schema = `a2m_test_${randomBytes(8).toString("hex")}`;
  const control = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let schemaCreated = false;
  let db;
  let server;
  let serverOutput = "";
  try {
    await control.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    db = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      options: `-c search_path=${schema}`,
    });
    const schemaSql = await readFile(path.join(__dirname, "../sql/schema.sql"), "utf8");
    await db.query(schemaSql);
    await db.query(schemaSql);
    const { rows: seed } = await db.query("SELECT COUNT(*)::int AS count FROM lessons");
    assert.equal(seed[0].count, 12);

    const socket = net.createServer();
    await new Promise((resolve, reject) => socket.once("error", reject).listen(0, "127.0.0.1", resolve));
    const port = socket.address().port;
    await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
    server = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
      cwd: path.join(__dirname, ".."),
      env: {
        ...process.env,
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        DATABASE_SSL: "false",
        PGOPTIONS: `-c search_path=${schema}`,
        JWT_SECRET: "integration-test-secret-at-least-32-characters",
        PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout.on("data", (chunk) => { serverOutput += chunk; });
    server.stderr.on("data", (chunk) => { serverOutput += chunk; });
    const base = `http://127.0.0.1:${port}/api`;
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null) break;
      try {
        const response = await fetch(`${base}/health`);
        if (response.ok) { ready = true; break; }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.ok(ready, `API failed to start: ${serverOutput}`);

    async function request(method, endpoint, body, token, expected = 200) {
      const response = await fetch(`${base}${endpoint}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = await response.json();
      assert.equal(response.status, expected, `${method} ${endpoint}: ${JSON.stringify(result)}\n${serverOutput}`);
      return result;
    }

    const credentials = { name: "Test Student", email: "student@example.test", password: "student-password" };
    const student = await request("POST", "/auth/register", credentials, null, 201);
    assert.equal(typeof student.user.id, "number");
    await request("POST", "/auth/register", credentials, null, 409);
    const login = await request("POST", "/auth/login", credentials);
    assert.equal(login.user.id, student.user.id);
    await request("POST", "/auth/login", { ...credentials, password: "incorrect" }, null, 401);

    const adminCredentials = { name: "Test Admin", email: "admin@example.test", password: "admin-password" };
    await request("POST", "/auth/register", adminCredentials, null, 201);
    await db.query("UPDATE users SET role = 'admin' WHERE email = $1", [adminCredentials.email]);
    const admin = await request("POST", "/auth/login", adminCredentials);
    const trainerCredentials = { name: "Test Trainer", email: "trainer@example.test", password: "trainer-password" };
    const trainerCreated = await request("POST", "/users/trainers", trainerCredentials, admin.token, 201);
    assert.equal(typeof trainerCreated.id, "number");
    const trainer = await request("POST", "/auth/login", trainerCredentials);

    const course = await request("POST", "/courses", {
      title: "Integration Course", category: "Testing", description: "Testing PostgreSQL queries.",
    }, trainer.token, 201);
    assert.equal(typeof course.id, "number");
    const courses = await request("GET", "/courses");
    const listedCourse = courses.courses.find((item) => item.id === course.id);
    assert.equal(listedCourse.trainerName, trainerCredentials.name);
    assert.equal(listedCourse.durationWeeks, 8);
    assert.equal(typeof listedCourse.studentCount, "number");

    await request("POST", `/courses/${course.id}/enroll`, {}, student.token, 201);
    await request("POST", `/courses/${course.id}/enroll`, {}, student.token, 201);
    await request("POST", "/courses/999999999/enroll", {}, student.token, 404);
    const learning = await request("GET", "/learning", undefined, student.token);
    assert.equal(learning.courses[0].courseId, course.id);
    const seededCourse = courses.courses.find((item) => item.title === "Full-Stack Web Development");
    await request("POST", `/courses/${seededCourse.id}/enroll`, {}, student.token, 201);
    const lessons = await request("GET", `/learning/${seededCourse.id}/lessons`, undefined, student.token);
    assert.equal(lessons.lessons.length, 3);
    for (const lesson of lessons.lessons) {
      await request("POST", `/learning/${lesson.id}/progress`, {}, student.token);
    }
    await request("POST", `/learning/${lessons.lessons[0].id}/progress`, {}, student.token);
    const certificate = await request("POST", `/certificates/${seededCourse.id}`, {}, student.token, 201);
    assert.equal(typeof certificate.certificate.certificateCode, "string");
    const repeatedCertificate = await request("POST", `/certificates/${seededCourse.id}`, {}, student.token, 201);
    assert.equal(repeatedCertificate.certificate.id, certificate.certificate.id);
    assert.equal((await request("GET", "/certificates", undefined, student.token)).certificates.length, 1);
    const branch = await request("POST", "/branches", { name: "Test Branch", city: "Test City" }, admin.token, 201);
    await request("POST", "/branches", { name: "Test Branch", city: "Test City" }, admin.token, 409);
    const batch = await request("POST", "/batches", {
      courseId: course.id, name: "Test Batch", startDate: "2026-01-01", capacity: 1, branchId: branch.id,
    }, trainer.token, 201);
    await request("POST", `/batches/${batch.id}/enroll`, {}, student.token, 201);
    await request("POST", `/batches/${batch.id}/enroll`, {}, student.token);
    for (const token of [student.token, trainer.token, admin.token]) {
      const batches = await request("GET", "/batches", undefined, token);
      assert.equal(batches.batches[0].studentCount, 1);
      assert.equal(batches.batches[0].courseId, course.id);
    }
    const limitedCourse = await request("POST", "/courses", {
      title: "Limited Course", category: "Testing", description: "Testing concurrent enrollments.",
    }, trainer.token, 201);
    const limitedBatch = await request("POST", "/batches", {
      courseId: limitedCourse.id, name: "One seat", startDate: "2026-01-01", capacity: 1,
    }, trainer.token, 201);
    const first = await request("POST", "/auth/register", {
      name: "First Student", email: "first@example.test", password: "student-password",
    }, null, 201);
    const second = await request("POST", "/auth/register", {
      name: "Second Student", email: "second@example.test", password: "student-password",
    }, null, 201);
    for (const token of [first.token, second.token]) {
      await request("POST", `/courses/${limitedCourse.id}/enroll`, {}, token, 201);
    }
    const concurrent = await Promise.all([first.token, second.token].map((token) =>
      fetch(`${base}/batches/${limitedBatch.id}/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      }),
    ));
    assert.deepEqual(concurrent.map((response) => response.status).sort(), [201, 409]);
    const { rows: batchCount } = await db.query(
      "SELECT COUNT(*)::int AS count FROM batch_enrollments WHERE batch_id = $1", [limitedBatch.id],
    );
    assert.equal(batchCount[0].count, 1);
    const attendance = { batchId: batch.id, studentId: student.user.id, attendanceDate: "2026-01-02", status: "present" };
    await request("POST", "/attendance", attendance, trainer.token, 201);
    await request("POST", "/attendance", { ...attendance, status: "late" }, trainer.token, 201);
    assert.equal((await request("GET", "/attendance", undefined, student.token)).attendance[0].status, "late");

    const assessment = await request("POST", "/assessments", {
      courseId: course.id, batchId: batch.id, title: "Test assessment", maxScore: 100,
    }, trainer.token, 201);
    const assessments = await request("GET", "/assessments", undefined, student.token);
    assert.equal(assessments.assessments[0].maxScore, "100.00");
    await request("POST", `/assessments/${assessment.id}/submissions`, { submissionText: "First" }, student.token, 201);
    await request("POST", `/assessments/${assessment.id}/submissions`, { submissionText: "Updated" }, student.token, 201);
    const submissions = await request("GET", `/assessments/${assessment.id}/submissions`, undefined, trainer.token);
    assert.equal(submissions.submissions[0].submissionText, "Updated");
    await request("PATCH", `/assessment-submissions/${submissions.submissions[0].id}/grade`, { score: 90 }, trainer.token);

    const invoice = await request("POST", "/invoices", { studentId: student.user.id, amount: 100 }, admin.token, 201);
    const payment = await request("POST", `/invoices/${invoice.id}/payments`, { amount: 40 }, admin.token);
    assert.equal(payment.status, "partial");
    assert.equal(payment.amountPaid, "40.00");
    await request("POST", `/invoices/${invoice.id}/payments`, { amount: 61 }, admin.token, 400);
    assert.equal((await request("GET", "/invoices", undefined, student.token)).invoices[0].studentId, student.user.id);
    const lead = await request("POST", "/leads", { name: "Test Lead" }, trainer.token, 201);
    await request("PATCH", `/leads/${lead.id}`, { status: "contacted" }, trainer.token);
    assert.equal((await request("GET", "/leads", undefined, trainer.token)).leads[0].status, "contacted");
    const leave = await request("POST", "/staff/leave-requests", {
      startDate: "2026-01-01", endDate: "2026-01-02", reason: "Test leave",
    }, trainer.token, 201);
    await request("PATCH", `/staff/leave-requests/${leave.id}`, { status: "approved" }, admin.token);
    assert.equal((await request("GET", "/staff/leave-requests", undefined, trainer.token)).requests[0].status, "approved");
    await request("POST", "/expenses", {
      category: "Rent", description: "Test expense", amount: 25, transactionDate: "2026-01-01", branchId: branch.id,
    }, admin.token, 201);
    assert.equal((await request("GET", "/expenses", undefined, admin.token)).expenses[0].branchId, branch.id);
    await request("POST", "/announcements", { title: "Test news", body: "Testing announcement" }, admin.token, 201);
    assert.equal((await request("GET", "/announcements", undefined, student.token)).announcements.length, 1);
    await request("POST", "/placements", {
      company: "Example", roleTitle: "Developer", location: "Remote", description: "A test placement listing.",
    }, trainer.token, 201);
    assert.equal((await request("GET", "/placements", undefined, student.token)).placements.length, 1);
    await request("POST", "/internships", {
      company: "Example", roleTitle: "Intern", location: "Remote", description: "A test internship listing.",
    }, trainer.token, 201);
    assert.equal((await request("GET", "/internships", undefined, student.token)).internships.length, 1);
    assert.equal((await request("GET", "/branches", undefined, trainer.token)).branches.length, 1);
    assert.equal((await request("GET", "/users", undefined, admin.token)).users.length, 5);
    assert.equal((await request("GET", "/users/students", undefined, trainer.token)).users.length, 3);
    for (const token of [student.token, trainer.token, admin.token]) {
      const dashboard = await request("GET", "/dashboard", undefined, token);
      assert.ok(Object.values(dashboard.summary).every((value) => typeof value === "number"));
    }
  } finally {
    if (server && server.exitCode === null) {
      server.kill();
      await new Promise((resolve) => server.once("exit", resolve));
    }
    if (db) await db.end();
    if (schemaCreated) await control.query(`DROP SCHEMA "${schema}" CASCADE`);
    await control.end();
  }
});
