// src/pages/SignIn.jsx
// Students pick their class, then their name from the roster their professor
// entered, then type their password. The first time (or after the professor
// resets it) they create a password instead. Professors sign in with email.
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import { useAuth } from "../context/AuthContext";
import PhotoHeader from "../components/ui/PhotoHeader";
import SiteTagline from "../components/ui/SiteTagline";

const MIN_PASSWORD = 6;

const fieldClass =
  "w-full std-text bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-4 py-3 rounded-md outline-blue-600 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50";
const submitClass =
  "w-full py-3 px-4 text-sm font-semibold rounded-md text-white bg-blue-600 hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed";
const linkClass = "text-blue-600 dark:text-blue-400 hover:underline font-semibold cursor-pointer";

function classLabel(c) {
  return c.section ? `${c.title} · ${c.section}` : c.title;
}

function EyeIcon({ onClick }) {
  return (
    <svg onClick={onClick} xmlns="http://www.w3.org/2000/svg" fill="#bbb" stroke="#bbb" className="w-4 h-4 absolute right-4 cursor-pointer" viewBox="0 0 128 128">
      <path d="M64 104C22.127 104 1.367 67.496.504 65.943a4 4 0 0 1 0-3.887C1.367 60.504 22.127 24 64 24s62.633 36.504 63.496 38.057a4 4 0 0 1 0 3.887C126.633 67.496 105.873 104 64 104zM8.707 63.994C13.465 71.205 32.146 96 64 96c31.955 0 50.553-24.775 55.293-31.994C114.535 56.795 95.854 32 64 32 32.045 32 13.447 56.775 8.707 63.994zM64 88c-13.234 0-24-10.766-24-24s10.766-24 24-24 24 10.766 24 24-10.766 24-24 24zm0-40c-8.822 0-16 7.178-16 16s7.178 16 16 16 16-7.178 16-16-7.178-16-16-16z" />
    </svg>
  );
}

