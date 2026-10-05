// src/context/AuthContext.jsx
// Provides { user, token, login, studentLogin, setupStudentPassword, register, logout }.
// Drop this into your component tree above your Router.

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import api from '../api/axios';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,  setUser]  = useState(() => {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  });
  const [token, setToken] = useState(() => localStorage.getItem('token'));

  // Keep every tab on the same account. The sign-in lives in localStorage,
  // which all tabs share, and the API client sends whatever token is stored
  // there. Without this, signing in as someone else in another tab left this
  // tab showing the old person's screen while acting as the new account
  // (e.g. a student's vote sent with a professor's token: "Only students can
  // vote."). The 'storage' event only fires in the *other* tabs.
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => {
    function onStorage(event) {
      if (event.key !== 'token' && event.key !== 'user' && event.key !== null) return;
      const storedToken = localStorage.getItem('token');
      let storedUser = null;
      try { storedUser = JSON.parse(localStorage.getItem('user')); } catch { /* ignore */ }

      if (!storedToken) {
        // Signed out elsewhere (or the session expired there).
        if (userRef.current) window.location.assign('/');
        return;
      }
      if (storedUser && storedUser.id !== userRef.current?.id) {
        // A different account signed in elsewhere: reload as that account so
        // the screen, live connection and permissions all match it.
        window.location.assign('/home');
        return;
      }
      // Same person signed in again: just pick up the fresh token.
      setToken(storedToken);
      if (storedUser) setUser(storedUser);
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const startSession = useCallback((data) => {
    localStorage.setItem('token', data.token);
    localStorage.setItem('user',  JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  // Professors: email + password.
  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/api/auth/login', { email, password });
    return startSession(data);
  }, [startSession]);

  // Students: picked from their class roster.
  const studentLogin = useCallback(async (classId, userId, password) => {
    const { data } = await api.post('/api/auth/student-login', { class_id: classId, user_id: userId, password });
    return startSession(data);
  }, [startSession]);

  // Students signing in for the first time (or after a reset) create a password.
  const setupStudentPassword = useCallback(async (classId, userId, password) => {
    const { data } = await api.post('/api/auth/student-setup', { class_id: classId, user_id: userId, password });
    return startSession(data);
  }, [startSession]);

  // Professor registration (students are added by their professor).
  const register = useCallback(async (email, password, name, professorCode) => {
    const { data } = await api.post('/api/auth/register', {
      email, password, name, role: 'professor', professor_code: professorCode,
    });
    return startSession(data);
  }, [startSession]);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, login, studentLogin, setupStudentPassword, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}