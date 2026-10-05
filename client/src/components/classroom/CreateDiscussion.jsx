// src/components/classroom/CreateDiscussion.jsx
// Professor-only: create a discussion post for the day being viewed — today, or
// a future day when planning ahead (students see it once that day arrives).
import React, { useState } from "react";
import CourseInputTemplate from "../ui/CourseInputTemplate";
import api from "../../api/axios";

function shortDay(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function CreateDiscussion({ classRoomId, date }) {
  const today    = new Date().toLocaleDateString("en-CA");
  const postDate = date ?? today;
  const isFuture = postDate > today;
  const [isOpen, setIsOpen]       = useState(false);
  const [title, setTitle]         = useState("");
  const [content, setContent]     = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]         = useState(null);

  function clearForm() {
    setIsOpen(false);
    setTitle("");
    setContent("");
    setError(null);
  }

  async function handleSubmit(event) {
    // Works with both <form action={fn}> and a plain button click
    if (event?.preventDefault) event.preventDefault();
    if (!title.trim() || !content.trim() || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      await api.post(`/api/classes/${classRoomId}/posts`, {
        title,
        content,
        // The day being viewed, as a local calendar date
        post_date: postDate,
      });
      // The socket event 'post:new' handled by useClassSocket updates the feed —
      // no manual state patch needed here.
      clearForm();
    } catch (err) {
      setError(err.response?.data?.error ?? "Failed to create post.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) {
    return (
      <div className="w-full p-6 flex items-center justify-center">
        <button
          type="button"
          className="blue-btn"
          onClick={() => setIsOpen(true)}
        >
          {isFuture ? `Plan a Discussion for ${shortDay(postDate)}` : "Start a New Discussion"}
        </button>
      </div>
    );
  }

  return (
    <div className="w-full p-6">
      <form
        className="p-6 bg-slate-600/50 rounded-sm w-full grid grid-cols-2 gap-4"
        onSubmit={handleSubmit}
      >
        <div className="col-span-2">
          <CourseInputTemplate
            label="Title"
            name="title"
            type="text"
            id="post-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Discussion topic"
          />
        </div>

        <div className="col-span-2">
          <label className="std-text text-sm mb-2 block" htmlFor="post-content">
            Description
          </label>
          <textarea
            id="post-content"
            name="content"
            rows={3}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Add more context for your students…"
            className="w-full std-text bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-4 py-3 rounded-md outline-blue-600 focus:ring-2 focus:ring-blue-500/20 resize-none"
          />
        </div>

        {error && (
          <p className="col-span-2 text-sm text-red-400">{error}</p>
        )}

        <div className="col-span-2 flex flex-row items-center justify-end gap-2">
          {!submitting && (!title.trim() || !content.trim()) && (
            <p className="mr-auto text-sm text-slate-300">
              Add a title and a description to post.
            </p>
          )}
          <button
            type="button"
            className="white-btn"
            onClick={clearForm}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="blue-btn"
            disabled={!title.trim() || !content.trim() || submitting}
          >
            {submitting ? "Posting…" : isFuture ? `Schedule for ${shortDay(postDate)}` : "Create Discussion"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default CreateDiscussion;