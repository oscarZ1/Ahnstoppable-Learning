// src/routes/comments.js
// GET    /api/posts/:postId/comments                              – list comments (with replies)
// POST   /api/posts/:postId/comments                              – add a comment
// DELETE /api/posts/:postId/comments/:commentId                   – delete own comment
// POST   /api/posts/:postId/comments/:commentId/replies           – reply to a comment
// DELETE /api/posts/:postId/comments/:commentId/replies/:replyId  – delete own reply
//
// Every route requires membership in the post's class (requireClassMemberViaPost
// sets req.classId). Student-authored rows are masked for student requesters on
// both the REST response and the socket broadcast – see utils/anonymity.js.

import express from 'express';
import pool from '../db/pool.js';
import { requireAuth, requireClassMemberViaPost } from '../middleware/auth.js';
import { forRequester } from '../utils/anonymity.js';
import { emitToClass } from '../socket/emit.js';
import { discussionLimits } from '../middleware/rateLimit.js';

const router = express.Router({ mergeParams: true });

// ── List comments (with nested replies) ──────────────────────────────────────
router.get('/', requireAuth, requireClassMemberViaPost, async (req, res) => {
  const { postId } = req.params;
  try {
    const { rows: comments } = await pool.query(
      `SELECT c.id, c.post_id, c.content, c.created_at,
              u.id AS author_id, u.name AS author_name, u.role AS author_role
       FROM   comments c
       JOIN   users u ON u.id = c.author_id
       WHERE  c.post_id = $1
       ORDER  BY c.created_at ASC`,
      [postId]
    );

    const commentIds = comments.map(c => c.id);
    let replies = [];
    if (commentIds.length > 0) {
      const { rows } = await pool.query(
        `SELECT r.id, r.comment_id, r.content, r.created_at,
                u.id AS author_id, u.name AS author_name, u.role AS author_role
         FROM   replies r
         JOIN   users u ON u.id = r.author_id
         WHERE  r.comment_id = ANY($1::int[])
         ORDER  BY r.created_at ASC`,
        [commentIds]
      );
      replies = rows;
    }

    const replyMap = {};
    for (const r of replies) {
      (replyMap[r.comment_id] ??= []).push(r);
    }

    const result = comments.map(c => forRequester(req, {
      ...c,
      replies: replyMap[c.id] ?? [],
    }));

    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Add a comment ─────────────────────────────────────────────────────────────
router.post('/', requireAuth, requireClassMemberViaPost, ...discussionLimits, async (req, res) => {
  const { postId } = req.params;
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'content is required.' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO comments (post_id, author_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, post_id, content, created_at`,
      [postId, req.user.id, content.trim()]
    );

    const comment = {
      ...rows[0],
      author_id:   req.user.id,
      author_name: req.user.name ?? null,
      author_role: req.user.role,
      replies:     [],
    };

    emitToClass(req.app.get('io'), req.classId, 'comment:new', comment);

    // Award talent point for participating
    await pool.query(`UPDATE users SET talents = talents + 1 WHERE id = $1`, [req.user.id]);

    return res.status(201).json(forRequester(req, comment));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Delete a comment ──────────────────────────────────────────────────────────
router.delete('/:commentId', requireAuth, requireClassMemberViaPost, async (req, res) => {
  const { postId, commentId } = req.params;
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM comments WHERE id = $1 AND post_id = $2 AND author_id = $3`,
      [commentId, postId, req.user.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Comment not found.' });

    const io = req.app.get('io');
    io.to(`class:${req.classId}`).emit('comment:deleted', {
      commentId: Number(commentId),
      postId: Number(postId),
    });

    return res.json({ message: 'Comment deleted.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Add a reply ───────────────────────────────────────────────────────────────
router.post('/:commentId/replies', requireAuth, requireClassMemberViaPost, ...discussionLimits, async (req, res) => {
  const { postId, commentId } = req.params;
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'content is required.' });

  try {
    // Make sure the comment belongs to this post before inserting under it.
    const { rowCount: commentExists } = await pool.query(
      `SELECT 1 FROM comments WHERE id = $1 AND post_id = $2`,
      [commentId, postId]
    );
    if (commentExists === 0) return res.status(404).json({ error: 'Comment not found.' });

    const { rows } = await pool.query(
      `INSERT INTO replies (comment_id, author_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, comment_id, content, created_at`,
      [commentId, req.user.id, content.trim()]
    );

    const reply = {
      ...rows[0],
      author_id:   req.user.id,
      author_name: req.user.name ?? null,
      author_role: req.user.role,
    };

    emitToClass(req.app.get('io'), req.classId, 'reply:new', reply);

    await pool.query(`UPDATE users SET talents = talents + 1 WHERE id = $1`, [req.user.id]);

    return res.status(201).json(forRequester(req, reply));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Delete a reply ────────────────────────────────────────────────────────────
router.delete('/:commentId/replies/:replyId', requireAuth, requireClassMemberViaPost, async (req, res) => {
  const { commentId, replyId } = req.params;
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM replies WHERE id = $1 AND comment_id = $2 AND author_id = $3`,
      [replyId, commentId, req.user.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Reply not found.' });

    const io = req.app.get('io');
    io.to(`class:${req.classId}`).emit('reply:deleted', {
      replyId:   Number(replyId),
      commentId: Number(commentId),
    });

    return res.json({ message: 'Reply deleted.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

export default router;
