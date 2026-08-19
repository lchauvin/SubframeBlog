"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { login, type LoginState } from "./actions";
import styles from "../admin.module.css";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.buttonPrimary} disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [state, formAction] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={formAction}>
      <input type="hidden" name="next" value={next} />

      {state.error ? (
        <div className={styles.error} role="alert">
          {state.error}
        </div>
      ) : null}

      <div className={styles.loginFields}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="username">
            Username
          </label>
          <input
            id="username"
            name="username"
            className={styles.input}
            autoComplete="username"
            autoFocus
            required
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            className={styles.input}
            autoComplete="current-password"
            required
          />
        </div>
      </div>

      <SubmitButton />
    </form>
  );
}
