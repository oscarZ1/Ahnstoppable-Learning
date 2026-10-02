// src/components/homepage/CourseList.jsx
import React from "react";

function CourseList({ courses, onCourseClick, showStudents = false }) {
  if (courses.length === 0) {
    return (
      <p className="text-sm text-slate-400 text-center py-10">
        You're not in any classes yet. Professors can create one above; students are added by their professor.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {courses.map((course) => (
        <div
          key={course.id}
          className="group p-5 bg-olive-400/20 dark:bg-slate-800/40 hover:bg-olive-300/20 dark:hover:bg-slate-800/60 transition-all cursor-pointer"
          onClick={() => onCourseClick(course.id)}
        >
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-lg font-bold std-text group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                {course.title}
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                {course.prof}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="text-xs font-bold px-2 py-1 rounded bg-white dark:bg-slate-700 text-slate-400 border border-slate-200 dark:border-slate-600">
                {course.ref ?? "Active"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-semibold">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {course.hours}
            {showStudents && course.students != null && (
              <span className="ml-auto">
                {course.students} student{course.students === 1 ? "" : "s"} enrolled
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default CourseList;