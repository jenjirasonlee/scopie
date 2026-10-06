import type { Enums } from '@/lib/db/types';

export type OrgRole = Enums<'org_role'>;

export const ORG_ROLES = [
  'OWNER',
  'ADMIN',
  'MANAGER',
  'EDITOR',
  'VIEWER',
] as const satisfies readonly OrgRole[];

export type Permission =
  | 'org.update'
  | 'org.delete'
  | 'members.manage'
  | 'accounts.manage'
  | 'content.edit'
  | 'content.approve'
  | 'strategy.manage';

/**
 * Mirror of public.role_permissions (supabase/migrations/…_tenancy_and_roles.sql).
 * The database is authoritative and enforces these through Row Level Security;
 * this copy only decides what the UI shows. tests/integration asserts both match.
 */
export const ROLE_PERMISSIONS: Record<OrgRole, readonly Permission[]> = {
  OWNER: [
    'org.update',
    'org.delete',
    'members.manage',
    'accounts.manage',
    'content.edit',
    'content.approve',
    'strategy.manage',
  ],
  ADMIN: [
    'org.update',
    'members.manage',
    'accounts.manage',
    'content.edit',
    'content.approve',
    'strategy.manage',
  ],
  MANAGER: ['content.edit', 'content.approve', 'strategy.manage'],
  EDITOR: ['content.edit'],
  VIEWER: [],
};

export function can(role: OrgRole | null | undefined, permission: Permission): boolean {
  return role ? ROLE_PERMISSIONS[role].includes(permission) : false;
}

export const ROLE_LABELS: Record<OrgRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  EDITOR: 'Editor',
  VIEWER: 'Viewer',
};

export const ROLE_DESCRIPTIONS: Record<OrgRole, string> = {
  OWNER: 'Full control, including deleting the organization and managing owners.',
  ADMIN: 'Manages members, social accounts and organization settings.',
  MANAGER: 'Reviews and approves content, manages strategy and benchmarks.',
  EDITOR: 'Creates and edits content.',
  VIEWER: 'Read-only access to analytics, content and reports.',
};

/** Roles a member with `actorRole` may assign. Only owners can grant ownership. */
export function assignableRoles(actorRole: OrgRole): OrgRole[] {
  if (!can(actorRole, 'members.manage')) return [];
  return actorRole === 'OWNER' ? [...ORG_ROLES] : ORG_ROLES.filter((role) => role !== 'OWNER');
}
