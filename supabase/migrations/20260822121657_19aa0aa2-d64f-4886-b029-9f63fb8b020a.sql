REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.bump_company_ltv() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.recalc_company_tiers() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.link_asset_group(text, text, text, jsonb, text[]) FROM anon;