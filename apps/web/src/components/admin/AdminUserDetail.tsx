"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { PlayerAvatar } from "@/components/Marks";

type UserDetail = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  bannedAt: string | null;
  banReason: string | null;
  createdAt: string;
};

type RatingDetail = {
  rating: number;
  league: string;
  wins: number;
  losses: number;
  draws: number;
  placementGames: number;
} | null;

type MatchRow = {
  id: string;
  mode: string;
  result: string | null;
  endReason: string | null;
  youWere: string;
  endedAt: string | null;
  moveCount: number;
};

const LEAGUE_OPTIONS = [
  "",
  "bronze",
  "silver",
  "gold",
  "platinum",
  "diamond",
  "master",
  "grandmaster",
] as const;

export function AdminUserDetail({ userId }: { userId: string }) {
  const t = useTranslations("admin");
  const leagueT = useTranslations("league");
  const router = useRouter();

  const [user, setUser] = useState<UserDetail | null>(null);
  const [rating, setRating] = useState<RatingDetail>(null);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [banReason, setBanReason] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [ratingInput, setRatingInput] = useState("");
  const [leagueInput, setLeagueInput] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/admin/users/${userId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setUser(data.user);
      setRating(data.rating);
      setMatches(data.matches ?? []);
      setRatingInput(data.rating ? String(data.rating.rating) : "300");
      setLeagueInput(data.rating?.league ?? "");
      setBanReason(data.user?.banReason ?? "");
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runAction(
    fn: () => Promise<Response>,
    okMessage?: string,
  ) {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fn();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          data.error === "Cannot moderate your own account" ||
            data.error === "Cannot delete your own account"
            ? t("selfBlocked")
            : t("error"),
        );
        return false;
      }
      if (okMessage) setMessage(okMessage);
      return true;
    } catch {
      setError(t("error"));
      return false;
    } finally {
      setPending(false);
    }
  }

  async function onBan() {
    if (!window.confirm(t("banConfirm"))) return;
    const ok = await runAction(
      () =>
        fetch(`/api/admin/users/${userId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "ban", reason: banReason }),
        }),
      t("saved"),
    );
    if (ok) void load();
  }

  async function onUnban() {
    const ok = await runAction(
      () =>
        fetch(`/api/admin/users/${userId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "unban" }),
        }),
      t("saved"),
    );
    if (ok) void load();
  }

  async function onResetPassword(e: React.FormEvent) {
    e.preventDefault();
    const ok = await runAction(
      () =>
        fetch(`/api/admin/users/${userId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "resetPassword",
            password: newPassword,
          }),
        }),
      t("saved"),
    );
    if (ok) setNewPassword("");
  }

  async function onSaveRating(e: React.FormEvent) {
    e.preventDefault();
    const ratingNum = Number(ratingInput);
    const body: { rating: number; league?: string } = {
      rating: ratingNum,
    };
    if (leagueInput) body.league = leagueInput;
    const ok = await runAction(
      () =>
        fetch(`/api/admin/users/${userId}/rating`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      t("saved"),
    );
    if (ok) void load();
  }

  async function onDelete() {
    if (!window.confirm(t("deleteConfirm"))) return;
    const ok = await runAction(
      () =>
        fetch(`/api/admin/users/${userId}`, {
          method: "DELETE",
        }),
      t("deleteDone"),
    );
    if (ok) {
      router.push("/admin");
      router.refresh();
    }
  }

  if (loading) {
    return (
      <div className="empty-state">
        <div className="spinner" />
      </div>
    );
  }

  if (failed || !user) {
    return <div className="empty-state">{t("loadError")}</div>;
  }

  return (
    <div className="page-stack admin-page">
      <div>
        <Link className="admin-back" href="/admin">
          ← {t("back")}
        </Link>
        <div className="admin-user-head">
          <PlayerAvatar name={user.displayName} size="lg" />
          <div className="admin-user-head-copy">
            <h1 className="page-title">{user.displayName}</h1>
            <p className="page-subtitle">@{user.username}</p>
            {user.email ? (
              <p className="admin-user-email muted">{user.email}</p>
            ) : null}
          </div>
        </div>
      </div>

      {message ? <p className="form-ok" role="status">{message}</p> : null}
      {error ? (
        <p className="form-alert" role="alert">
          {error}
        </p>
      ) : null}

      <div className="card stat-grid admin-stat-grid">
        <div className="stat-item">
          <div className="muted">{t("status")}</div>
          <div>
            {user.bannedAt ? (
              <span className="badge badge-danger">{t("banned")}</span>
            ) : (
              <span className="badge">{t("active")}</span>
            )}
          </div>
        </div>
        <div className="stat-item">
          <div className="muted">{t("rating")}</div>
          <strong>{rating?.rating ?? "—"}</strong>
        </div>
        <div className="stat-item">
          <div className="muted">{t("league")}</div>
          <strong>
            {rating?.league ? leagueT(rating.league as "bronze") : "—"}
          </strong>
        </div>
        <div className="stat-item">
          <div className="muted">{t("record")}</div>
          <strong>
            {rating
              ? `${rating.wins}/${rating.losses}/${rating.draws}`
              : "—"}
          </strong>
        </div>
        <div className="stat-item">
          <div className="muted">{t("created")}</div>
          <strong className="admin-stat-date">
            {new Date(user.createdAt).toLocaleDateString()}
          </strong>
        </div>
      </div>

      <div className="card admin-card">
        <h2>{user.bannedAt ? t("unban") : t("ban")}</h2>
        {!user.bannedAt ? (
          <>
            <label className="form-field">
              <span>{t("banReason")}</span>
              <input
                className="input"
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
              />
            </label>
            <button
              className="btn btn-primary admin-action-btn"
              type="button"
              disabled={pending}
              onClick={() => void onBan()}
            >
              {t("ban")}
            </button>
          </>
        ) : (
          <>
            {user.banReason ? (
              <p className="muted" style={{ margin: 0 }}>
                {user.banReason}
              </p>
            ) : null}
            <button
              className="btn btn-primary admin-action-btn"
              type="button"
              disabled={pending}
              onClick={() => void onUnban()}
            >
              {t("unban")}
            </button>
          </>
        )}
      </div>

      <div className="card admin-card">
        <h2>{t("resetPassword")}</h2>
        <form className="login-form" onSubmit={onResetPassword}>
          <label className="form-field">
            <span>{t("newPassword")}</span>
            <input
              className="input"
              type="password"
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </label>
          <button
            className="btn btn-primary admin-action-btn"
            type="submit"
            disabled={pending}
          >
            {t("savePassword")}
          </button>
        </form>
      </div>

      <div className="card admin-card">
        <h2>{t("editRating")}</h2>
        <form className="login-form" onSubmit={onSaveRating}>
          <div className="admin-form-grid">
            <label className="form-field">
              <span>{t("ratingValue")}</span>
              <input
                className="input"
                type="number"
                min={0}
                max={2000}
                step={1}
                value={ratingInput}
                onChange={(e) => setRatingInput(e.target.value)}
                required
              />
            </label>
            <label className="form-field">
              <span>{t("leagueValue")}</span>
              <select
                className="select"
                value={leagueInput}
                onChange={(e) => setLeagueInput(e.target.value)}
              >
                {LEAGUE_OPTIONS.map((opt) => (
                  <option key={opt || "auto"} value={opt}>
                    {opt ? leagueT(opt) : t("leagueAuto")}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            className="btn btn-primary admin-action-btn"
            type="submit"
            disabled={pending}
          >
            {t("saveRating")}
          </button>
        </form>
      </div>

      <div className="card admin-card">
        <h2>{t("delete")}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {t("deleteConfirm")}
        </p>
        <button
          className="btn btn-danger admin-action-btn"
          type="button"
          disabled={pending}
          onClick={() => void onDelete()}
        >
          {t("delete")}
        </button>
      </div>

      <div className="card admin-card">
        <h2>{t("matches")}</h2>
        {matches.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            {t("noMatches")}
          </p>
        ) : (
          <ul className="list-stack">
            {matches.map((m) => (
              <li key={m.id} className="list-row">
                <div className="admin-match-main">
                  <strong>
                    {m.mode} · {m.youWere} · {m.result ?? "—"}
                  </strong>
                  <span className="muted">
                    {m.endedAt
                      ? new Date(m.endedAt).toLocaleString()
                      : "—"}
                  </span>
                </div>
                <span className="muted">{m.moveCount} moves</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
