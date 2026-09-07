-- DIP-6.2 — Pacing-Ratio Health Indicator (Green/Amber/Red)
-- Jira: STEW-26 | Epic: STEW-6
--
-- fn_pacing_band maps a pacing ratio (% of budget spent / % of period elapsed)
-- to a fixed colour band. Thresholds are constants: green <= 1.1, amber <= 1.3,
-- red otherwise; a null ratio (zero limit, zero elapsed time, or a not-yet-
-- started period) is 'pending' -- a neutral state, never a colour (AC1/AC2/AC5).
-- The per-Category and per-Budget pacing selects that call this live in the
-- dashboard clients (DIP item 6: "implementation's choice" whether client- or
-- query-side, so long as the formula/thresholds match exactly).

create function fn_pacing_band(p_ratio numeric) returns text
immutable language sql as $$
  select case
    when p_ratio is null then 'pending'
    when p_ratio <= 1.1 then 'green'
    when p_ratio <= 1.3 then 'amber'
    else 'red'
  end
$$;
