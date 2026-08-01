-- Expose avatar_url from find_user_by_handle.
--
-- The invite-link screen and the Friends tab's add-by-handle box both show
-- the target's avatar before a request is sent, but the lookup RPC only
-- returned id/display_name/public_uid -- so that avatar was always blank
-- until a friendship existed. avatar_url is populated from the OAuth
-- provider (see handle_new_user()) and is no more sensitive than the name
-- already exposed here.
drop function public.find_user_by_handle(text);

create function public.find_user_by_handle(handle text)
returns table (id uuid, display_name text, public_uid text, avatar_url text)
language sql
security definer
set search_path = public
as $$
  select id, display_name, public_uid, avatar_url
  from public.profiles
  where email = handle or public_uid = handle
  limit 1;
$$;

revoke all on function public.find_user_by_handle(text) from public;
grant execute on function public.find_user_by_handle(text) to authenticated;
