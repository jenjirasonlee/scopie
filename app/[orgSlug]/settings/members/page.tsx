import type { Metadata } from 'next';
import { MemberRoleForm } from '@/components/settings/member-role-form';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { assignableRoles, ORG_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/auth/permissions';
import { changeMemberRole } from '@/lib/members/actions';
import { listMembers } from '@/lib/members/queries';
import { getOrgContext } from '@/lib/orgs/queries';

export const metadata: Metadata = { title: 'Members & roles' };

export default async function MembersSettingsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const { org, role, user } = await getOrgContext(orgSlug);
  const members = await listMembers(org.id);
  const roles = assignableRoles(role);
  const action = changeMemberRole.bind(null, orgSlug);

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-base font-semibold">Members & roles</h2>
        <p className="text-muted-foreground text-[13px]">
          Inviting new members by email isn&apos;t built yet. Existing members&apos; roles can be
          changed by owners and admins; only owners can grant or remove the Owner role.
        </p>
      </div>

      <div className="bg-card overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead className="text-right">Role</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => {
              const editable = roles.length > 0 && (member.role !== 'OWNER' || role === 'OWNER');
              return (
                <TableRow key={member.userId}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {member.fullName ?? member.email}
                        {member.userId === user.id ? (
                          <span className="text-muted-foreground ml-1.5 text-xs">(you)</span>
                        ) : null}
                      </span>
                      <span className="text-muted-foreground text-xs">{member.email}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {editable ? (
                      <MemberRoleForm
                        action={action}
                        userId={member.userId}
                        role={member.role}
                        roles={roles}
                        label={member.fullName ?? member.email}
                      />
                    ) : (
                      <Badge variant="secondary">{ROLE_LABELS[member.role]}</Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">What each role can do</h3>
        <dl className="bg-card divide-y rounded-lg border text-[13px]">
          {ORG_ROLES.map((option) => (
            <div key={option} className="grid grid-cols-[110px_1fr] gap-3 px-4 py-2.5">
              <dt className="font-medium">{ROLE_LABELS[option]}</dt>
              <dd className="text-muted-foreground">{ROLE_DESCRIPTIONS[option]}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
