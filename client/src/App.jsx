import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Header from "./components/ui/Header";

import SignIn from "./pages/SignIn";
import HomeDashboard from "./pages/HomeDashboard";
import ClassDashboard from "./pages/ClassDashboard";
import ClassResults from "./pages/ClassResults";
import Register from "./pages/Register";

function PrivateRoute({ children }) {
  const { user, token } = useAuth();
  return user && token ? children : <Navigate to="/" replace />;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        {/* The header sits above every page, signed in or not. Pages fill the
            remaining height (flex-1) instead of setting min-h-screen themselves. */}
        <div className="min-h-screen flex flex-col background">
        <Header />
        <Routes>
          <Route path="/"               element={<SignIn />} />
          <Route path="/register"       element={<Register />} />
          <Route path="/home"           element={<PrivateRoute><HomeDashboard /></PrivateRoute>} />
          {/* classId comes from the URL — ClassDashboard reads it via useParams() */}
          <Route path="/class/:classId" element={<PrivateRoute><ClassDashboard /></PrivateRoute>} />
          <Route path="/class/:classId/results" element={<PrivateRoute><ClassResults /></PrivateRoute>} />
          <Route path="*"               element={<Navigate to="/" replace />} />
        </Routes>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}
 

export default App;