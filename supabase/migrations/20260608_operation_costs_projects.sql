-- Add credit operations for project creation and copying.
-- 10 credits per new project, 10 credits per copy.
insert into public.operation_costs (operation, credits, label)
values
  ('new_project',  10, 'Create new project'),
  ('copy_project', 10, 'Copy project')
on conflict (operation) do update
  set credits = excluded.credits,
      label   = excluded.label;
