-- Run this in Supabase SQL Editor after the original profiles table exists.
-- It adds expiring premium access and one-time free trial tracking.

alter table public.profiles
  add column if not exists premium_until timestamptz,
  add column if not exists trial_claimed boolean default false not null;

-- Use this after you manually verify payment on Instagram.
-- Replace the email with the buyer's account email.
update public.profiles as p
set
  premium_until = now() + interval '30 days',
  is_premium = false
from auth.users as u
where p.id = u.id
  and u.email = 'buyer@example.com';

-- Optional: make someone lifetime premium instead of 30 days.
-- update public.profiles as p
-- set is_premium = true
-- from auth.users as u
-- where p.id = u.id
--   and u.email = 'buyer@example.com';

-- Optional test reset: remove premium and allow the free trial popup again.
-- update public.profiles as p
-- set
--   is_premium = false,
--   premium_until = null,
--   trial_claimed = false
-- from auth.users as u
-- where p.id = u.id
--   and u.email = 'buyer@example.com';
