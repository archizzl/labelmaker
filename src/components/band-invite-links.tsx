import { ActionForm, CopyButton, SaveWhenChanged, SubmitButton } from "@/components/client";
import { resetBandsLinkForm, resetInviteLinkForm, setLoginIdentity } from "@/server/band-invite-actions";
import { bandsInviteLink, standingInviteLink } from "@/server/band-invite-links";

const base = () => process.env.BETTER_AUTH_URL ?? "";

/**
 * A band account's standing invite link (or a group's, for admins or one of its member types), the
 * same every time: copy it to send. Reset makes just this one stop working. `bandId` when the label
 * manages it for one of its bands.
 */
export async function StandingInviteLink({
  bandOrgId,
  createdBy = null,
  bandId,
  memberTypeId = null,
  admin = false,
}: {
  bandOrgId: string;
  createdBy?: string | null;
  bandId?: number;
  /** A group's link for one of its member types. */
  memberTypeId?: number | null;
  /** A group's link for admins. */
  admin?: boolean;
}) {
  const id = await standingInviteLink(bandOrgId, createdBy, { memberTypeId, admin });
  // Which link to reset, as a role choice (src/server/member-types.ts).
  const gives = admin ? "admin" : memberTypeId !== null ? `type:${memberTypeId}` : "member";
  return (
    <span className="flex flex-wrap items-center gap-2">
      <CopyButton text={`${base()}/join/${id}`} label="Copy invite link" />
      <ActionForm action={resetInviteLinkForm} keepOpen>
        {bandId !== undefined && <input type="hidden" name="bandId" value={bandId} />}
        <input type="hidden" name="gives" value={gives} />
        <SubmitButton variant="ghost" size="sm" confirm="Reset the invite link? The old one stops working; anyone who already joined stays.">
          Reset link
        </SubmitButton>
      </ActionForm>
    </span>
  );
}

/**
 * A group's invite links (its admins, under Who can sign in): one for admins, one for members who
 * see their own earnings, and one for each member type.
 */
export async function InviteLinks({ orgId, createdBy, types }: { orgId: string; createdBy: string; types: { id: number; name: string }[] }) {
  const rows = [
    { key: "admin", label: "Admin", link: <StandingInviteLink bandOrgId={orgId} createdBy={createdBy} admin /> },
    { key: "member", label: "Member: their own earnings", link: <StandingInviteLink bandOrgId={orgId} createdBy={createdBy} /> },
    ...types.map((t) => ({ key: `type:${t.id}`, label: t.name, link: <StandingInviteLink bandOrgId={orgId} createdBy={createdBy} memberTypeId={t.id} /> })),
  ];
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">Invite links</h3>
      <ul className="divide-y divide-border border-y border-border">
        {rows.map((r) => (
          <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span>{r.label}</span>
            {r.link}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A label's standing invite link for bands: whoever runs a band's group opens it, and the band
 * joins the label. Reset makes the old one stop working.
 */
export async function BandsInviteLink({ labelOrgId, createdBy }: { labelOrgId: string; createdBy: string }) {
  const id = await bandsInviteLink(labelOrgId, createdBy);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <CopyButton text={`${base()}/join/${id}`} label="Copy invite link for bands" />
      <ActionForm action={resetBandsLinkForm} keepOpen>
        <SubmitButton variant="ghost" size="sm" confirm="Reset the invite link for bands? The old one stops working; bands that joined stay.">
          Reset link
        </SubmitButton>
      </ActionForm>
    </span>
  );
}

/**
 * Who one of a band account's logins signs in as: the band itself, or one of its members (those
 * without another login there). Save shows once it's changed.
 */
export function LoginIdentity({
  userId,
  current,
  bandName,
  members,
  takenByOthers,
  bandId,
}: {
  userId: string;
  /** The member it signs in as, or null for the band itself. */
  current: number | null;
  bandName: string;
  members: { id: number; name: string }[];
  /** Members who have another login here. */
  takenByOthers: Set<number>;
  bandId?: number;
}) {
  return (
    <ActionForm action={setLoginIdentity} keepOpen className="flex flex-wrap items-center gap-2 text-sm">
      {bandId !== undefined && <input type="hidden" name="bandId" value={bandId} />}
      <input type="hidden" name="userId" value={userId} />
      <label>
        <select name="as" defaultValue={current ?? "band"} aria-label="Signs in as" className="!w-auto !py-0.5 text-sm">
          <option value="band">{bandName} (the whole band)</option>
          {members
            .filter((m) => m.id === current || !takenByOthers.has(m.id))
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </select>
      </label>
      <SaveWhenChanged>
        <SubmitButton size="sm">Save</SubmitButton>
      </SaveWhenChanged>
    </ActionForm>
  );
}
