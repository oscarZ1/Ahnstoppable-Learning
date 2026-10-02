// src/pages/Register.jsx
// Professor registration. Students don't register; their professor adds
// them to a class roster and they sign in by picking their name.
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import PhotoHeader from "../components/ui/PhotoHeader";
import SiteTagline from "../components/ui/SiteTagline";

function Register() {
  const navigate        = useNavigate();
  const { register }    = useAuth();

  const [form, setForm] = useState({
    name:     "",
    email:    "",
    password: "",
    confirm:  "",
    professorCode: "",
  });
  const [isVisible, setVisible] = useState(false);
  const [error,     setError]   = useState(null);
  const [loading,   setLoading] = useState(false);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleRegister(event) {
    event.preventDefault();
    setError(null);
    if (!form.name || !form.email || !form.password) {
      setError("All fields are required.");
      return;
    }
    if (form.password !== form.confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (form.password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (!form.professorCode.trim()) {
      setError("A professor signup code is required.");
      return;
    }
    setLoading(true);
    try {
      await register(form.email, form.password, form.name, form.professorCode.trim());
      navigate("/home");
    } catch (err) {
      setError(err.response?.data?.error ?? "Registration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-gray-50 dark:bg-slate-950 min-h-screen">
      <SiteTagline />
      <div className="min-h-screen flex flex-row gap-6 items-center justify-center py-6 px-4 transition-colors duration-300">

        {/* Register card */}
        <div className="w-full max-w-md">
          <div className="p-6 sm:p-8 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 shadow-sm">
            <h1 className="std-text text-center text-2xl sm:text-3xl font-semibold">
              Professor registration
            </h1>

            <form className="mt-8 sm:mt-10 space-y-5" onSubmit={handleRegister}>

              {/* Full name */}
              <div>
                <label className="std-text text-sm mb-2 block">Full name</label>
                <div className="relative flex items-center">
                  <input
                    name="name"
                    type="text"
                    required
                    value={form.name}
                    onChange={handleChange}
                    className="w-full std-text bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-4 py-3 pr-10 rounded-md outline-blue-600 focus:ring-2 focus:ring-blue-500/20"
                    placeholder="Enter your full name"
                  />
                  <svg xmlns="http://www.w3.org/2000/svg" fill="#bbb" stroke="#bbb" className="w-4 h-4 absolute right-4" viewBox="0 0 24 24">
                    <circle cx="10" cy="7" r="6" />
                    <path d="M14 15H6a5 5 0 0 0-5 5 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 5 5 0 0 0-5-5zm8-4h-2.59l.3-.29a1 1 0 0 0-1.42-1.42l-2 2a1 1 0 0 0 0 1.42l2 2a1 1 0 0 0 1.42 0 1 1 0 0 0 0-1.42l-.3-.29H22a1 1 0 0 0 0-2z" />
                  </svg>
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="std-text text-sm mb-2 block">Email</label>
                <div className="relative flex items-center">
                  <input
                    name="email"
                    type="email"
                    required
                    value={form.email}
                    onChange={handleChange}
                    className="w-full std-text bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-4 py-3 pr-10 rounded-md outline-blue-600 focus:ring-2 focus:ring-blue-500/20"
                    placeholder="Enter your email"
                  />
                  <svg xmlns="http://www.w3.org/2000/svg" fill="#bbb" className="w-4 h-4 absolute right-4" viewBox="0 0 24 24">
                    <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/>
                  </svg>
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="std-text text-sm mb-2 block">Password</label>
                <div className="relative flex items-center">
                  <input
                    name="password"
                    type={isVisible ? "text" : "password"}
                    required
                    value={form.password}
                    onChange={handleChange}
                    className="w-full std-text bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-4 py-3 pr-10 rounded-md outline-blue-600 focus:ring-2 focus:ring-blue-500/20"
                    placeholder="Create a password"
                  />
                  <svg onClick={() => setVisible(v => !v)} xmlns="http://www.w3.org/2000/svg" fill="#bbb" stroke="#bbb" className="w-4 h-4 absolute right-4 cursor-pointer" viewBox="0 0 128 128">
                    <path d="M64 104C22.127 104 1.367 67.496.504 65.943a4 4 0 0 1 0-3.887C1.367 60.504 22.127 24 64 24s62.633 36.504 63.496 38.057a4 4 0 0 1 0 3.887C126.633 67.496 105.873 104 64 104zM8.707 63.994C13.465 71.205 32.146 96 64 96c31.955 0 50.553-24.775 55.293-31.994C114.535 56.795 95.854 32 64 32 32.045 32 13.447 56.775 8.707 63.994zM64 88c-13.234 0-24-10.766-24-24s10.766-24 24-24 24 10.766 24 24-10.766 24-24 24zm0-40c-8.822 0-16 7.178-16 16s7.178 16 16 16 16-7.178 16-16-7.178-16-16-16z" />
                  </svg>
                </div>
              </div>

              {/* Confirm password */}
              <div>
                <label className="std-text text-sm mb-2 block">Confirm password</label>
                <div className="relative flex items-center">
                  <input
                    name="confirm"
                    type={isVisible ? "text" : "password"}
                    required
                    value={form.confirm}
                    onChange={handleChange}
                    className="w-full std-text bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-4 py-3 pr-10 rounded-md outline-blue-600 focus:ring-2 focus:ring-blue-500/20"
                    placeholder="Re-enter your password"
                  />
                  {form.confirm && (
                    <span className="absolute right-4 text-sm">
                      {form.password === form.confirm ? "✅" : "❌"}
                    </span>
                  )}
                </div>
              </div>

              {/* Professor signup code */}
              <div>
                  <label className="std-text text-sm mb-2 block" htmlFor="professorCode">Professor signup code</label>
                  <input
                    id="professorCode"
                    name="professorCode"
                    type="text"
                    required
                    value={form.professorCode}
                    onChange={handleChange}
                    className="w-full std-text bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-4 py-3 rounded-md outline-blue-600 focus:ring-2 focus:ring-blue-500/20"
                    placeholder="Provided by your administrator"
                  />
              </div>

              {error && (
                <p className="text-sm text-red-500 text-center">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 text-sm font-semibold rounded-md text-white bg-blue-600 hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-60"
              >
                {loading ? "Creating account…" : "Create account"}
              </button>

              <p className="std-text text-sm text-center">
                Already have an account?{" "}
                <a href="/" className="text-blue-600 dark:text-blue-400 hover:underline ml-1 font-semibold">
                  Sign in
                </a>
              </p>
            </form>
          </div>
        </div>

        {/* Photo grid — hidden on mobile */}
        <div className="hidden sm:block">
          <PhotoHeader />
        </div>

      </div>
    </div>
  );
}

export default Register;