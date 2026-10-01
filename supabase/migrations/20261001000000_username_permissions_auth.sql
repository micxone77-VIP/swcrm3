-- Add username-based auth fields to profiles
-- username: used for login instead of email (no email required)
-- permissions: JSONB array of allowed page keys for host role
-- must_change_password: forces password change on first login

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS username TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false;

-- Index for fast username lookup on login
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_idx ON profiles (lower(username));

-- Backfill existing users: derive username from email (part before @)
UPDATE profiles
SET username = lower(split_part(email, '@', 1))
WHERE username IS NULL AND email IS NOT NULL;

-- Admin users get all permissions by default (they bypass the check in code anyway)
-- but store an empty array — empty = admin bypass, populated = host restriction
UPDATE profiles
SET permissions = '[]'::jsonb
WHERE permissions IS NULL;
