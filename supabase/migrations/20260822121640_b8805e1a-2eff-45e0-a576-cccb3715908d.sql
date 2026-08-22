CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, phone)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'phone')
  ON CONFLICT (id) DO NOTHING;

  IF lower(NEW.email) = 'sashamoskalenko0@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'owner'::app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END; $function$;

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'owner'::app_role FROM auth.users u
WHERE lower(u.email) = 'sashamoskalenko0@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;