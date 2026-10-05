// src/components/Dashboards/ClassDashboard.jsx
import React, { useState } from "react";
import { Link, useParams } from "react-router-dom";

import UnderstandCheck from "../components/classroom/UnderstandCheck";
import ClassPolls from "../components/classroom/ClassPolls";
import ClassRoster from "../components/classroom/ClassRoster";
import TalentBoard from "../components/classroom/TalentBoard";
import ViewLogs from "../components/classroom/ViewLogs";
import CreateDiscussion from "../components/classroom/CreateDiscussion";
import DiscussionFeed from "../components/classroom/discussion-board/DiscussionFeed";
import AnonymousToggle from "../components/classroom/AnonymousToggle";
import StudentQuestions from "../components/classroom/StudentQuestions";
import { useAuth } from "../context/AuthContext";
import { ClassViewContext } from "../context/ClassViewContext";
import { useClassRoom } from "../hooks/useClassRoom";

function ClassDashboard() {
  // classId comes from the route: <Route path="/class/:classId" element={<ClassDashboard />} />
  const { classId } = useParams();
  const { user }    = useAuth();
  const [showNames, setShowNames] = useState(user?.role === 'professor');
  // "View as student": the page renders exactly as students see it.
  const [preview, setPreview] = useState(false);
  const isRealProfessor = user?.role === "professor";
  const isProfessorView = isRealProfessor && !preview;
  const namesVisible    = showNames && !preview;   // students see classmates as Anonymous

  // Connects the shared socket and joins this class's room; child components
  // (DiscussionFeed, UnderstandCheck, ClassPolls) only subscribe to events.
  useClassRoom(classId);

  const today = new Date().toLocaleDateString("en-CA");
  const [viewDate, setViewDate] = useState(today);
  // Professors can plan ahead (through the end of next year); students, and
  // professors previewing the student view, stop at today.
  const maxDate  = isProfessorView ? `${Number(today.slice(0, 4)) + 1}-12-31` : today;
  const isFuture = viewDate > today;

  function handleDate(event) {
    setViewDate(event.target.value);
  }

  function togglePreview() {
    // Students can't see future days, so the preview starts from today.
    if (!preview && viewDate > today) setViewDate(today);
    setPreview((v) => !v);
  }

  function longDay(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  }

  return (
    <ClassViewContext.Provider value={{ preview }}>
    <div className="flex-1 background flex transition-colors duration-300">
      <main className="w-full">

        <div className="mx-auto flex flex-col justify-center items-center gap-4 w-full px-4 sm:px-6 lg:w-10/12 lg:px-0 pb-8 bg-white dark:bg-slate-800">

          {/* Date navigator, with the professor's name toggle off to the side */}
          <div className="w-full flex flex-wrap items-center justify-between gap-2">
            <div className="overflow-x-auto">
              <ViewLogs date={viewDate} today={today} maxDate={maxDate} handleDate={handleDate} classId={classId} />
            </div>
            {isRealProfessor && (
              <div className="px-2 sm:px-3 flex flex-wrap items-center gap-2">
                {!preview && <AnonymousToggle showNames={showNames} setShowNames={setShowNames} />}
                {!preview && (
                  <Link
                    to={`/class/${classId}/results`}
                    className="white-btn text-xs py-2 border border-slate-200 dark:border-slate-700"
                  >
                    📋 Results
                  </Link>
                )}
                <button
                  type="button"
                  onClick={togglePreview}
                  aria-pressed={preview}
                  className={preview ? "blue-btn text-xs py-2" : "white-btn text-xs py-2 border border-slate-200 dark:border-slate-700"}
                >
                  {preview ? "Exit student view" : "👁 View as student"}
                </button>
              </div>
            )}
          </div>

          {preview && (
            <div role="status" className="w-full sm:w-3/4 max-w-2xl rounded-lg border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
              <span className="font-semibold">Viewing as a student.</span>{" "}
              This is what students see in this class. Votes, questions and comments are turned off while you preview.
            </div>
          )}

          {isProfessorView && isFuture && (
            <div role="status" className="w-full sm:w-3/4 max-w-2xl rounded-lg border border-blue-200 dark:border-blue-500/40 bg-blue-50 dark:bg-blue-500/10 px-4 py-3 text-sm text-blue-800 dark:text-blue-200">
              <span className="font-semibold">Planning {longDay(viewDate)}.</span>{" "}
              Students can't see this day until it arrives. Prepare polls, checks and discussions here, then start them in class.
            </div>
          )}

          {/* Understanding check — full width on mobile */}
          <div className="w-full sm:w-3/4 max-w-2xl">
            <UnderstandCheck classId={classId} date={viewDate} />
          </div>

          {/* Live poll */}
          <div className="w-full sm:w-3/4 max-w-2xl">
            <ClassPolls classId={classId} date={viewDate} />
          </div>

          {/* Student question box */}
          <div className="w-full sm:w-3/4 max-w-2xl">
            <StudentQuestions classId={classId} date={viewDate} showNames={namesVisible} />
          </div>

          {/* Professor controls */}
          {/* New discussions go on today or a planned future day, not past days */}
          {isProfessorView && viewDate >= today && (
            <div className="w-full sm:w-3/4 max-w-2xl">
              <CreateDiscussion key={viewDate} classRoomId={classId} date={viewDate} />
            </div>
          )}

          {/* Discussion feed */}
          <div className="w-full max-w-2xl">
            <DiscussionFeed
              date={viewDate}
              classRoomId={classId}
              showNames={namesVisible}
            />
          </div>

          {/* Talent board */}
          <div className="w-full sm:w-3/4 max-w-2xl">
            <TalentBoard classId={classId} />
          </div>

          {/* Roster (professor only) — students sign in by picking a name from it */}
          {isProfessorView && (
            <div className="w-full sm:w-3/4 max-w-2xl">
              <ClassRoster classId={classId} />
            </div>
          )}

        </div>
      </main>
    </div>
    </ClassViewContext.Provider>
  );
}

export default ClassDashboard;