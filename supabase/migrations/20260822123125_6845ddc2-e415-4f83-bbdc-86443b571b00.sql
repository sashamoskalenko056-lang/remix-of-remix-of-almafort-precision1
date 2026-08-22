insert into public.user_roles (user_id, role)
select 'ef18d4ea-1541-4a68-89ab-61e4e5013a67'::uuid, 'owner'::public.app_role
on conflict (user_id, role) do nothing;