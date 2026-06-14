-- Safe pg_cron cleanup update.
-- Skips this migration when pg_cron is not installed.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'cron') THEN
    PERFORM cron.unschedule('cleanup-plan-uploads-temp');

    PERFORM cron.schedule(
      'cleanup-plan-uploads-temp',
      '0 3 * * *',
      'DELETE FROM public.plan_uploads
       WHERE is_temporary = true
       AND created_at < now() - interval ''7 days'''
    );
  END IF;
END;
$$;
