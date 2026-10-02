// src/api/axios.js
// Pre-configured Axios instance.
// Automatically attaches the JWT from localStorage to every request.

import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
});

// ── Request interceptor: attach token ────────────────────────────────────────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor: handle 401 globally ────────────────────────────────
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // An expired or invalid session sends the user back to sign in. A failed
    // sign-in attempt (wrong password) also returns 401, but the sign-in form
    // must stay put so it can show the error.
    const isSignInAttempt = error.config?.url?.startsWith('/api/auth/');
    if (error.response?.status === 401 && !isSignInAttempt) {
      // Token expired or invalid – clear storage and redirect to sign-in
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/';
    }
    return Promise.reject(error);
  }
);

export default api;