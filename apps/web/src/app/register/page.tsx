"use client";

import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

const PASSWORD_MIN_LENGTH = 8;
const DISPLAY_NAME_MAX_LENGTH = 24;

const REGISTER_ERRORS = new Set([
  "noDatabase",
  "invalidEmail",
  "weakPassword",
  "longPassword",
  "invalidName",
  "emailTaken",
]);

function RegisterInner() {
  const t = useTranslations("auth");
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("passwordMismatch");
      return;
    }

    setPending(true);
    let res: Response;
    try {
      res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, displayName }),
      });
    } catch {
      setError("network");
      setPending(false);
      return;
    }

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "unknown");
      setPending(false);
      return;
    }

    const result = await signIn("credentials", { email, password, redirect: false });
    if (result?.error) {
      // The account exists, so send them to sign in manually rather than failing.
      router.replace(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    router.replace(next);
    router.refresh();
  }

  const errorKey =
    error && (REGISTER_ERRORS.has(error) || error === "passwordMismatch" || error === "network")
      ? error
      : "unknown";

  return (
    <div className="card login-card">
      <h1>{t("registerTitle")}</h1>
      <p className="muted">{t("registerSubtitle")}</p>

      <form className="login-form" onSubmit={onSubmit} noValidate>
        {error ? (
          <p className="form-alert" role="alert">
            {t(`errors.${errorKey}` as "errors.unknown")}
          </p>
        ) : null}

        <label className="form-field">
          <span>{t("displayName")}</span>
          <input
            className="input"
            type="text"
            name="displayName"
            autoComplete="nickname"
            required
            minLength={2}
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t("displayNamePlaceholder")}
          />
        </label>

        <label className="form-field">
          <span>{t("email")}</span>
          <input
            className="input"
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </label>

        <label className="form-field">
          <span>{t("password")}</span>
          <input
            className="input"
            type="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
          <span className="form-hint">{t("passwordHint", { min: PASSWORD_MIN_LENGTH })}</span>
        </label>

        <label className="form-field">
          <span>{t("confirmPassword")}</span>
          <input
            className="input"
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
          />
        </label>

        <button
          className="btn btn-primary btn-lg btn-block"
          type="submit"
          disabled={pending}
        >
          {pending ? t("registering") : t("registerAction")}
        </button>
      </form>

      <p className="muted login-switch">
        {t("haveAccount")}{" "}
        <Link className="link" href={`/login?next=${encodeURIComponent(next)}`}>
          {t("signInLink")}
        </Link>
      </p>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="card login-card"><div className="spinner" /></div>}>
      <RegisterInner />
    </Suspense>
  );
}
