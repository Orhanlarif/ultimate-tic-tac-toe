"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

type AdminUserRow = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  bannedAt: string | null;
  createdAt: string;
  rating: number | null;
  league: string | null;
  wins: number;
  losses: number;
  draws: number;
};

export function AdminUsersList() {
  const t = useTranslations("admin");
  const leagueT = useTranslations("league");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (query) params.set("q", query);
      const res = await fetch(`/api/admin/users?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setUsers(data.users ?? []);
      setTotalPages(data.totalPages ?? 1);
    } catch {
      setFailed(true);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [page, query]);

  useEffect(() => {
    void load();
  }, [load]);

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setQuery(q.trim());
  }

  return (
    <div className="page-stack admin-page">
      <div>
        <h1 className="page-title">{t("title")}</h1>
        <p className="page-subtitle">{t("subtitle")}</p>
      </div>

      <form className="admin-search card" onSubmit={onSearch}>
        <input
          className="input"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("search")}
        />
        <button className="btn btn-primary admin-search-btn" type="submit">
          {t("search")}
        </button>
      </form>

      <div className="card admin-table-card">
        {loading ? (
          <div className="empty-state">
            <div className="spinner" />
          </div>
        ) : failed ? (
          <div className="empty-state">{t("loadError")}</div>
        ) : users.length === 0 ? (
          <div className="empty-state">{t("empty")}</div>
        ) : (
          <>
            <div className="admin-table-scroll admin-desktop-only">
              <table className="data-table leaderboard-table">
                <thead>
                  <tr>
                    <th>{t("username")}</th>
                    <th>{t("displayName")}</th>
                    <th>{t("email")}</th>
                    <th className="col-num">{t("rating")}</th>
                    <th className="col-league">{t("league")}</th>
                    <th>{t("status")}</th>
                    <th>{t("created")}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <Link href={`/admin/users/${u.id}`}>
                          <strong>@{u.username}</strong>
                        </Link>
                      </td>
                      <td>{u.displayName}</td>
                      <td className="muted admin-col-email">{u.email ?? "—"}</td>
                      <td className="col-num col-rating">
                        {u.rating != null ? u.rating : "—"}
                      </td>
                      <td className="col-league">
                        {u.league ? leagueT(u.league as "bronze") : "—"}
                      </td>
                      <td>
                        {u.bannedAt ? (
                          <span className="badge badge-danger">{t("banned")}</span>
                        ) : (
                          <span className="badge">{t("active")}</span>
                        )}
                      </td>
                      <td className="muted">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="admin-user-cards admin-mobile-only">
              {users.map((u) => (
                <li key={u.id}>
                  <Link className="admin-user-card" href={`/admin/users/${u.id}`}>
                    <div className="admin-user-card-top">
                      <div className="admin-user-card-id">
                        <strong>{u.displayName}</strong>
                        <span className="muted">@{u.username}</span>
                      </div>
                      {u.bannedAt ? (
                        <span className="badge badge-danger">{t("banned")}</span>
                      ) : (
                        <span className="badge">{t("active")}</span>
                      )}
                    </div>
                    {u.email ? (
                      <span className="admin-user-card-email muted">{u.email}</span>
                    ) : null}
                    <div className="admin-user-card-meta">
                      <span>
                        {t("rating")}:{" "}
                        <strong>{u.rating != null ? u.rating : "—"}</strong>
                      </span>
                      <span>
                        {u.league ? leagueT(u.league as "bronze") : "—"}
                      </span>
                      <span className="muted">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {totalPages > 1 ? (
        <div className="admin-pager">
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            {t("prev")}
          </button>
          <span className="muted">
            {t("page", { page, total: totalPages })}
          </span>
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("next")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
