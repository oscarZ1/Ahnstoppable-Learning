// src/context/AuthContext.jsx
// Provides { user, token, login, studentLogin, setupStudentPassword, register, logout }.
// Drop this into your component tree above your Router.

import React, { createContext, useContext, useState, useCallback } from 'react';
import api from '../api/axios';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,  setUser]  = useState(() => {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  });
  const [token, setToken] = useState(() => localStorage.getItem('token'));

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