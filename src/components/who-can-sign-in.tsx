import { asc, eq } from "drizzle-orm";
import { Avatar } from "@/components/avatar";
import { SubmitButton } from "@/components/client";
import { Badge, Card } from "@/components/ui";
import { db, schema } from "@/db";
import { removeAccountMember } from "@/server/account-actions";
import type { Context } from "@/server/context";
import { listMemberTypes, memberTypeOf } from "@/server/member-types";
import { RolePicker } from "./role-picker";
import { LoginEditToggle, LoginIdentity } from "./band-invite-links";
import { bandMembers } from "@/server/band-member";
import { bandLoginNames, bandLoginPersons } from "@/server/band-invite-links";

const ROLE_LABEL: Record<string, string> = { owner: "owner", admin: "admin", member: "member" };

/**
 * Directory → Who can sign in (admins only): everyone with a login to this account and what they can
 * do.
 */
export async function WhoCanSignIn({ ctx }: { ctx: Context }) {
  // A label's sub-account for a band: everyone there is an admin of it (it's just the label's view).
  const managed = !!ctx.managedBy;
  const { orgId } = ctx;
  const [members, people, types, typeOf] = await Promise.all([
    db
      .select({ member: schema.member, user: schema.user })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
      .where(eq(schema.member.organizationId, orgId))
      .orderBy(asc(schema.user.name)),
    db.select().from(schema.people).where(eq(schema.people.orgId, orgId)).orderBy(asc(schema.people.name)),
    listMemberTypes(orgId),
    memberTypeOf(orgId),
  ]);
  const typeName = (id: number | undefined) => types.find((t) => t.id === id)?.name;
  // The role picker's value for someone: "admin", "member", or "type:<id>".
  const roleValue = (role: string, typeId: number | undefined) => (role === "member" ? (typeId && typeName(typeId) ? `type:${typeId}` : "member") : "admin");
  const roleOptions = (
    <>
      <option value="member">Member: their own earnings</option>
      {types.map((t) => (
        <option key={t.id} value={`type:${t.id}`}>
          {t.name}
        </option>
      ))}
      <option value="admin">Admin: manages everything</option>
    </>
  );
  const personOf = (userId: string) => people.find((p) => p.userId === userId);
  // A band account: its members in the label's books (for invite links), its open links, and which
  // member each personal login is (the rest are the band's shared login).
  const [loginNames, loginPersons, bandPeople] = ctx.managedBy
    ? await Promise.all([bandLoginNames(orgId), bandLoginPersons(orgId), bandMembers(ctx.managedBy.labelOrgId, ctx.managedBy.bandId)])
    : [new Map<string, string>(), new Map<string, number>(), []];

  return (
        <Card title={`Who can sign in to ${ctx.org.name}`}>
          {/* {managed ? (
            <p className="mb-4 text-sm text-muted">People who sign in to this account. They all see what the label has for the band.</p>
          ) : (
            <p className="mb-4 text-sm text-muted">
              People who sign in to this account. Admins manage everything. Members see their own earnings and payouts, plus their band’s sales
              totals, and whatever their <Link href="#member-types">member type</Link> (below) allows.
              {ctx.org.kind === "label" && (
                <>
                  {" "}
                  Band members usually sign in to their band’s own account instead: invite them from the band’s page, under People.
                </>
              )}
            </p>
          )} */}
          <div className="overflow-x-auto">
            <table className="data mb-6">
              <thead>
                <tr>
                  <th>Person</th>
                  {/* A band account's logins are all the band's: no payee or role to show. */}
                  {!managed && <th>Paid as</th>}
                  {!managed && <th>Role</th>}
                  <th />
                </tr>
              </thead>
              <tbody>
                {members.map(({ member, user }) => {
                  const self = user.id === ctx.user.id;
                  return (
                    <tr key={member.id} className="group">
                      <td>
                        <div className="flex items-center gap-2 font-medium">
                          <Avatar name={managed ? (loginNames.get(user.id) ?? ctx.org.name) : user.name} src={user.image} size={24} />
                          <span>
                            {managed ? (loginNames.get(user.id) ?? ctx.org.name) : user.name}{" "}
                            {self && <span className="text-xs font-normal text-muted">(you)</span>}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="text-xs text-muted">{user.email}</span>
                          {/* A band account: who this login signs in as, shown with Edit. */}
                          {managed && !self && (
                            <span className="hidden group-has-[.login-edit:checked]:inline-flex">
                              <LoginIdentity
                                userId={user.id}
                                current={loginPersons.get(user.id) ?? null}
                                bandName={ctx.org.name}
                                members={bandPeople}
                                takenByOthers={new Set([...loginPersons].filter(([u]) => u !== user.id).map(([, p]) => p))}
                              />
                            </span>
                          )}
                        </div>
                      </td>
                      {!managed && <td className="text-sm">{personOf(user.id)?.name ?? <span className="text-muted">not linked</span>}</td>}
                      {!managed && (
                      <td>
                        {member.role === "owner" || self ? (
                          <Badge tone={member.role === "member" ? "neutral" : "accent"}>
                            {member.role === "member" ? (typeName(typeOf.get(user.id)) ?? "member") : (ROLE_LABEL[member.role] ?? member.role)}
                          </Badge>
                        ) : (
                          <RolePicker memberId={member.id} name={user.name} saved={roleValue(member.role, typeOf.get(user.id))} options={roleOptions} />
                        )}
                      </td>
                      )}
                      <td className="text-right">
                        <div className="flex justify-end gap-1">
                          {member.role !== "owner" && !self && (
                            <form action={removeAccountMember}>
                              <input type="hidden" name="memberId" value={member.id} />
                              <SubmitButton variant="ghost" size="sm" confirm={`Remove ${user.name}'s access? Their payout history stays.`}>
                                Remove
                              </SubmitButton>
                            </form>
                          )}
                          {managed && !self && <LoginEditToggle />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Invite links are per member type, under Member types below. */}
        </Card>
  );
}
