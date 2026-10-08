-- Benchmark groups (kind = 'custom') are part of strategy, so managers can edit them too
-- (strategy.manage: OWNER, ADMIN, MANAGER). Region groups and adding profiles stay with
-- accounts.manage (OWNER, ADMIN). Matches the Manager role description ("strategy and benchmarks").

drop policy "account managers write account groups" on public.account_groups;
create policy "account managers write account groups"
  on public.account_groups for all to authenticated
  using (
    public.has_org_permission(organization_id, 'accounts.manage')
    or (kind = 'custom' and public.has_org_permission(organization_id, 'strategy.manage'))
  )
  with check (
    public.has_org_permission(organization_id, 'accounts.manage')
    or (kind = 'custom' and public.has_org_permission(organization_id, 'strategy.manage'))
  );

drop policy "account managers write account group membership" on public.account_group_members;
create policy "account managers write account group membership"
  on public.account_group_members for all to authenticated
  using (
    public.has_org_permission(organization_id, 'accounts.manage')
    or (
      public.has_org_permission(organization_id, 'strategy.manage')
      and exists (
        select 1 from public.account_groups g where g.id = group_id and g.kind = 'custom'
      )
    )
  )
  with check (
    public.has_org_permission(organization_id, 'accounts.manage')
    or (
      public.has_org_permission(organization_id, 'strategy.manage')
      and exists (
        select 1 from public.account_groups g where g.id = group_id and g.kind = 'custom'
      )
    )
  );
