import Link from "next/link";
import { redirect } from "next/navigation";
import { safePath } from "@/lib/safe-path";
import { SignUpForm } from "@/components/auth-forms";
import { getSession } from "@/server/context";
import { usableInvite } from "@/server/signup-invites";

export const metadata = { title: "sign up" };

/**
 * Creating a login. Anyone can, then set up a label or band group on /welcome. A site admin's invite
 * link (/signup?code=…) can be for one email only, and ?email=… fills the email in.
 */
export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const q = await searchParams;
  const next = safePath(typeof q.next === "string" ? q.next : null, "/welcome");
  if (await getSession()) redirect(next);
  const code = typeof q.code === "string" ? q.code : null;
  const invite = code ? await usableInvite(code) : null;
  const email = invite?.email ?? (typeof q.email === "string" ? q.email : undefined);
  const signIn = `/login${next !== "/welcome" ? `?next=${encodeURIComponent(next)}` : ""}`;

  if (code && !invite) {
    return (
      <>
        <h1 className="mb-2 text-xl font-bold">This invite doesn’t work</h1>
        <p className="mb-5 text-sm text-muted">
          This invite link has been used, revoked or has expired. Ask whoever sent it for a new one, or{" "}
          <Link href="/signup">sign up without it</Link>.
        </p>
        <p className="text-sm text-muted">
          Already have an account? <Link href={signIn}>Sign in</Link>
        </p>
      </>
    );
  }
  return (
    <>
      <h1 className="mb-5 text-xl font-bold">Create an account</h1>
      <SignUpForm
        next={next}
        email={email}
        name={typeof q.name === "string" ? q.name.slice(0, 120) : undefined}
        code={invite ? code! : undefined} emailLocked={!!invite?.email || (!invite && !!email)} />
      <p className="mt-5 text-sm text-muted">
        Already have one? <Link href={signIn}>Sign in</Link>
      </p>
    </>
  );
}
