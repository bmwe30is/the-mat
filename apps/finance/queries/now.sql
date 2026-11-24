-- params: none
-- Smoke test: proves the CLI can connect and that the session runs in UTC.
select now() as db_now, current_setting('TimeZone') as session_tz, current_database() as db;
