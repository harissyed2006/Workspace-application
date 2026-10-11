-- Workspace — owners can't change each other
-- Run this whole file in Supabase: SQL Editor → New query → Run
--
-- Peers can't touch peers: an owner may promote people TO owner, and may
-- demote THEMSELVES (last-owner guard still applies), but can never demote,
-- deactivate, delete, or change the email of ANOTHER owner.

-- ---------- roles: extend the guard trigger ----------
create or replace function public.protect_last_owner()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner' or new.email <> old.email) then
    if (select count(*) from public.roles where role = 'owner') <= 1 then
      raise exception 'Cannot remove the last owner';
    end if;
    if old.email <> public.current_board_email() then
      raise exception 'Owners cannot change another owner''s role';
    end if;
  end if;
  return coalesce(new, old);
end $$;

-- (trigger trg_protect_last_owner already exists and points at this function)

-- ---------- members: protect owner rows from other owners ----------
create or replace function public.protect_owner_member_rows()
returns trigger language plpgsql security definer set search_path = public
as $$
declare target_role text;
begin
  select role into target_role from public.roles where email = old.email;
  if target_role = 'owner' and old.email <> public.current_board_email() then
    if tg_op = 'DELETE' then
      raise exception 'Owners cannot remove another owner';
    elsif (new.active = false and old.active = true)
       or (new.email is distinct from old.email) then
      raise exception 'Owners cannot deactivate or change the email of another owner';
    end if;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_protect_owner_members on public.members;
create trigger trg_protect_owner_members
  before update or delete on public.members
  for each row execute function public.protect_owner_member_rows();
