-- Verified provider prices for the three models the agent roles use today.
--
-- Source: https://ollama.com/pricing, read 2026-11-09. Cross-checked against
-- the ollama.com/library pages for each model and against two independent
-- price trackers, which publish the same figures.
--
-- Prices are per 1M tokens in USD; this table stores micros per 1K tokens, so
-- 1M-token input of $1.32 becomes 1320 micros per 1K.
--
-- Peak rates are used where a model has off-peak pricing, matching the
-- conservative choice already documented in RATE_CARD_DRAFT.md. Cached-input
-- rates are recorded in the rate card but not in this table, because the
-- credit envelopes assume uncached input.
--
--   deepseek-v4-pro   peak input $1.32  / cached $0.044  / output $3.96
--                     off-peak      $0.66  /        $0.022  /        $1.98
--   mimo-v2.6-pro                input $0.435 / cached $0.0036 / output $0.87
--   mimo-v2.6-flash              input $0.14  / cached $0.0028 / output $0.28
--
-- This records cost. It does not authorize live billing: the credit prices in
-- 0034 and the operation budgets in 0035 are unchanged.
--
-- Written as insert-then-update rather than ON CONFLICT so it applies whatever
-- uniqueness the ai_prices.model column happens to carry.

insert into public.ai_prices (model, input_micros_per_1k, output_micros_per_1k, source)
select v.model, v.input_micros, v.output_micros, v.source
from (
  values
    ('deepseek-v4-pro', 1320, 3960, 'https://ollama.com/pricing (peak rate, read 2026-11-09)'),
    ('mimo-v2.6-pro',    435,  870, 'https://ollama.com/pricing (read 2026-11-09)'),
    ('mimo-v2.6-flash',  140,  280, 'https://ollama.com/pricing (read 2026-11-09)')
) as v(model, input_micros, output_micros, source)
where not exists (
  select 1 from public.ai_prices p where p.model = v.model
);

update public.ai_prices p
   set input_micros_per_1k = v.input_micros,
       output_micros_per_1k = v.output_micros,
       source = v.source,
       updated_at = now()
  from (
    values
      ('deepseek-v4-pro', 1320, 3960, 'https://ollama.com/pricing (peak rate, read 2026-11-09)'),
      ('mimo-v2.6-pro',    435,  870, 'https://ollama.com/pricing (read 2026-11-09)'),
      ('mimo-v2.6-flash',  140,  280, 'https://ollama.com/pricing (read 2026-11-09)')
  ) as v(model, input_micros, output_micros, source)
 where p.model = v.model;
