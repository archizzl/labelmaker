import Link from "next/link";
import { signOut } from "@/server/account-actions";
import { redirect } from "next/navigation";
import { CreateAccountForm } from "@/components/auth-forms";
import { DeleteLogin } from "@/components/delete-login";
import { accountsFor, getSession } from "@/server/context";

export const metadata = { title: "welcome" };

/** After signing up: set up a label or band account, or open an invite into someone else's. */
export default async function WelcomePage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/welcome");
  const { user } = session;
  // (Invites aren't listed here by email: nobody's email is checked, so anyone could sign up with
  // an invited person's. An invite is joined only through its link, which the admin sends them.)
  const accounts = await accountsFor(user.id);
  const first = user.name.split(" ")[0];

  return (
    <div className="wide">
      <h1 className="mb-1 text-xl font-bold">Welcome, {first}</h1>

      <p className="mb-5 text-sm text-muted">Set up your label or band.</p>
      <CreateAccountForm />

      <div className="mt-5 flex flex-wrap items-center gap-4 text-sm text-muted">
        {accounts.length > 0 && <Link href="/">Back to {accounts[0].name}</Link>}
        <form action={signOut} className="ml-auto">
          <span className="mr-1">Signed in as {user.email}.</span>
          <button type="submit" className="text-link hover:underline">
            Sign out
          </button>
        </form>
      </div>

      {/* In no account any more (all left or deleted): Account isn't reachable, so deleting the login is here. */}
      {accounts.length === 0 && (
        <details className="mt-5 border-t border-border pt-4 text-sm">
          <summary className="cursor-pointer text-muted">Delete my account</summary>
          <div className="mt-3">
            <DeleteLogin email={user.email} accounts={0} sole={[]} bare />
          </div>
        </details>
      )}
    </div>
  );
}
