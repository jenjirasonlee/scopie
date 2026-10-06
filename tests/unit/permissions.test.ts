import { describe, expect, it } from 'vitest';
import { assignableRoles, can, ORG_ROLES, ROLE_PERMISSIONS } from '@/lib/auth/permissions';

describe('role permissions', () => {
  it('gives each role at least the permissions of the roles below it', () => {
    for (let index = 0; index < ORG_ROLES.length - 1; index++) {
      const higher = new Set(ROLE_PERMISSIONS[ORG_ROLES[index]!]);
      const lower = ROLE_PERMISSIONS[ORG_ROLES[index + 1]!];
      for (const permission of lower) expect(higher.has(permission)).toBe(true);
    }
  });

  it('lets only owners and admins manage accounts and members', () => {
    expect(ORG_ROLES.filter((role) => can(role, 'accounts.manage'))).toEqual(['OWNER', 'ADMIN']);
    expect(ORG_ROLES.filter((role) => can(role, 'members.manage'))).toEqual(['OWNER', 'ADMIN']);
  });

  it('lets only owners delete the organization', () => {
    expect(ORG_ROLES.filter((role) => can(role, 'org.delete'))).toEqual(['OWNER']);
  });

  it('gives viewers no permissions and denies missing roles', () => {
    expect(ROLE_PERMISSIONS.VIEWER).toEqual([]);
    expect(can(null, 'content.edit')).toBe(false);
    expect(can(undefined, 'org.update')).toBe(false);
  });

  it('only lets owners assign the owner role', () => {
    expect(assignableRoles('OWNER')).toContain('OWNER');
    expect(assignableRoles('ADMIN')).not.toContain('OWNER');
    expect(assignableRoles('ADMIN')).toEqual(['ADMIN', 'MANAGER', 'EDITOR', 'VIEWER']);
    expect(assignableRoles('MANAGER')).toEqual([]);
    expect(assignableRoles('VIEWER')).toEqual([]);
  });
});
