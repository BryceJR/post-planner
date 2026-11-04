// Pages, actions and routes ask here whether the visitor is signed in.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, sessionValid } from "./session";

export async function signedIn(): Promise<boolean> {
  const jar = await cookies();
  return sessionValid(jar.get(SESSION_COOKIE)?.value);
}

// Every page and server action calls this first (proxy.ts also sends
// signed-out visitors to /login, but each check stands on its own).
export async function requireSignedIn(): Promise<void> {
  if (!(await signedIn())) redirect("/login");
}
