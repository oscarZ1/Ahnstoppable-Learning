// src/components/Dashboards/HomeDashboard/HomeDashboard.jsx
// Created on March 16, 2026
// Evan Inrig

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import { useAuth } from "../context/AuthContext";

import SectionHeading from "../components/ui/SectionHeading";
import CourseList from "../components/homepage/CourseList";
import CreateCourse from "../components/homepage/CreateCourse";

function HomeDashboard() {
  const { user }                      = useAuth();
  const navigate                      = useNavigate();
  const [courseList, setCourseList]   = useState([]);
  const [loadError, setLoadError]     = useState(null);
 
  // Load enrolled courses on mount
  useEffect(() => {
    api
      .get("/api/classes")
      .then((res) =>
        setCourseList(
          res.data.map((c) => ({
            id:    c.id,
            title: c.title,
            prof:  c.professor_name,
            hours: c.start_time && c.end_time
              ? `${c.start_time} – ${c.end_time}`
              : "Time TBD",
            ref:       c.section ?? "Active",
            join_code: c.join_code,
            students:  c.student_count,
          }))
        )
      )
      .catch((err) => setLoadError(err.message));
  }, []);
 
  async function createCourse(formData) {
    const title      = formData.get("coursename");
    const start_time = formData.get("coursestime") || null;
    const end_time   = formData.get("courseetime") || null;
    const section    = formData.get("section") || null;
 
    try {
      const { data } = await api.post("/api/classes", {
        title, section, start_time, end_time,
      });
      setCourseList((prev) => [
        {
          id:        data.id,
          title:     data.title,
          prof:      user?.name ?? "You",
          hours:     data.start_time && data.end_time
            ? `${data.start_time} – ${data.end_time}`
            : "Time TBD",
          ref:       data.section ?? "Active",
          join_code: data.join_code,
          students:  0,
        },
        ...prev,
      ]);
    } catch (err) {
      console.error("Failed to create course:", err.response?.data?.error);
    }
  }
 
  // Navigate to the class page using the real class id
  function handleCourseClick(courseId) {
    navigate(`/class/${courseId}`);
  }
 
  return (
    <div className="flex-1 background flex transition-colors duration-300">
      <main className="relative flex-1 pb-2">
 
        {user?.role === "professor" && (
          <CreateCourse submitCourse={createCourse} />
        )}

        <div className="p-4 sm:p-6 lg:p-8">
          <div className="flex flex-wrap gap-3 justify-between items-center mb-6">
            <SectionHeading text="Enrolled Courses" />
          </div>

          {loadError && (
            <p className="text-sm text-red-400 mb-4">
              Could not load courses: {loadError}
            </p>
          )}

          <CourseList
            courses={courseList}
            showStudents={user?.role === "professor"}
            onCourseClick={handleCourseClick}
          />
        </div>
      </main>
    </div>
  );
}

export default HomeDashboard;