import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api } from "./src/api";

type Role = "student" | "trainer" | "admin";
type User = { id: number; name: string; email: string; role: Role };
type Course = {
  id: number;
  title: string;
  category: string;
  description: string;
  durationWeeks: number;
  trainerName?: string | null;
  studentCount: number;
};
type Lesson = { id: number; title: string; sortOrder: number; completedAt: string | null };
type Tab = "Home" | "Courses" | "Learning" | "Assistant" | "Account" | "Center" | "Opportunities";
type CenterModule = "branches" | "batches" | "attendance" | "invoices" | "expenses" | "leads" | "assessments" | "internships" | "placements" | "hr" | "team" | "announcements";
type Branch = { id: number; name: string; city: string; address?: string | null };
type Batch = { id: number; name: string; courseId: number; courseTitle: string; trainerName?: string | null; branchName?: string | null; startDate: string; status: string; studentCount: number; capacity: number };
type AttendanceRecord = { id: number; batchName: string; courseTitle: string; studentName: string; attendanceDate: string; status: string };
type Invoice = { id: number; studentName?: string; courseTitle?: string | null; amount: number; amountPaid: number; dueDate?: string | null; status: string };
type Lead = { id: number; name: string; email?: string | null; interest?: string | null; status: string; source: string };
type Assessment = { id: number; courseId: number; courseTitle: string; title: string; type: string; dueDate?: string | null; maxScore: number };
type AssessmentSubmission = { id: number; studentId: number; studentName: string; submissionText: string; score: number | null };
type Certificate = { id: number; courseTitle: string; certificateCode: string; issuedAt: string };
type Internship = { id: number; company: string; roleTitle: string; location: string; description: string; applicationUrl?: string | null };
type Placement = { id: number; company: string; roleTitle: string; location: string; description: string; applicationUrl?: string | null };
type Expense = { id: number; category: string; description: string; amount: number; transactionDate: string; branchName?: string | null };
type LeaveRequest = { id: number; userName: string; startDate: string; endDate: string; reason: string; status: string };

const colors = {
  ink: "#15233b",
  muted: "#718096",
  blue: "#315ee8",
  pale: "#eff3ff",
  background: "#f4f7fb",
  line: "#e5eaf2",
  white: "#ffffff",
  green: "#18845b",
  purple: "#7b42df",
  orange: "#e88833",
};

