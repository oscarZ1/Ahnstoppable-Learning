// src/components/classroom/discussion-board/DiscussionPost.jsx
import React, { useEffect, useState } from "react";
import api from "../../../api/axios";
import QuestionsInput from "./QuestionsInput";
import QuestionsList from "./QuestionsList";

// Fetched rows win on duplicates; anything that arrived over the socket while
// the fetch was in flight is kept rather than overwritten.
function unionById(fetched, existing) {
  const seen = new Set(fetched.map((x) => x.id));
  return [...fetched, ...existing.filter((x) => !seen.has(x.id))];
}

function DiscussionPost({ post, setPosts, showNames }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let ignore = false;
    api
      .get(`/api/posts/${post.id}/comments`)
      .then((res) => {
        if (ignore) return;
        setPosts((prev) =>
          prev.map((p) => {
            if (p.id !== post.id) return p;
            const existing = p.comments ?? [];
            const comments = unionById(res.data, existing).map((c) => {
              const prevC = existing.find((x) => x.id === c.id);
              return prevC
                ? { ...c, replies: unionById(c.replies ?? [], prevC.replies ?? []) }
                : c;
            });
            return { ...p, comments };
          })
        );
      })
      .catch((err) => console.error("Failed to load comments:", err));
    return () => { ignore = true; };
  }, [post.id, setPosts]);

  async function addComment(text) {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // The socket event 'comment:new' handles the state update.
      await api.post(`/api/posts/${post.id}/comments`, { content: text });
    } catch (err) {
      console.error("Failed to post comment:", err);
      setError(err.response?.data?.error ?? "Couldn't post your comment.");
    } finally {
      setSubmitting(false);
    }
  }

  async function addReply(commentId, text) {
    if (!text.trim()) return;
    setError(null);
    try {
      // Same pattern: socket event 'reply:new' handles the state update.
      await api.post(
        `/api/posts/${post.id}/comments/${commentId}/replies`,
        { content: text }
      );
    } catch (err) {
      console.error("Failed to post reply:", err);
      setError(err.response?.data?.error ?? "Couldn't post your reply.");
    }
  }

  return (
    <div className="w-full rounded-lg shadow-md p-4 sm:p-6 border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
      {/* Post header */}
      <div className="pb-2">
        <h1 className="std-text text-base sm:text-lg font-semibold leading-snug">
          {post.title}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {post.content}
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
          {post.author_name} ·{" "}
          {new Date(post.created_at).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
      </div>

      <hr className="border-slate-200 dark:border-slate-700 my-3 sm:my-4" />

      <QuestionsInput addItem={addComment} disabled={submitting} />
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      <QuestionsList
        items={post.comments ?? []}
        onAddReply={addReply}
        showNames={showNames}
      />
    </div>
  );
}

export default DiscussionPost;
