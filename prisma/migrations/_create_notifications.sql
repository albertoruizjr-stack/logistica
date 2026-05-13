-- ──────────────────────────────────────────────
-- Notificações in-app (sininho do header)
-- 2026-05-12
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  "userId"    TEXT NOT NULL,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  link        TEXT,
  metadata    TEXT,
  "readAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT notifications_user_fkey FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx  ON notifications ("userId", "readAt", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS notifications_createdAt_idx    ON notifications ("createdAt" DESC);
