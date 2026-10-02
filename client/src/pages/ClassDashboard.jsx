// src/components/Dashboards/ClassDashboard.jsx
import React, { useState } from "react";
import { useParams } from "react-router-dom";

import UnderstandCheck from "../components/classroom/UnderstandCheck";
import ClassPolls from "../components/classroom/ClassPolls";
import ClassRoster from "../components/classroom/ClassRoster";
import TalentBoard from "../components/classroom/TalentBoard";
import Header from "../components/ui/Header";
import ViewLogs from "../components/classroom/ViewLogs";
import CreateDiscussion from "../components/classroom/CreateDiscussion";
import DiscussionFeed from "../components/classroom/discussion-board/DiscussionFeed";
import AnonymousToggle from "../components/classroom/AnonymousToggle";
import StudentQuestions from "../components/classroom/StudentQuestions";
import { useAuth } from "../context/AuthContext";
import { useClassRoom } from "../hooks/useClassRoom";

function ClassDashboard() {
  // classId comes from the route: <Route path="/class/:classId" element={<ClassDashboard />} />
  const { classId } = useParams();
  const { user }    = useAuth();
  const [showNames, setShowNames] = useState(user?.role === 'professor');

  // Connects the shared socket and joins this class's room; child components
  // (DiscussionFeed, UnderstandCheck, ClassPolls) only subscribe to events.
  useClassRoom(classId);

  const today = new Date().toLocaleDateString("en-CA");
  const [viewDate, setViewDate] = useState(today);

  function handleDate(event) {
    setViewDate(event.target.value);
  }

  return (
    <div className="min-h-screen background flex transition-colors duration-300">
      <main className="w-full">
        <Header rightContent={() => null} />

        <div className="mx-auto flex flex-col justify-center items-center gap-4 w-full px-4 sm:px-6 lg:w-10/12 lg:px-0 pb-8 bg-white dark:bg-slate-800">

          {/* Date navigator, with the professor's name toggle off to the side */}
          <div className="w-full flex flex-wrap items-center justify-between gap-2">
            <div className="overflow-x-auto">
              <ViewLogs date={viewDate} today={today} handleDate={handleDate} classId={classId} />
            </div>
            {user?.role === "professor" && (
              <div className="px-2 sm:px-3">
                <AnonymousToggle showNames={showNames} setShowNames={setShowNames} />
              </div>
            )}
          </div>

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
            <StudentQuestions classId={classId} date={viewDate} showNames={showNames} />
          </div>

          {/* Professor controls */}
          {user?.role === "professor" && (
            <div className="w-full sm:w-3/4 max-w-2xl">
              <CreateDiscussion classRoomId={classId} />
            </div>
          )}

          {/* Discussion feed */}
          <div className="w-full max-w-2xl">
            <DiscussionFeed
              date={viewDate}
              classRoomId={classId}
              showNames={showNames}
            />
          </div>

          {/* Talent board */}
          <div className="w-full sm:w-3/4 max-w-2xl">
            <TalentBoard classId={classId} />
          </div>

          {/* Roster (professor only) — students sign in by picking a name from it */}
          {user?.role === "professor" && (
            <div className="w-full sm:w-3/4 max-w-2xl">
              <ClassRoster classId={classId} />
            </div>
          )}

        </div>
      </main>
    </div>
  );
}

export default ClassDashboard;