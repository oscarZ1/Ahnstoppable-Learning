// src/components/classroom/discussion-board/Comment/Comment.jsx
import React, { useState } from "react";
import Reply from "./Reply";
import MakeReply from "./ReplyComponents/MakeReply";
import ReplyToggle from "./ReplyComponents/ReplyToggle";

function Comment({
  id,
  name = "Anonymous",
  date = "0:00 AM",
  text = "Sample Text",
  replies = [],
  onAddReply,
  showNames,
}) {
  const [showReplies, setShowReplies] = useState(false);

  return (
    <div data-testid="comment" className="py-6 border-b pl-2 border-slate-200 dark:border-slate-800 last:border-0 bg-white dark:bg-slate-900 transition-colors">
      <div className="flex flex-col gap-1">
        {/* Comment body */}
        <Reply name={name} date={date} text={text} />

        {/* Reply input + toggle */}
        <div className="border-slate-100 dark:border-slate-800 ml-2 mt-2">
          <MakeReply onSubmit={(replyText) => onAddReply(id, replyText)} />

          <ReplyToggle
            replies={replies}
            showReplies={showReplies}
            onToggle={() => setShowReplies((v) => !v)}
            showNames={showNames}
          />
        </div>
      </div>
    </div>
  );
}

export default Comment;