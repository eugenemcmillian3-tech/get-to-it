-- GET TO IT — $0.10 credit pricing
--
-- The retail decision: one credit is worth $0.10, sold in five prepaid packs.
-- There is no free plan, no trial credits and no subscription.
--
-- Existing purchases and ledger rows are deliberately NOT changed. A credit
-- pack change applies to new checkouts only, because each payment row copies
-- its credits and amount at the moment it is created. Production was audited
-- before this migration: zero purchases, zero paid payments and a zero ledger
-- balance, so no historical balance needs revaluation.

-- ---------------------------------------------------------------------------
-- 1. Pack catalogue
-- ---------------------------------------------------------------------------

insert into public.credit_packs
  (slug, credits, amount_cents, label, sort_order, active, updated_at)
values
  ('starter',  50,   500,  '50 credits',    1, true, now()),
  ('steady',  100,  1000, '100 credits',    2, true, now()),
  ('deep',    250,  2500, '250 credits',    3, true, now()),
  ('builder', 500,  5000, '500 credits',    4, true, now()),
  ('studio', 1000, 10000, '1,000 credits',  5, true, now())
on conflict (slug) do update set
  credits = excluded.credits,
  amount_cents = excluded.amount_cents,
  currency = 'usd',
  label = excluded.label,
  sort_order = excluded.sort_order,
  active = true,
  updated_at = now();

-- Retire any earlier placeholder pack that is not in the decision.
update public.credit_packs
   set active = false, updated_at = now()
 where slug not in ('starter', 'steady', 'deep', 'builder', 'studio');

-- The $0.10 retail value is a database invariant, not just copy in the UI.
alter table public.credit_packs
  drop constraint if exists credit_packs_retail_value;
alter table public.credit_packs
  add constraint credit_packs_retail_value
  check (amount_cents = credits * 10);

-- ---------------------------------------------------------------------------
-- 2. No free plan
-- ---------------------------------------------------------------------------
-- 0 means every AI request must be covered by prepaid credits. The existing
-- reservation function already treats a zero allowance correctly: it checks
-- the ledger and returns `needs-credits` when the balance is zero.

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
      from pg_constraint
     where conrelid = 'public.ai_limits'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%per_user_daily%'
  loop
    execute format(
      'alter table public.ai_limits drop constraint %I',
      constraint_name
    );
  end loop;
end $$;

alter table public.ai_limits
  alter column per_user_daily set default 0;

alter table public.ai_limits
  add constraint ai_limits_per_user_daily_check
  check (per_user_daily between 0 and 500);

update public.ai_limits
   set per_user_daily = 0,
       updated_at = now()
 where id = 1;

-- An account still starts with no credits. There is no signup grant, trial or
-- promotional path in this migration or anywhere in the application.
