/*
 * `npm run deploy`: migrate the live database, build for Cloudflare, and deploy.
 *
 * The live database's direct connection string comes from PRODUCTION_DATABASE_URL, in the shell or
 * in .deploy.local (not committed), and so do the site admins' emails (SITE_ADMIN_EMAILS, set on the
 * Worker as a secret if it hasn't got it). Not a .env file: the Cloudflare build bakes .env, .env.production,
 * .env.local and .env.production.local into the live app, so the deploy refuses if any of them exist.
 * Your local settings live in .env.development.local, which the build skips. See DEPLOY.md.
 *
 * Wrangler needs Node 22; if the shell has an older Node, the build and deploy use nvm's Node 22.
 * If the upload fails with "fetch failed" (a dropped connection), it's the network: run
 * `npx opennextjs-cloudflare deploy` (with Node 22) to retry just the upload.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { envWithNode22 } from "./node22.mjs";

for (const f of [".env", ".env.local", ".env.production", ".env.production.local"]) {
  if (existsSync(f)) {
    console.error(`Found ${f}: the Cloudflare build would bake it into the live app. Keep local settings in .env.development.local, and live ones in Cloudflare secrets.`);
    process.exit(1);
  }
}
const deployLocal = existsSync(".deploy.local") ? readFileSync(".deploy.local", "utf8") : "";
const setting = (name) => process.env[name] ?? deployLocal.match(new RegExp(`^${name}=(.+)$`, "m"))?.[1]?.trim();
const url = setting("PRODUCTION_DATABASE_URL");
if (!url) {
  console.error("Set PRODUCTION_DATABASE_URL (Neon's direct connection string) in .deploy.local. See DEPLOY.md.");
  process.exit(1);
}
const run = (cmd, env = {}) => execSync(cmd, { stdio: "inherit", env: envWithNode22(env) });
run("npx tsx scripts/migrate.mts", { DATABASE_URL: url });
run("npx opennextjs-cloudflare build");
run("npx opennextjs-cloudflare deploy");

// The site admins' emails are a secret, not in wrangler.jsonc (the repo is public): set from
// .deploy.local's SITE_ADMIN_EMAILS whenever the Worker doesn't have it yet.
const secrets = execSync("npx wrangler secret list --format json", { env: envWithNode22() }).toString();
if (!/"name":\s*"SITE_ADMIN_EMAILS"/.test(secrets)) {
  const admins = setting("SITE_ADMIN_EMAILS");
  if (admins) execSync("npx wrangler secret put SITE_ADMIN_EMAILS", { input: admins, stdio: ["pipe", "inherit", "inherit"], env: envWithNode22() });
  else console.error("✘ No site admins: add SITE_ADMIN_EMAILS=you@example.com to .deploy.local and deploy again.");
}
