"use client";

import { useActionState } from "react";
import { CopyText } from "@/components/copy-text";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { connectBlueskyAction, makeKeyAction } from "../actions";

export function BlueskyForm() {
  const [state, formAction, pending] = useActionState(connectBlueskyAction, null);
  return (
    <form action={formAction} className="space-y-3">
      {state?.error && <Notice kind="error">{state.error}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Handle" htmlFor="bsky-handle">
          <Input id="bsky-handle" name="handle" size="sm" placeholder="yourname.bsky.social" autoComplete="off" required />
        </Field>
        <Field label="App password" htmlFor="bsky-password">
          <Input id="bsky-password" name="app_password" size="sm" placeholder="abcd-efgh-ijkl-mnop" autoComplete="off" required />
        </Field>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Connecting…" : "Connect Bluesky"}
      </Button>
    </form>
  );
}

export function KeyForm() {
  const [state, formAction, pending] = useActionState(makeKeyAction, null);
  if (state?.key) {
    return (
      <div>
        <Notice>{state.notice}</Notice>
        <CopyText text={state.key} />
      </div>
    );
  }
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <div className="min-w-56 flex-1">
        <Field label="What it's for" htmlFor="key-name">
          <Input id="key-name" name="name" size="sm" placeholder="Claude Code on my laptop" maxLength={120} />
        </Field>
      </div>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        Make a key
      </Button>
    </form>
  );
}
