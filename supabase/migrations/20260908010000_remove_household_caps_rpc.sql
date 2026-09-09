-- 20260908010000_remove_household_caps_rpc.sql
--
-- Story 7.1.G1 — corrects Story 7.1's scope: member_cap/budget_cap are a
-- platform-owner setting, not a tenant/Parent one (confirmed directly with
-- Joseph 2026-09-08). The CHECK constraints from Story 7.1
-- (household_member_cap_range, household_budget_cap_range) stay in place --
-- unrelated to who initiates a write, still a useful guard rail for a direct
-- Studio/service-role edit. Only the client-callable write path is removed.

drop function if exists rpc_update_household_caps(int, int);