function PasswordField({ label, value, onChange, visible, onToggle, placeholder, autoComplete }) {
  return (
    <div>
      <label className="std-text text-sm mb-2 block">{label}</label>
      <div className="relative flex items-center">
        <input
          type={visible ? "text" : "password"}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${fieldClass} pr-10`}
          placeholder={placeholder}
          autoComplete={autoComplete}
        />
        <EyeIcon onClick={onToggle} />
      </div>
    </div>
  );
}

// ── Student: class → name → password ─────────────────────────────────────────
function StudentSignIn({ onProfessor }) {
  const navigate = useNavigate();
  const { studentLogin, setupStudentPassword } = useAuth();

  const [classes,  setClasses]  = useState([]);
  const [classId,  setClassId]  = useState("");
  const [students, setStudents] = useState([]);
  const [userId,   setUserId]   = useState("");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [visible,  setVisible]  = useState(false);
  const [forceSetup, setForceSetup] = useState(false);
  const [error,    setError]    = useState(null);
  const [loading,  setLoading]  = useState(false);

  useEffect(() => {
    api.get("/api/auth/classes")
      .then((res) => setClasses(res.data))
      .catch(() => setError("Couldn't load classes. Refresh to try again."));
  }, []);

  useEffect(() => {
    setStudents([]); setUserId("");
    if (!classId) return;
    let ignore = false;
    api.get(`/api/auth/classes/${classId}/students`)
      .then((res) => { if (!ignore) setStudents(res.data); })
      .catch(() => { if (!ignore) setError("Couldn't load names for that class."); });
    return () => { ignore = true; };
  }, [classId]);

  useEffect(() => {
    setPassword(""); setConfirm(""); setForceSetup(false); setError(null);
  }, [userId]);

  const student    = students.find((s) => String(s.id) === userId);
  const needsSetup = !!student && (!student.has_password || forceSetup);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!student || !password) return;
    setError(null);

    if (needsSetup) {
      if (password.length < MIN_PASSWORD) return setError(`Password must be at least ${MIN_PASSWORD} characters.`);
      if (password !== confirm) return setError("Passwords do not match.");
    }

    setLoading(true);
    try {
      if (needsSetup) await setupStudentPassword(Number(classId), student.id, password);
      else            await studentLogin(Number(classId), student.id, password);
      navigate("/home");
    } catch (err) {
      const data = err.response?.data;
      if (data?.needs_password) {
        setForceSetup(true);
        setPassword("");
      }
      setError(data?.error ?? "Sign in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="mt-8 sm:mt-10 space-y-5" onSubmit={handleSubmit}>
      <div>
        <label className="std-text text-sm mb-2 block" htmlFor="class">Class</label>
        <select id="class" value={classId} onChange={(e) => setClassId(e.target.value)} className={fieldClass}>
          <option value="">Choose your class</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>{classLabel(c)}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="std-text text-sm mb-2 block" htmlFor="name">Name</label>
        <select
          id="name"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          disabled={!classId}
          className={fieldClass}
        >
          <option value="">{classId ? "Choose your name" : "Choose a class first"}</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </div>

      {student && (needsSetup ? (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            First time signing in? Create a password you'll use from now on.
          </p>
          <PasswordField
            label="Create a password"
            value={password}
            onChange={setPassword}
            visible={visible}
            onToggle={() => setVisible((v) => !v)}
            placeholder={`At least ${MIN_PASSWORD} characters`}
            autoComplete="new-password"
          />
          <PasswordField
            label="Confirm password"
            value={confirm}
            onChange={setConfirm}
            visible={visible}
            onToggle={() => setVisible((v) => !v)}
            placeholder="Re-enter your password"
            autoComplete="new-password"
          />
        </>
      ) : (
        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          visible={visible}
          onToggle={() => setVisible((v) => !v)}
          placeholder="Enter your password"
          autoComplete="current-password"
        />
      ))}

      {error && <p className="text-sm text-red-500 text-center">{error}</p>}

      <button type="submit" disabled={loading || !student || !password} className={submitClass}>
        {loading ? "Signing in…" : needsSetup ? "Create password & sign in" : "Sign in"}
      </button>

      <p className="text-xs text-center text-slate-500 dark:text-slate-400">
        Name missing or forgot your password? Ask your professor.
      </p>
      <p className="std-text text-sm text-center">
        Professor?{" "}
        <button type="button" onClick={onProfessor} className={`${linkClass} ml-1`}>
          Sign in with email
        </button>
      </p>
    </form>
  );
}

// ── Professor: email + password ──────────────────────────────────────────────
function ProfessorSignIn({ onStudent }) {
  const navigate  = useNavigate();
  const { login } = useAuth();
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [visible,  setVisible]  = useState(false);
  const [error,    setError]    = useState(null);
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!email || !password) return;
    setLoading(true); setError(null);
    try {
      await login(email, password);
      navigate("/home");
    } catch (err) {
      setError(err.response?.data?.error ?? "Sign in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="mt-8 sm:mt-10 space-y-5" onSubmit={handleSubmit}>
      <div>
        <label className="std-text text-sm mb-2 block" htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={fieldClass}
          placeholder="Enter email"
          autoComplete="email"
        />
      </div>
      <PasswordField
        label="Password"
        value={password}
        onChange={setPassword}
        visible={visible}
        onToggle={() => setVisible((v) => !v)}
        placeholder="Enter password"
        autoComplete="current-password"
      />

      {error && <p className="text-sm text-red-500 text-center">{error}</p>}

      <button type="submit" disabled={loading} className={submitClass}>
        {loading ? "Signing in…" : "Sign in"}
      </button>

      <p className="std-text text-sm text-center">
        New professor?{" "}
        <a href="/register" className={`${linkClass} ml-1`}>Register here</a>
      </p>
      <p className="std-text text-sm text-center">
        Student?{" "}
        <button type="button" onClick={onStudent} className={`${linkClass} ml-1`}>
          Sign in with your name
        </button>
      </p>
    </form>
  );
}

function SignIn() {
  const [mode, setMode] = useState("student");

  return (
    <div className="bg-gray-50 dark:bg-slate-950 min-h-screen">
      <SiteTagline />
      <div className="min-h-screen flex flex-row gap-6 items-center justify-center py-6 px-4 transition-colors duration-300">

        {/* Sign in card */}
        <div className="w-full max-w-md">
          <div className="p-6 sm:p-8 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 shadow-sm">
            <h1 className="std-text text-center text-2xl sm:text-3xl font-semibold">
              {mode === "student" ? "Sign in" : "Professor sign in"}
            </h1>
            {mode === "student"
              ? <StudentSignIn onProfessor={() => setMode("professor")} />
              : <ProfessorSignIn onStudent={() => setMode("student")} />}
          </div>
        </div>

        {/* Photo grid — hidden on mobile, visible md+ */}
        <div className="hidden sm:block">
          <PhotoHeader />
        </div>

      </div>
    </div>
  );
}

export default SignIn;
