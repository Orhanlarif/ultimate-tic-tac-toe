"use client";

import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

const SIGN_IN_ERRORS = new Set(["invalidCredentials", "noDatabase"]);

function LoginInner() {
  const t = useTranslations("auth");
  const a = useTranslations("app");
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    if (result?.error) {
      setError(result.code ?? "invalidCredentials");
      setPending(false);
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="card login-card">
      <h1>{t("title")}</h1>
      <p className="muted">{t("subtitle")}</p>

      <form className="login-form" onSubmit={onSubmit} noValidate>
        {error ? (
          <p className="form-alert" role="alert">
            {t(`errors.${SIGN_IN_ERRORS.has(error) ? error : "unknown"}` as "errors.unknown")}
          </p>
        ) : null}

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
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </label>

        <button
          className="btn btn-primary btn-lg btn-block"
          type="submit"
          disabled={pending}
        >
          {pending ? t("signingIn") : t("signInAction")}
        </button>
      </form>

      <p className="muted login-switch">
        {t("noAccount")}{" "}
        <Link className="link" href={`/register?next=${encodeURIComponent(next)}`}>
          {t("registerLink")}
        </Link>
      </p>

      <hr className="divider" />
      <p className="muted" style={{ margin: 0, fontSize: "0.92rem" }}>
        {t("guestHint")}
      </p>
      <Link className="btn btn-ghost" href="/play?mode=casual">
        {a("continueGuest")}
      </Link>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="card login-card"><div className="spinner" /></div>}>
      <LoginInner />
    </Suspense>
  );
}