const centerModules: Array<{ key: CenterModule; title: string; description: string; icon: string; color: string; roles: Role[] }> = [
  { key: "branches", title: "Branches", description: "Multi-location operations", icon: "⌖", color: "#635bda", roles: ["admin"] },
  { key: "batches", title: "Courses & batches", description: "Schedules and capacity", icon: "▦", color: "#315ee8", roles: ["admin", "trainer"] },
  { key: "attendance", title: "Attendance", description: "Daily learner check-in", icon: "◷", color: "#159a79", roles: ["admin", "trainer"] },
  { key: "invoices", title: "Fees & billing", description: "Invoices and balances", icon: "$", color: "#e88833", roles: ["admin"] },
  { key: "expenses", title: "Accounts & expenses", description: "Track center spending", icon: "₹", color: "#b2781d", roles: ["admin"] },
  { key: "leads", title: "Admissions & CRM", description: "Track prospective learners", icon: "◎", color: "#d84e91", roles: ["admin", "trainer"] },
  { key: "assessments", title: "Assessments", description: "Quizzes and assignments", icon: "✦", color: "#7b42df", roles: ["admin", "trainer"] },
  { key: "internships", title: "Internships", description: "Industry opportunities", icon: "↗", color: "#168a9c", roles: ["admin", "trainer"] },
  { key: "placements", title: "Placements", description: "Jobs and employer roles", icon: "⌁", color: "#347aaf", roles: ["admin", "trainer"] },
  { key: "hr", title: "HR & team", description: "Team leave and access", icon: "♧", color: "#6754b9", roles: ["admin", "trainer"] },
  { key: "team", title: "People & access", description: "Students, trainers, roles", icon: "♙", color: "#3970c8", roles: ["admin"] },
  { key: "announcements", title: "Communications", description: "News for your community", icon: "✉", color: "#bc4c63", roles: ["admin"] },
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [tokenReady, setTokenReady] = useState(false);
  const [tab, setTab] = useState<Tab>("Home");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [courses, setCourses] = useState<Course[]>([]);
  const [learning, setLearning] = useState<Array<{ courseId: number; title: string; category: string; totalLessons: number; completedLessons: number }>>([]);
  const [activeLearningCourse, setActiveLearningCourse] = useState<number | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [announcements, setAnnouncements] = useState<Array<{ id: number; title: string; body: string }>>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [dashboard, setDashboard] = useState<Record<string, number>>({});
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [chatText, setChatText] = useState("");
  const [chatMessages, setChatMessages] = useState<Array<{ from: "you" | "assistant"; text: string }>>([
    { from: "assistant", text: "Hi! I can help you find a course, check your learning progress, or explore placement opportunities." },
  ]);
  const [showCourseForm, setShowCourseForm] = useState(false);
  const [courseTitle, setCourseTitle] = useState("");
  const [courseCategory, setCourseCategory] = useState("");
  const [courseDescription, setCourseDescription] = useState("");
  const [centerModule, setCenterModule] = useState<CenterModule | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [savingRecord, setSavingRecord] = useState(false);
  const [showCenterForm, setShowCenterForm] = useState(false);
  const [activeAssessment, setActiveAssessment] = useState<Assessment | null>(null);
  const [submissionText, setSubmissionText] = useState("");
  const [submittingAssessment, setSubmittingAssessment] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [assessmentSubmissions, setAssessmentSubmissions] = useState<AssessmentSubmission[]>([]);
  const [reviewAssessmentId, setReviewAssessmentId] = useState<number | null>(null);
  const [gradeDrafts, setGradeDrafts] = useState<Record<number, string>>({});
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [internships, setInternships] = useState<Internship[]>([]);
  const [team, setTeam] = useState<Array<{ id: number; name: string; email: string; role: Role }>>([]);

  useEffect(() => {
    AsyncStorage.getItem("a2m-token")
      .then(async (savedToken) => {
        if (!savedToken) return;
        try {
          const result = await api<{ user: User }>("/auth/me");
          setUser(result.user);
        } catch {
          await AsyncStorage.removeItem("a2m-token");
        }
      })
      .finally(() => setTokenReady(true));
  }, []);

  const loadData = useCallback(async () => {
    if (!user) return;
    const requests = [
      api<{ courses: Course[] }>("/courses").then((value) => setCourses(value.courses)),
      api<{ role: string; summary: Record<string, number> }>("/dashboard").then((value) => setDashboard(value.summary)),
      api<{ announcements: Array<{ id: number; title: string; body: string }> }>("/announcements").then((value) => setAnnouncements(value.announcements)),
      api<{ placements: Array<{ id: number; company: string; roleTitle: string; location: string; description: string }> }>("/placements").then((value) => setPlacements(value.placements)),
      api<{ internships: Internship[] }>("/internships").then((value) => setInternships(value.internships)),
      api<{ assessments: Assessment[] }>("/assessments").then((value) => setAssessments(value.assessments)),
      api<{ batches: Batch[] }>("/batches").then((value) => setBatches(value.batches)),
      api<{ attendance: AttendanceRecord[] }>("/attendance").then((value) => setAttendance(value.attendance)),
    ];
    if (user.role !== "trainer") {
      requests.push(api<{ certificates: Certificate[] }>("/certificates").then((value) => setCertificates(value.certificates)));
      requests.push(api<{ invoices: Invoice[] }>("/invoices").then((value) => setInvoices(value.invoices)));
    }
    if (user.role === "student") {
      requests.push(api<{ courses: typeof learning }>("/learning").then((value) => setLearning(value.courses)));
    }
    if (user.role === "admin" || user.role === "trainer") {
      requests.push(api<{ leads: Lead[] }>("/leads").then((value) => setLeads(value.leads)));
      requests.push(api<{ branches: Branch[] }>("/branches").then((value) => setBranches(value.branches)));
      if (user.role === "trainer") {
        requests.push(api<{ users: Array<{ id: number; name: string; email: string; role: Role }> }>("/users/students").then((value) => setTeam(value.users)));
      }
      requests.push(api<{ requests: LeaveRequest[] }>("/staff/leave-requests").then((value) => setLeaveRequests(value.requests)));
    }
    if (user.role === "admin") {
      requests.push(api<{ users: Array<{ id: number; name: string; email: string; role: Role }> }>("/users").then((value) => setTeam(value.users)));
      requests.push(api<{ expenses: Expense[] }>("/expenses").then((value) => setExpenses(value.expenses)));
    }
    const results = await Promise.allSettled(requests);
    const failed = results.filter((result) => result.status === "rejected");
    if (failed.length) {
      const firstFailure = failed[0];
      if (firstFailure.status === "rejected") {
        Alert.alert("Some workspace data could not be refreshed", firstFailure.reason instanceof Error ? firstFailure.reason.message : "Please try again.");
      }
    }
  }, [user, refresh]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function submitAuth() {
    if (!email.trim() || !password) {
      Alert.alert("Missing details", "Enter your email and password to continue.");
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ token: string; user: User }>(
        `/auth/${authMode === "register" ? "register" : "login"}`,
        { method: "POST", body: JSON.stringify({ name, email: email.trim(), password }) },
      );
      await AsyncStorage.setItem("a2m-token", result.token);
      setUser(result.user);
      setTab("Home");
      setPassword("");
    } catch (error) {
      Alert.alert("Could not sign in", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function enroll(course: Course) {
    try {
      await api(`/courses/${course.id}/enroll`, { method: "POST" });
      Alert.alert("You're enrolled", `${course.title} is now in your learning list.`);
      setRefresh((value) => value + 1);
      setTab("Learning");
    } catch (error) {
      Alert.alert("Enrollment failed", error instanceof Error ? error.message : "Please try again.");
    }
  }

  async function openLessons(courseId: number) {
    try {
      const result = await api<{ lessons: Lesson[] }>(`/learning/${courseId}/lessons`);
      setLessons(result.lessons);
      setActiveLearningCourse(courseId);
    } catch (error) {
      Alert.alert("Could not load lessons", error instanceof Error ? error.message : "Please try again.");
    }
  }

  async function completeLesson(lesson: Lesson) {
    try {
      await api(`/learning/${lesson.id}/progress`, { method: "POST" });
      setLessons((items) => items.map((item) => item.id === lesson.id ? { ...item, completedAt: new Date().toISOString() } : item));
      setRefresh((value) => value + 1);
    } catch (error) {
      Alert.alert("Could not update progress", error instanceof Error ? error.message : "Please try again.");
    }
  }

  async function createCourse() {
    try {
      await api("/courses", {
        method: "POST",
        body: JSON.stringify({ title: courseTitle, category: courseCategory, description: courseDescription }),
      });
      setShowCourseForm(false);
      setCourseTitle("");
      setCourseCategory("");
      setCourseDescription("");
      setRefresh((value) => value + 1);
      Alert.alert("Course created", "The course is now available in the catalog.");
    } catch (error) {
      Alert.alert("Could not create course", error instanceof Error ? error.message : "Please try again.");
    }
  }

  function centerFields(module: CenterModule): Array<{ key: string; label: string; placeholder: string; numeric?: boolean; multiline?: boolean; optional?: boolean }> {
    const fields: Record<CenterModule, Array<{ key: string; label: string; placeholder: string; numeric?: boolean; multiline?: boolean; optional?: boolean }>> = {
      branches: [
        { key: "name", label: "Branch name", placeholder: "e.g. Downtown Campus" },
        { key: "city", label: "City", placeholder: "e.g. Toronto" },
        { key: "address", label: "Address (optional)", placeholder: "Street and area", optional: true },
      ],
      batches: [
        { key: "courseId", label: "Course ID", placeholder: "Choose an ID from Courses", numeric: true },
        { key: "name", label: "Batch name", placeholder: "e.g. Evening cohort" },
        { key: "startDate", label: "Start date", placeholder: "YYYY-MM-DD" },
        { key: "capacity", label: "Seat capacity", placeholder: "30", numeric: true },
        { key: "branchId", label: "Branch ID (optional)", placeholder: "From Branches", numeric: true, optional: true },
        { key: "trainerId", label: "Trainer ID (optional)", placeholder: "From People & access", numeric: true, optional: true },
      ],
      attendance: [
        { key: "batchId", label: "Batch ID", placeholder: "From Courses & batches", numeric: true },
        { key: "studentId", label: "Student ID", placeholder: "From learner roster below", numeric: true },
        { key: "attendanceDate", label: "Date", placeholder: "YYYY-MM-DD" },
        { key: "status", label: "Status", placeholder: "present, absent, or late" },
      ],
      invoices: [
        { key: "studentId", label: "Student ID", placeholder: "From People & access", numeric: true },
        { key: "courseId", label: "Course ID (optional)", placeholder: "From Courses", numeric: true, optional: true },
        { key: "amount", label: "Amount", placeholder: "0.00", numeric: true },
        { key: "dueDate", label: "Due date (optional)", placeholder: "YYYY-MM-DD", optional: true },
        { key: "notes", label: "Invoice note (optional)", placeholder: "Tuition, installment, etc.", optional: true },
      ],
      expenses: [
        { key: "category", label: "Expense category", placeholder: "e.g. Equipment, rent, software" },
        { key: "description", label: "Description", placeholder: "What was purchased or paid for" },
        { key: "amount", label: "Amount", placeholder: "0.00", numeric: true },
        { key: "transactionDate", label: "Date", placeholder: "YYYY-MM-DD" },
        { key: "branchId", label: "Branch ID (optional)", placeholder: "From Branches", numeric: true, optional: true },
      ],
      leads: [
        { key: "name", label: "Prospect name", placeholder: "Full name" },
        { key: "email", label: "Email (optional)", placeholder: "name@example.com", optional: true },
        { key: "phone", label: "Phone (optional)", placeholder: "Contact number", optional: true },
        { key: "interest", label: "Program of interest (optional)", placeholder: "e.g. Web development", optional: true },
      ],
      assessments: [
        { key: "courseId", label: "Course ID", placeholder: "From Courses", numeric: true },
        { key: "title", label: "Assessment title", placeholder: "e.g. Capstone project" },
        { key: "type", label: "Type (optional)", placeholder: "quiz, assignment, or project", optional: true },
        { key: "dueDate", label: "Due date (optional)", placeholder: "YYYY-MM-DD", optional: true },
      ],
      internships: [
        { key: "company", label: "Company", placeholder: "Company name" },
        { key: "roleTitle", label: "Role title", placeholder: "Internship role" },
        { key: "location", label: "Location", placeholder: "City or remote" },
        { key: "description", label: "Description", placeholder: "Role overview and requirements", multiline: true },
        { key: "applicationUrl", label: "Application link (optional)", placeholder: "https://...", optional: true },
      ],
      placements: [
        { key: "company", label: "Company", placeholder: "Company name" },
        { key: "roleTitle", label: "Role title", placeholder: "Job title" },
        { key: "location", label: "Location", placeholder: "City or remote" },
        { key: "description", label: "Description", placeholder: "Role overview and requirements", multiline: true },
        { key: "applicationUrl", label: "Application link (optional)", placeholder: "https://...", optional: true },
      ],
      hr: [
        { key: "startDate", label: "First day", placeholder: "YYYY-MM-DD" },
        { key: "endDate", label: "Last day", placeholder: "YYYY-MM-DD" },
        { key: "reason", label: "Reason", placeholder: "Briefly describe your request", multiline: true },
      ],
      team: [
        { key: "name", label: "Trainer name", placeholder: "Full name" },
        { key: "email", label: "Email", placeholder: "name@example.com" },
        { key: "password", label: "Temporary password", placeholder: "At least 8 characters" },
      ],
      announcements: [
        { key: "title", label: "Headline", placeholder: "What's new?" },
        { key: "body", label: "Message", placeholder: "Share an update with your community", multiline: true },
      ],
    };
    return fields[module];
  }

  async function saveCenterRecord() {
    if (!centerModule) return;
    const value = (key: string) => formValues[key]?.trim() ?? "";
    const asNumber = (key: string) => Number(value(key));
    let path = "";
    let payload: Record<string, string | number | null> = {};
    switch (centerModule) {
      case "branches":
        path = "/branches";
        payload = { name: value("name"), city: value("city"), address: value("address") };
        break;
      case "batches":
        path = "/batches";
        payload = { courseId: asNumber("courseId"), name: value("name"), startDate: value("startDate"), capacity: asNumber("capacity") || 30, branchId: value("branchId") ? asNumber("branchId") : null, trainerId: value("trainerId") ? asNumber("trainerId") : null };
        break;
      case "attendance":
        path = "/attendance";
        payload = { batchId: asNumber("batchId"), studentId: asNumber("studentId"), attendanceDate: value("attendanceDate"), status: value("status").toLowerCase() };
        break;
      case "invoices":
        path = "/invoices";
        payload = { studentId: asNumber("studentId"), courseId: value("courseId") ? asNumber("courseId") : null, amount: asNumber("amount"), dueDate: value("dueDate") || null, notes: value("notes") };
        break;
      case "expenses":
        path = "/expenses";
        payload = { category: value("category"), description: value("description"), amount: asNumber("amount"), transactionDate: value("transactionDate"), branchId: value("branchId") ? asNumber("branchId") : null };
        break;
      case "leads":
        path = "/leads";
        payload = { name: value("name"), email: value("email"), phone: value("phone"), interest: value("interest") };
        break;
      case "assessments":
        path = "/assessments";
        payload = { courseId: asNumber("courseId"), title: value("title"), type: value("type") || "assignment", dueDate: value("dueDate") || null, maxScore: 100 };
        break;
      case "internships":
        path = "/internships";
        payload = { company: value("company"), roleTitle: value("roleTitle"), location: value("location"), description: value("description"), applicationUrl: value("applicationUrl") };
        break;
      case "placements":
        path = "/placements";
        payload = { company: value("company"), roleTitle: value("roleTitle"), location: value("location"), description: value("description"), applicationUrl: value("applicationUrl") };
        break;
      case "hr":
        path = "/staff/leave-requests";
        payload = { startDate: value("startDate"), endDate: value("endDate"), reason: value("reason") };
        break;
      case "team":
        path = "/users/trainers";
        payload = { name: value("name"), email: value("email"), password: value("password") };
        break;
      case "announcements":
        path = "/announcements";
        payload = { title: value("title"), body: value("body") };
        break;
    }
    const missing = centerFields(centerModule).find((field) => !field.optional && !value(field.key));
    if (missing) {
      Alert.alert("Missing details", `Enter ${missing.label.toLowerCase()} to continue.`);
      return;
    }
    setSavingRecord(true);
    try {
      const cleanPayload = Object.fromEntries(Object.entries(payload).filter(([, fieldValue]) => fieldValue !== ""));
      await api(path, { method: "POST", body: JSON.stringify(cleanPayload) });
      setFormValues({});
      setShowCenterForm(false);
      setRefresh((current) => current + 1);
      Alert.alert("Saved", "Your workspace has been updated.");
    } catch (error) {
      Alert.alert("Could not save", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSavingRecord(false);
    }
  }

  async function requestCertificate(courseId: number) {
    try {
      await api(`/certificates/${courseId}`, { method: "POST" });
      setRefresh((current) => current + 1);
      Alert.alert("Certificate issued", "Your completed course certificate is now in your account.");
    } catch (error) {
      Alert.alert("Certificate unavailable", error instanceof Error ? error.message : "Please try again.");
    }
  }

  async function joinBatch(batch: Batch) {
    try {
      await api(`/batches/${batch.id}/enroll`, { method: "POST" });
      setRefresh((current) => current + 1);
      Alert.alert("Cohort joined", `You're on the roster for ${batch.name}.`);
    } catch (error) {
      Alert.alert("Could not join cohort", error instanceof Error ? error.message : "Please try again.");
    }
  }

  async function submitAssessment() {
    if (!activeAssessment || !submissionText.trim()) {
      Alert.alert("Add your work", "Write a response before submitting.");
      return;
    }
    setSubmittingAssessment(true);
    try {
      await api(`/assessments/${activeAssessment.id}/submissions`, {
        method: "POST",
        body: JSON.stringify({ submissionText: submissionText.trim() }),
      });
      setActiveAssessment(null);
      setSubmissionText("");
      Alert.alert("Work submitted", "Your trainer can now review your assessment.");
    } catch (error) {
      Alert.alert("Could not submit work", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSubmittingAssessment(false);
    }
  }

  async function reviewSubmissions(assessmentId: number) {
    try {
      const result = await api<{ submissions: AssessmentSubmission[] }>(`/assessments/${assessmentId}/submissions`);
      setAssessmentSubmissions(result.submissions);
      setReviewAssessmentId(assessmentId);
      setGradeDrafts({});
    } catch (error) {
      Alert.alert("Could not load submissions", error instanceof Error ? error.message : "Please try again.");
    }
  }

  async function gradeAssessmentSubmission(submissionId: number) {
    const score = Number(gradeDrafts[submissionId]);
    if (!Number.isFinite(score) || score < 0) {
      Alert.alert("Enter a score", "Use a non-negative number for the assessment score.");
      return;
    }
    try {
      await api(`/assessment-submissions/${submissionId}/grade`, { method: "PATCH", body: JSON.stringify({ score }) });
      setAssessmentSubmissions((items) => items.map((item) => item.id === submissionId ? { ...item, score } : item));
    } catch (error) {
      Alert.alert("Could not save score", error instanceof Error ? error.message : "Please try again.");
    }
  }

  async function advanceLead(lead: Lead) {
    const sequence = ["new", "contacted", "qualified", "enrolled", "lost"];
    const nextStatus = sequence[(sequence.indexOf(lead.status) + 1) % sequence.length];
    try {
      await api(`/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify({ status: nextStatus }) });
      setLeads((items) => items.map((item) => item.id === lead.id ? { ...item, status: nextStatus } : item));
    } catch (error) {
      Alert.alert("Could not update lead", error instanceof Error ? error.message : "Please try again.");
    }
  }

  async function reviewLeaveRequest(requestId: number, status: "approved" | "declined") {
    try {
      await api(`/staff/leave-requests/${requestId}`, { method: "PATCH", body: JSON.stringify({ status }) });
      setLeaveRequests((items) => items.map((item) => item.id === requestId ? { ...item, status } : item));
    } catch (error) {
      Alert.alert("Could not update request", error instanceof Error ? error.message : "Please try again.");
    }
  }

  function recordInvoicePayment(invoice: Invoice) {
    const outstanding = Math.round((Number(invoice.amount) - Number(invoice.amountPaid)) * 100) / 100;
    if (outstanding <= 0) return;
    Alert.alert(
      "Record payment received?",
      `This will record ₹${outstanding.toLocaleString()} against invoice #${invoice.id}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: async () => {
            try {
              await api(`/invoices/${invoice.id}/payments`, { method: "POST", body: JSON.stringify({ amount: outstanding }) });
              setRefresh((current) => current + 1);
            } catch (error) {
              Alert.alert("Could not record payment", error instanceof Error ? error.message : "Please try again.");
            }
          },
        },
      ],
    );
  }

  function renderCenterRecords() {
    if (!centerModule) return null;
    switch (centerModule) {
      case "branches":
        return branches.map((branch) => <View style={styles.noticeCard} key={branch.id}><Text style={styles.cardTitle}>{branch.name}</Text><Text style={styles.cardCopy}>{branch.city}{branch.address ? ` · ${branch.address}` : ""}</Text><Text style={styles.courseMeta}>Branch ID {branch.id}</Text></View>);
      case "batches":
        return batches.map((batch) => <View style={styles.noticeCard} key={batch.id}><View style={styles.courseTop}><Text style={styles.cardTitle}>{batch.name}</Text><Text style={styles.category}>{batch.status}</Text></View><Text style={styles.cardCopy}>{batch.courseTitle} · {batch.studentCount}/{batch.capacity} learners · {batch.startDate?.slice(0, 10)}</Text><Text style={styles.courseMeta}>{batch.trainerName ?? "Trainer to be assigned"}{batch.branchName ? ` · ${batch.branchName}` : ""} · Batch ID {batch.id}</Text></View>);
      case "attendance":
        return <>{(user?.role === "admin" || user?.role === "trainer") && team.filter((member) => member.role === "student").length > 0 && <View style={styles.rosterCard}><Text style={styles.cardTitle}>Learner roster</Text>{team.filter((member) => member.role === "student").slice(0, 8).map((member) => <Text style={styles.rosterLine} key={member.id}>ID {member.id}  ·  {member.name}</Text>)}</View>}{attendance.map((record) => <View style={styles.noticeCard} key={record.id}><View style={styles.courseTop}><Text style={styles.cardTitle}>{record.studentName}</Text><Text style={styles.category}>{record.status}</Text></View><Text style={styles.cardCopy}>{record.courseTitle} · {record.batchName} · {String(record.attendanceDate).slice(0, 10)}</Text></View>)}</>;
      case "invoices":
        return invoices.map((invoice) => <View style={styles.noticeCard} key={invoice.id}><View style={styles.courseTop}><Text style={styles.cardTitle}>{invoice.studentName ?? invoice.courseTitle ?? "Tuition invoice"}</Text><Text style={[styles.category, invoice.status === "paid" && styles.paidCategory]}>{invoice.status}</Text></View><Text style={styles.cardCopy}>₹{Number(invoice.amountPaid).toLocaleString()} paid of ₹{Number(invoice.amount).toLocaleString()}{invoice.dueDate ? ` · Due ${String(invoice.dueDate).slice(0, 10)}` : ""}</Text>{user?.role === "admin" && invoice.status !== "paid" && <Pressable style={styles.manageButton} onPress={() => recordInvoicePayment(invoice)}><Text style={styles.manageButtonText}>Record payment received</Text></Pressable>}</View>);
      case "expenses":
        return expenses.map((expense) => <View style={styles.noticeCard} key={expense.id}><View style={styles.courseTop}><Text style={styles.cardTitle}>{expense.category}</Text><Text style={styles.expenseAmount}>₹{Number(expense.amount).toLocaleString()}</Text></View><Text style={styles.cardCopy}>{expense.description}</Text><Text style={styles.courseMeta}>{String(expense.transactionDate).slice(0, 10)}{expense.branchName ? ` · ${expense.branchName}` : ""}</Text></View>);
      case "leads":
        return leads.map((lead) => <Pressable style={styles.noticeCard} key={lead.id} onPress={() => advanceLead(lead)}><View style={styles.courseTop}><Text style={styles.cardTitle}>{lead.name}</Text><Text style={styles.category}>{lead.status}</Text></View><Text style={styles.cardCopy}>{lead.interest ?? "Program inquiry"} · {lead.source}</Text><Text style={styles.courseMeta}>Tap to advance lead stage</Text></Pressable>);
      case "assessments":
        return <>{assessments.map((item) => <View style={styles.noticeCard} key={item.id}><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.cardCopy}>{item.courseTitle} · {item.type} · {item.maxScore} points{item.dueDate ? ` · Due ${String(item.dueDate).slice(0, 10)}` : ""}</Text><Pressable style={styles.manageButton} onPress={() => reviewSubmissions(item.id)}><Text style={styles.manageButtonText}>Review submissions</Text></Pressable></View>)}{reviewAssessmentId !== null && <View style={styles.lessonPanel}><Text style={styles.cardTitle}>Student submissions</Text>{assessmentSubmissions.map((submission) => <View style={styles.submissionRow} key={submission.id}><Text style={styles.cardTitle}>{submission.studentName} · ID {submission.studentId}</Text><Text style={styles.cardCopy}>{submission.submissionText}</Text><View style={styles.gradeRow}><TextInput style={styles.gradeInput} value={gradeDrafts[submission.id] ?? (submission.score === null ? "" : String(submission.score))} onChangeText={(text) => setGradeDrafts((current) => ({ ...current, [submission.id]: text }))} placeholder="Score" placeholderTextColor="#9aa5b5" keyboardType="numeric" /><Pressable style={styles.gradeButton} onPress={() => gradeAssessmentSubmission(submission.id)}><Text style={styles.sendText}>Save score</Text></Pressable></View></View>)}{!assessmentSubmissions.length && <Text style={styles.cardCopy}>No learner submissions yet.</Text>}</View>}</>;
      case "internships":
        return internships.map((item) => <View style={styles.noticeCard} key={item.id}><Text style={styles.cardTitle}>{item.roleTitle}</Text><Text style={styles.cardCopy}>{item.company} · {item.location}</Text><Text style={styles.cardCopy}>{item.description}</Text></View>);
      case "placements":
        return placements.map((item) => <View style={styles.noticeCard} key={item.id}><Text style={styles.cardTitle}>{item.roleTitle}</Text><Text style={styles.cardCopy}>{item.company} · {item.location}</Text><Text style={styles.cardCopy}>{item.description}</Text></View>);
      case "hr":
        return leaveRequests.map((item) => <View style={styles.noticeCard} key={item.id}><View style={styles.courseTop}><Text style={styles.cardTitle}>{item.userName}</Text><Text style={styles.category}>{item.status}</Text></View><Text style={styles.cardCopy}>{String(item.startDate).slice(0, 10)} – {String(item.endDate).slice(0, 10)} · {item.reason}</Text>{user?.role === "admin" && item.status === "pending" && <View style={styles.gradeRow}><Pressable style={styles.gradeButton} onPress={() => reviewLeaveRequest(item.id, "approved")}><Text style={styles.sendText}>Approve</Text></Pressable><Pressable style={styles.declineButton} onPress={() => reviewLeaveRequest(item.id, "declined")}><Text style={styles.declineText}>Decline</Text></Pressable></View>}</View>);
      case "team":
        return team.map((member) => <View style={styles.noticeCard} key={member.id}><View style={styles.courseTop}><Text style={styles.cardTitle}>{member.name}</Text><Text style={styles.category}>{member.role}</Text></View><Text style={styles.cardCopy}>{member.email} · ID {member.id}</Text></View>);
      case "announcements":
        return announcements.map((item) => <View style={styles.noticeCard} key={item.id}><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.cardCopy}>{item.body}</Text></View>);
    }
  }

  function hasCenterRecords() {
    if (!centerModule) return false;
    switch (centerModule) {
      case "branches": return branches.length > 0;
      case "batches": return batches.length > 0;
      case "attendance": return attendance.length > 0;
      case "invoices": return invoices.length > 0;
      case "expenses": return expenses.length > 0;
      case "leads": return leads.length > 0;
      case "assessments": return assessments.length > 0;
      case "internships": return internships.length > 0;
      case "placements": return placements.length > 0;
      case "hr": return leaveRequests.length > 0;
      case "team": return team.length > 0;
      case "announcements": return announcements.length > 0;
    }
  }

  async function sendMessage() {
    const message = chatText.trim();
    if (!message) return;
    setChatText("");
    setChatMessages((items) => [...items, { from: "you", text: message }]);
    try {
      const result = await api<{ reply: string }>("/chat", { method: "POST", body: JSON.stringify({ message }) });
      setChatMessages((items) => [...items, { from: "assistant", text: result.reply }]);
    } catch (error) {
      setChatMessages((items) => [...items, { from: "assistant", text: error instanceof Error ? error.message : "Please try again." }]);
    }
  }

  async function signOut() {
    await AsyncStorage.removeItem("a2m-token");
    setUser(null);
    setTab("Home");
  }

  if (!tokenReady) {
    return <View style={styles.center}><ActivityIndicator color={colors.blue} /></View>;
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="dark" />
        <KeyboardAvoidingView style={styles.authWrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <LinearGradient colors={["#315ee8", "#7542d8"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.brandMark}><Text style={styles.brandMarkText}>A2M</Text></LinearGradient>
          <Text style={styles.eyebrow}>LEARN · BUILD · GET PLACED</Text>
          <Text style={styles.authTitle}>{authMode === "login" ? "Welcome back" : "Start your journey"}</Text>
          <Text style={styles.subtle}>Technology skills for what's next.</Text>
          <View style={styles.authCard}>
            {authMode === "register" && <Field label="Full name" value={name} onChangeText={setName} placeholder="Your name" />}
            <Field label="Email address" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
            <Field label="Password" value={password} onChangeText={setPassword} placeholder="At least 8 characters" secureTextEntry />
            <PrimaryButton title={busy ? "Please wait..." : authMode === "login" ? "Sign in" : "Create student account"} onPress={submitAuth} disabled={busy} />
            <Pressable onPress={() => setAuthMode(authMode === "login" ? "register" : "login")} style={styles.switchAuth}>
              <Text style={styles.switchText}>{authMode === "login" ? "New to A2M? " : "Already have an account? "}<Text style={styles.linkText}>{authMode === "login" ? "Create an account" : "Sign in"}</Text></Text>
            </Pressable>
          </View>
          <Text style={styles.authFootnote}>Student accounts are open for registration. Trainer and admin access is managed by A2M.</Text>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.topBar}>
        <View><Text style={styles.brand}>A2M <Text style={styles.brandAccent}>INFOTECH</Text></Text><Text style={styles.topRole}>{user.role.toUpperCase()} PORTAL</Text></View>
        <View style={styles.avatar}><Text style={styles.avatarText}>{user.name.slice(0, 1).toUpperCase()}</Text></View>
      </View>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        {tab === "Home" && (
          <>
            <Text style={styles.greeting}>Hello, {user.name.split(" ")[0]} 👋</Text>
            <Text style={styles.subtle}>Your next opportunity starts here.</Text>
            <LinearGradient colors={["#152d68", "#315ee8", "#7542d8"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
              <Text style={styles.heroEyebrow}>A2M INFOTECH  ·  CAREER-READY TECH</Text>
              <Text style={styles.heroTitle}>{user.role === "student" ? "Learn skills that move you forward." : "Your training center, in one place."}</Text>
              <Text style={styles.heroCopy}>Practical learning, stronger outcomes, and a smarter way to grow.</Text>
              <Pressable style={styles.heroButton} onPress={() => setTab(user.role === "student" ? "Courses" : "Center")}><Text style={styles.heroButtonText}>{user.role === "student" ? "Explore programs  →" : "Open operations  →"}</Text></Pressable>
            </LinearGradient>
            <Text style={styles.sectionTitle}>{user.role === "student" ? "Your learning snapshot" : "Business overview"}</Text>
            <View style={styles.statsRow}>
              {(user.role === "student"
                ? [["Courses", dashboard.enrolledCourses ?? 0], ["Lessons done", dashboard.completedLessons ?? 0], ["Certificates", certificates.length]]
                : [["Students", dashboard.students ?? 0], ["Programs", dashboard.courses ?? 0], [user.role === "admin" ? "Enrollments" : "Batches", user.role === "admin" ? dashboard.enrollments ?? 0 : dashboard.batches ?? 0]]
              ).map(([label, count]) => <View key={String(label)} style={styles.statCard}><Text style={styles.statNumber}>{count}</Text><Text style={styles.statLabel}>{label}</Text></View>)}
            </View>
            {user.role === "admin" && <View style={styles.analyticsStrip}><Text style={styles.analyticsText}>{dashboard.branches ?? 0} branches</Text><Text style={styles.analyticsDot}>·</Text><Text style={styles.analyticsText}>{dashboard.activeLeads ?? 0} active leads</Text><Text style={styles.analyticsDot}>·</Text><Text style={styles.analyticsText}>{dashboard.pendingInvoices ?? 0} open invoices</Text></View>}
            {user.role === "trainer" && <View style={styles.analyticsStrip}><Text style={styles.analyticsText}>{dashboard.submissionsToReview ?? 0} to review</Text><Text style={styles.analyticsDot}>·</Text><Text style={styles.analyticsText}>{dashboard.batches ?? 0} cohorts</Text></View>}
            {(user.role === "admin" || user.role === "trainer") && (
              <Pressable style={styles.manageButton} onPress={() => setShowCourseForm(true)}><Text style={styles.manageButtonText}>＋  Create a training program</Text></Pressable>
            )}
            {user.role !== "student" && <><Text style={styles.sectionTitle}>Your workspace</Text><View style={styles.moduleGrid}>{centerModules.filter((item) => item.roles.includes(user.role)).slice(0, 6).map((item) => <Pressable key={item.key} style={styles.moduleCard} onPress={() => { setTab("Center"); setCenterModule(item.key); }}><View style={[styles.moduleIcon, { backgroundColor: `${item.color}18` }]}><Text style={[styles.moduleIconText, { color: item.color }]}>{item.icon}</Text></View><Text style={styles.moduleTitle}>{item.title}</Text><Text style={styles.moduleCopy}>{item.description}</Text></Pressable>)}</View></>}
            <Text style={styles.sectionTitle}>Latest updates</Text>
            {announcements.length ? announcements.slice(0, 3).map((item) => <View style={styles.noticeCard} key={item.id}><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.cardCopy}>{item.body}</Text></View>) : <EmptyState text="Updates from A2M will appear here." />}
            <Text style={styles.sectionTitle}>Placement opportunities</Text>
            {placements.length ? placements.slice(0, 3).map((item) => <View style={styles.noticeCard} key={item.id}><Text style={styles.cardTitle}>{item.roleTitle}</Text><Text style={styles.cardCopy}>{item.company} · {item.location}</Text><Text style={styles.cardCopy}>{item.description}</Text></View>) : <EmptyState text="New job and placement opportunities will appear here." />}
          </>
        )}
        {tab === "Courses" && (
          <>
            <Text style={styles.pageTitle}>Explore programs</Text><Text style={styles.subtle}>Build in-demand skills with practical training.</Text>
            {courses.map((course) => <View style={styles.courseCard} key={course.id}><View style={styles.courseTop}><Text style={styles.category}>{course.category}</Text><Text style={styles.duration}>{course.durationWeeks} weeks</Text></View><Text style={styles.courseTitle}>{course.title}</Text><Text style={styles.cardCopy}>{course.description}</Text><Text style={styles.courseMeta}>{course.trainerName ? `Trainer · ${course.trainerName}` : "Expert-led practical learning"}  ·  {course.studentCount} learners{user.role === "student" ? "" : ` · Course ID ${course.id}`}</Text>{user.role === "student" && <PrimaryButton title={learning.some((item) => item.courseId === course.id) ? "Continue learning" : "Enroll in program"} onPress={() => learning.some((item) => item.courseId === course.id) ? setTab("Learning") : enroll(course)} />}</View>)}
            {!courses.length && <EmptyState text="No programs available yet." />}
          </>
        )}
        {tab === "Learning" && (
          <>
            <Text style={styles.pageTitle}>My learning</Text><Text style={styles.subtle}>Pick up where you left off.</Text>
            {activeLearningCourse !== null && <View style={styles.lessonPanel}>
              <Pressable onPress={() => setActiveLearningCourse(null)}><Text style={styles.linkText}>← Back to my programs</Text></Pressable>
              <Text style={styles.sectionTitle}>Course lessons</Text>
              {lessons.map((lesson) => <Pressable key={lesson.id} style={styles.lessonRow} onPress={() => !lesson.completedAt && completeLesson(lesson)}><View style={[styles.lessonCheck, lesson.completedAt && styles.lessonCheckDone]}><Text style={styles.lessonCheckText}>{lesson.completedAt ? "✓" : ""}</Text></View><Text style={styles.lessonTitle}>{lesson.title}</Text><Text style={styles.lessonAction}>{lesson.completedAt ? "Done" : "Mark done"}</Text></Pressable>)}
              {!lessons.length && <Text style={styles.cardCopy}>Lessons are being prepared for this program.</Text>}
            </View>}
            {learning.map((item) => {
              const total = Number(item.totalLessons);
              const completed = Number(item.completedLessons);
              const percent = total ? Math.round((completed / total) * 100) : 0;
              return <View style={styles.courseCard} key={item.courseId}><Pressable onPress={() => openLessons(item.courseId)}><Text style={styles.category}>{item.category}</Text><Text style={styles.courseTitle}>{item.title}</Text><View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${percent}%` }]} /></View><Text style={styles.courseMeta}>{total ? `${completed} of ${total} lessons · ${percent}% complete` : "Your course materials will be available soon."}  ·  Tap to open</Text></Pressable>{percent === 100 && <PrimaryButton title="Get course certificate" onPress={() => requestCertificate(item.courseId)} />}</View>;
            })}
            {!learning.length && <View style={styles.emptyCard}><Text style={styles.emptyTitle}>Your learning journey starts here</Text><Text style={styles.cardCopy}>Enroll in a program to see your lessons and track progress.</Text><PrimaryButton title="Browse programs" onPress={() => setTab("Courses")} /></View>}
          </>
        )}
        {tab === "Center" && (
          <>
            <Text style={styles.pageTitle}>{centerModule ? centerModules.find((item) => item.key === centerModule)?.title : "Training center"}</Text>
            <Text style={styles.subtle}>{centerModule ? centerModules.find((item) => item.key === centerModule)?.description : "A clear view of your people, programs, and daily operations."}</Text>
            {!centerModule ? (
              <>
                <LinearGradient colors={["#33267b", "#6743d3", "#9d58ce"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.centerBanner}>
                  <Text style={styles.heroEyebrow}>A2M OPERATIONS</Text><Text style={styles.heroTitle}>Everything your team needs to keep learning moving.</Text>
                  <Text style={styles.heroCopy}>Role-aware tools for programs, admissions, people, finance, and learner outcomes.</Text>
                </LinearGradient>
                <View style={styles.moduleGrid}>{centerModules.filter((item) => item.roles.includes(user.role)).map((item) => <Pressable key={item.key} style={styles.moduleCard} onPress={() => setCenterModule(item.key)}><View style={[styles.moduleIcon, { backgroundColor: `${item.color}18` }]}><Text style={[styles.moduleIconText, { color: item.color }]}>{item.icon}</Text></View><Text style={styles.moduleTitle}>{item.title}</Text><Text style={styles.moduleCopy}>{item.description}</Text></Pressable>)}</View>
              </>
            ) : (
              <>
                <Pressable style={styles.backLink} onPress={() => setCenterModule(null)}><Text style={styles.linkText}>← All workspace tools</Text></Pressable>
                <View style={styles.centerActions}>
                  <PrimaryButton title={`＋  Add ${{ branches: "branch", batches: "batch", attendance: "attendance", invoices: "invoice", expenses: "expense", leads: "prospect", assessments: "assessment", internships: "internship", placements: "placement", hr: "leave request", team: "trainer", announcements: "announcement" }[centerModule]}`} onPress={() => { setFormValues(centerModule === "batches" ? { capacity: "30" } : {}); setShowCenterForm(true); }} />
                </View>
                {renderCenterRecords()}
                {!hasCenterRecords() && <EmptyState text="Records will appear here as your team adds them." />}
                {centerModule === "team" && <Text style={styles.chatNote}>Student and trainer accounts are listed here. New trainer access is created with a temporary password.</Text>}
                {centerModule === "invoices" && <Text style={styles.chatNote}>This workspace records invoices and payments. Online payment processing can be connected when a payment provider is configured.</Text>}
              </>
            )}
          </>
        )}
        {tab === "Opportunities" && (
          <>
            <Text style={styles.pageTitle}>Your opportunities</Text><Text style={styles.subtle}>Jobs, internships, credentials, and account updates.</Text>
            <Text style={styles.sectionTitle}>Upcoming cohorts</Text>
            {batches.filter((batch) => learning.some((course) => course.courseId === batch.courseId)).map((batch) => <View style={styles.noticeCard} key={`batch-${batch.id}`}><Text style={styles.cardTitle}>{batch.name}</Text><Text style={styles.cardCopy}>{batch.courseTitle} · Starts {String(batch.startDate).slice(0, 10)} · {batch.studentCount}/{batch.capacity} seats</Text><PrimaryButton title="Join this cohort" onPress={() => joinBatch(batch)} /></View>)}
            <Text style={styles.sectionTitle}>Internships</Text>
            {internships.map((item) => <View style={styles.noticeCard} key={`internship-${item.id}`}><Text style={styles.cardTitle}>{item.roleTitle}</Text><Text style={styles.cardCopy}>{item.company} · {item.location}</Text><Text style={styles.cardCopy}>{item.description}</Text></View>)}
            <Text style={styles.sectionTitle}>Placement opportunities</Text>
            {placements.map((item) => <View style={styles.noticeCard} key={`placement-${item.id}`}><Text style={styles.cardTitle}>{item.roleTitle}</Text><Text style={styles.cardCopy}>{item.company} · {item.location}</Text><Text style={styles.cardCopy}>{item.description}</Text></View>)}
            <Text style={styles.sectionTitle}>Assessments</Text>
            {assessments.map((item) => <View style={styles.noticeCard} key={`assessment-${item.id}`}><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.cardCopy}>{item.courseTitle} · {item.type}{item.dueDate ? ` · Due ${String(item.dueDate).slice(0, 10)}` : ""}</Text><PrimaryButton title="Submit work" onPress={() => { setSubmissionText(""); setActiveAssessment(item); }} /></View>)}
            <Text style={styles.sectionTitle}>Fees & billing</Text>
            {invoices.map((invoice) => <View style={styles.noticeCard} key={`invoice-${invoice.id}`}><View style={styles.courseTop}><Text style={styles.cardTitle}>{invoice.courseTitle ?? "Tuition invoice"}</Text><Text style={[styles.category, invoice.status === "paid" && styles.paidCategory]}>{invoice.status}</Text></View><Text style={styles.cardCopy}>₹{Number(invoice.amountPaid).toLocaleString()} paid of ₹{Number(invoice.amount).toLocaleString()}{invoice.dueDate ? ` · Due ${String(invoice.dueDate).slice(0, 10)}` : ""}</Text></View>)}
            <Text style={styles.sectionTitle}>Certificates</Text>
            {certificates.map((certificate) => <View style={styles.noticeCard} key={`certificate-${certificate.id}`}><Text style={styles.cardTitle}>{certificate.courseTitle}</Text><Text style={styles.cardCopy}>Certificate {certificate.certificateCode}</Text></View>)}
            {!internships.length && !placements.length && !assessments.length && !invoices.length && !certificates.length && <EmptyState text="New opportunities and account updates will appear here." />}
          </>
        )}
        {tab === "Assistant" && (
          <>
            <Text style={styles.pageTitle}>A2M assistant</Text><Text style={styles.subtle}>Ask about training, learning, and placements.</Text>
            <View style={styles.chatCard}>{chatMessages.map((message, index) => <View key={`${index}-${message.from}`} style={[styles.chatBubble, message.from === "you" ? styles.userBubble : styles.assistantBubble]}><Text style={message.from === "you" ? styles.userBubbleText : styles.assistantBubbleText}>{message.text}</Text></View>)}</View>
            <View style={styles.chatInputRow}><TextInput style={styles.chatInput} value={chatText} onChangeText={setChatText} placeholder="Ask us anything..." placeholderTextColor="#8b98aa" onSubmitEditing={sendMessage} returnKeyType="send" /><Pressable style={styles.sendButton} onPress={sendMessage}><Text style={styles.sendText}>Send</Text></Pressable></View>
            <Text style={styles.chatNote}>A2M assistant currently answers common questions. Contact the team for account-specific support.</Text>
          </>
        )}
        {tab === "Account" && (
          <>
            <Text style={styles.pageTitle}>Your account</Text>
            <View style={styles.profileCard}><View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>{user.name.slice(0, 1).toUpperCase()}</Text></View><Text style={styles.profileName}>{user.name}</Text><Text style={styles.cardCopy}>{user.email}</Text><Text style={styles.rolePill}>{user.role}</Text></View>
            <View style={styles.noticeCard}><Text style={styles.cardTitle}>A2M Infotech</Text><Text style={styles.cardCopy}>Training, development, and career support across web, mobile, AI, data analytics, DevOps, and cloud.</Text></View>
            <Pressable style={styles.signOutButton} onPress={signOut}><Text style={styles.signOutText}>Sign out</Text></Pressable>
          </>
        )}
      </ScrollView>
      <View style={styles.bottomNav}>{(user.role === "student" ? ["Home", "Courses", "Learning", "Opportunities", "Account"] as Tab[] : ["Home", "Courses", "Center", "Assistant", "Account"] as Tab[]).map((item) => <Pressable key={item} onPress={() => setTab(item)} style={styles.navItem}><Text style={[styles.navIcon, tab === item && styles.navIconActive]}>{({ Home: "⌂", Courses: "▦", Learning: "◷", Assistant: "✦", Account: "○", Center: "◈", Opportunities: "↗" })[item]}</Text><Text style={[styles.navLabel, tab === item && styles.navLabelActive]}>{item}</Text></Pressable>)}</View>
      {showCourseForm && <View style={styles.modalBackdrop}><View style={styles.modalCard}><Text style={styles.sectionTitle}>Create a program</Text><Field label="Program title" value={courseTitle} onChangeText={setCourseTitle} placeholder="e.g. Cloud foundations" /><Field label="Category" value={courseCategory} onChangeText={setCourseCategory} placeholder="e.g. Cloud & DevOps" /><Field label="Description" value={courseDescription} onChangeText={setCourseDescription} placeholder="What learners will build and learn" multiline /><PrimaryButton title="Publish program" onPress={createCourse} /><Pressable style={styles.cancelButton} onPress={() => setShowCourseForm(false)}><Text style={styles.signOutText}>Cancel</Text></Pressable></View></View>}
      {showCenterForm && centerModule && <View style={styles.modalBackdrop}><ScrollView style={styles.centerModalScroll} contentContainerStyle={styles.modalCard} keyboardShouldPersistTaps="handled"><Text style={styles.sectionTitle}>Add {centerModules.find((item) => item.key === centerModule)?.title.toLowerCase()}</Text><Text style={styles.chatNote}>Fill in the details below to save this record.</Text>{centerFields(centerModule).map((field) => <Field key={field.key} label={field.label} value={formValues[field.key] ?? ""} onChangeText={(text) => setFormValues((current) => ({ ...current, [field.key]: text }))} placeholder={field.placeholder} keyboardType={field.numeric ? "numeric" : "default"} secureTextEntry={field.key === "password"} multiline={field.multiline} />)}<PrimaryButton title={savingRecord ? "Saving..." : "Save record"} onPress={saveCenterRecord} disabled={savingRecord} /><Pressable style={styles.cancelButton} onPress={() => setShowCenterForm(false)}><Text style={styles.signOutText}>Cancel</Text></Pressable></ScrollView></View>}
      {activeAssessment && <View style={styles.modalBackdrop}><View style={styles.modalCard}><Text style={styles.sectionTitle}>{activeAssessment.title}</Text><Text style={styles.chatNote}>{activeAssessment.courseTitle} · {activeAssessment.type} · Up to {activeAssessment.maxScore} points</Text><Field label="Your submission" value={submissionText} onChangeText={setSubmissionText} placeholder="Write your response or project notes" multiline /><PrimaryButton title={submittingAssessment ? "Submitting..." : "Submit work"} onPress={submitAssessment} disabled={submittingAssessment} /><Pressable style={styles.cancelButton} onPress={() => setActiveAssessment(null)}><Text style={styles.signOutText}>Cancel</Text></Pressable></View></View>}
    </SafeAreaView>
  );
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, ...inputProps } = props;
  return <View style={styles.fieldWrap}><Text style={styles.fieldLabel}>{label}</Text><TextInput {...inputProps} style={[styles.input, inputProps.multiline && styles.multilineInput]} placeholderTextColor="#9aa5b5" /></View>;
}

function PrimaryButton({ title, onPress, disabled = false }: { title: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} style={[styles.primaryButton, disabled && styles.disabledButton]}><Text style={styles.primaryButtonText}>{title}</Text></Pressable>;
}

function EmptyState({ text }: { text: string }) {
  return <View style={styles.emptyInline}><Text style={styles.cardCopy}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  authWrap: { flex: 1, justifyContent: "center", paddingHorizontal: 24 },
  brandMark: { width: 58, height: 58, borderRadius: 18, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center", marginBottom: 26 },
  brandMarkText: { color: colors.white, fontWeight: "900", fontSize: 18 },
  eyebrow: { color: colors.blue, fontWeight: "800", letterSpacing: 1.4, fontSize: 11 },
  authTitle: { color: colors.ink, fontWeight: "800", fontSize: 32, marginTop: 8 },
  subtle: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 5 },
  authCard: { backgroundColor: colors.white, borderRadius: 22, padding: 20, marginTop: 26, borderWidth: 1, borderColor: colors.line },
  fieldWrap: { marginBottom: 15 },
  fieldLabel: { color: colors.ink, fontSize: 12, fontWeight: "700", marginBottom: 7 },
  input: { height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 13, color: colors.ink, fontSize: 14, backgroundColor: colors.white },
  multilineInput: { height: 90, paddingTop: 12, textAlignVertical: "top" },
  primaryButton: { backgroundColor: colors.blue, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 5 },
  disabledButton: { opacity: 0.65 },
  primaryButtonText: { color: colors.white, fontSize: 14, fontWeight: "700" },
  switchAuth: { alignItems: "center", paddingTop: 18 },
  switchText: { color: colors.muted, fontSize: 13 },
  linkText: { color: colors.blue, fontWeight: "700" },
  authFootnote: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 20, paddingHorizontal: 16 },
  topBar: { height: 66, paddingHorizontal: 20, backgroundColor: colors.white, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderColor: colors.line },
  brand: { color: colors.ink, fontSize: 18, fontWeight: "900", letterSpacing: 0.3 },
  brandAccent: { color: colors.blue, fontSize: 11, letterSpacing: 1.4 },
  topRole: { color: colors.muted, fontSize: 9, letterSpacing: 1.2, marginTop: 3, fontWeight: "700" },
  avatar: { width: 38, height: 38, borderRadius: 20, backgroundColor: colors.pale, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.blue, fontWeight: "800", fontSize: 15 },
  page: { padding: 20, paddingBottom: 35 },
  greeting: { color: colors.ink, fontSize: 25, fontWeight: "800" },
  hero: { backgroundColor: "#1d3268", borderRadius: 22, padding: 22, marginTop: 22, overflow: "hidden" },
  centerBanner: { borderRadius: 22, padding: 22, marginTop: 20, marginBottom: 8, overflow: "hidden" },
  heroEyebrow: { color: "#b9c9ff", fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  heroTitle: { color: colors.white, fontSize: 25, lineHeight: 31, fontWeight: "800", marginTop: 12, maxWidth: 290 },
  heroCopy: { color: "#d8e0f6", fontSize: 13, lineHeight: 20, marginTop: 9, maxWidth: 300 },
  heroButton: { backgroundColor: colors.white, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 14, alignSelf: "flex-start", marginTop: 19 },
  heroButtonText: { color: "#1d3268", fontSize: 12, fontWeight: "800" },
  sectionTitle: { color: colors.ink, fontSize: 17, fontWeight: "800", marginTop: 24, marginBottom: 12 },
  statsRow: { flexDirection: "row", gap: 10 },
  statCard: { flex: 1, minHeight: 78, backgroundColor: colors.white, borderRadius: 15, padding: 13, borderColor: colors.line, borderWidth: 1, justifyContent: "center" },
  statNumber: { color: colors.ink, fontSize: 22, fontWeight: "800" },
  statLabel: { color: colors.muted, fontSize: 11, marginTop: 3 },
  analyticsStrip: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 7, marginTop: 12, paddingHorizontal: 2 },
  analyticsText: { color: colors.muted, fontSize: 10, fontWeight: "700" },
  analyticsDot: { color: "#b2bdcc", fontSize: 12 },
  manageButton: { backgroundColor: colors.pale, borderRadius: 12, padding: 14, marginTop: 13, alignItems: "center" },
  manageButtonText: { color: colors.blue, fontWeight: "700", fontSize: 13 },
  moduleGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginTop: 4, rowGap: 10 },
  moduleCard: { width: "48.5%", minHeight: 140, backgroundColor: colors.white, borderRadius: 17, padding: 14, borderWidth: 1, borderColor: colors.line, shadowColor: "#183568", shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2 },
  moduleIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  moduleIconText: { fontSize: 20, fontWeight: "800" },
  moduleTitle: { color: colors.ink, fontSize: 12, lineHeight: 17, fontWeight: "800", marginTop: 10 },
  moduleCopy: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 4 },
  rosterCard: { backgroundColor: colors.pale, borderRadius: 15, padding: 14, marginBottom: 10 },
  rosterLine: { color: colors.ink, fontSize: 11, marginTop: 7 },
  submissionRow: { borderTopWidth: 1, borderColor: colors.line, paddingTop: 12, marginTop: 12 },
  gradeRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  gradeInput: { flex: 1, height: 42, borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, color: colors.ink },
  gradeButton: { backgroundColor: colors.blue, borderRadius: 10, paddingHorizontal: 13, alignItems: "center", justifyContent: "center" },
  centerActions: { marginBottom: 10 },
  backLink: { alignSelf: "flex-start", marginTop: 18, marginBottom: 4 },
  paidCategory: { color: colors.green },
  expenseAmount: { color: colors.orange, fontSize: 13, fontWeight: "800" },
  declineButton: { backgroundColor: "#fff0f2", borderRadius: 10, paddingHorizontal: 13, alignItems: "center", justifyContent: "center" },
  declineText: { color: "#b8324c", fontWeight: "700", fontSize: 12 },
  noticeCard: { backgroundColor: colors.white, borderRadius: 15, borderWidth: 1, borderColor: colors.line, padding: 15, marginBottom: 9 },
  cardTitle: { color: colors.ink, fontWeight: "700", fontSize: 14 },
  cardCopy: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 6 },
  pageTitle: { color: colors.ink, fontSize: 25, fontWeight: "800", marginTop: 4 },
  courseCard: { backgroundColor: colors.white, borderRadius: 18, padding: 16, marginTop: 15, borderWidth: 1, borderColor: colors.line, shadowColor: "#183568", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.045, shadowRadius: 10, elevation: 1 },
  courseTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  category: { color: colors.blue, fontSize: 10, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },
  duration: { color: colors.muted, fontSize: 11 },
  courseTitle: { color: colors.ink, fontSize: 17, lineHeight: 23, fontWeight: "800", marginTop: 10 },
  courseMeta: { color: colors.muted, fontSize: 11, marginTop: 11 },
  lessonPanel: { backgroundColor: colors.white, borderRadius: 16, padding: 15, marginTop: 17, borderWidth: 1, borderColor: colors.line },
  lessonRow: { minHeight: 54, flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderColor: colors.line, gap: 10 },
  lessonCheck: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: "#b9c3d2", alignItems: "center", justifyContent: "center" },
  lessonCheckDone: { backgroundColor: colors.green, borderColor: colors.green },
  lessonCheckText: { color: colors.white, fontSize: 13, fontWeight: "800" },
  lessonTitle: { flex: 1, color: colors.ink, fontSize: 12, fontWeight: "600" },
  lessonAction: { color: colors.blue, fontSize: 10, fontWeight: "700" },
  progressTrack: { height: 7, borderRadius: 8, backgroundColor: "#e9edf5", marginTop: 15, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 8, backgroundColor: colors.green },
  emptyCard: { backgroundColor: colors.white, borderRadius: 18, borderWidth: 1, borderColor: colors.line, padding: 18, marginTop: 20 },
  emptyTitle: { color: colors.ink, fontSize: 17, fontWeight: "800" },
  emptyInline: { backgroundColor: colors.white, padding: 14, borderRadius: 13, borderWidth: 1, borderColor: colors.line },
  chatCard: { minHeight: 340, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 18, padding: 14, marginTop: 18 },
  chatBubble: { maxWidth: "86%", borderRadius: 15, padding: 12, marginBottom: 10 },
  userBubble: { alignSelf: "flex-end", backgroundColor: colors.blue },
  assistantBubble: { alignSelf: "flex-start", backgroundColor: colors.background },
  userBubbleText: { color: colors.white, fontSize: 13, lineHeight: 19 },
  assistantBubbleText: { color: colors.ink, fontSize: 13, lineHeight: 19 },
  chatInputRow: { flexDirection: "row", gap: 8, marginTop: 11 },
  chatInput: { flex: 1, height: 47, borderRadius: 12, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 13, color: colors.ink },
  sendButton: { backgroundColor: colors.blue, borderRadius: 12, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  sendText: { color: colors.white, fontWeight: "700", fontSize: 13 },
  chatNote: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 12 },
  profileCard: { alignItems: "center", backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 19, padding: 22, marginTop: 18 },
  profileAvatar: { width: 64, height: 64, borderRadius: 34, backgroundColor: colors.pale, alignItems: "center", justifyContent: "center" },
  profileAvatarText: { color: colors.blue, fontSize: 24, fontWeight: "800" },
  profileName: { color: colors.ink, fontSize: 18, fontWeight: "800", marginTop: 12 },
  rolePill: { color: colors.green, backgroundColor: "#e9f7f0", borderRadius: 12, overflow: "hidden", paddingVertical: 5, paddingHorizontal: 12, fontSize: 11, fontWeight: "700", marginTop: 12, textTransform: "capitalize" },
  signOutButton: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, alignItems: "center", borderRadius: 12, padding: 14, marginTop: 14 },
  signOutText: { color: colors.ink, fontWeight: "700", fontSize: 13 },
  bottomNav: { minHeight: 64, backgroundColor: colors.white, flexDirection: "row", justifyContent: "space-around", alignItems: "center", borderTopWidth: 1, borderColor: colors.line, paddingBottom: Platform.OS === "ios" ? 4 : 0 },
  navItem: { alignItems: "center", justifyContent: "center", minWidth: 55 },
  navIcon: { color: "#9aa5b5", fontSize: 20, height: 24 },
  navIconActive: { color: colors.blue },
  navLabel: { color: "#8a96a8", fontSize: 9, marginTop: 1 },
  navLabelActive: { color: colors.blue, fontWeight: "800" },
  modalBackdrop: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "rgba(14,26,48,0.48)", justifyContent: "center", padding: 20 },
  modalCard: { backgroundColor: colors.white, borderRadius: 20, padding: 20 },
  centerModalScroll: { maxHeight: "90%", backgroundColor: colors.white, borderRadius: 20 },
  cancelButton: { alignItems: "center", padding: 13 },
});
