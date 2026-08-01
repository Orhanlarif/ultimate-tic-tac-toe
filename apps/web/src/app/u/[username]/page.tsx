"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PlayerAvatar } from "@/components/Marks";

export default function ProfilePage() {
  const t = useTranslations("profile");
  const leagueT = useTranslations("league");
  const params = useParams<{ username: string }>();
  const [data, setData] = useState<{
    user: { displayName: string; username: string };
    rating: {
      rating: number;
      league: string;
      wins: number;
      losses: number;
      draws: number;
      placementGames: number;
    } | null;
    matches: Array<{
      id: string;
      mode: string;
      result: string | null;
      youWere: string;
      endedAt: string | null;
      moveCount: number;
    }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/profile/${params.username}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then(setData)
      .catch(() => setError(t("notFound")));
  }, [params.username, t]);

  if (error) {
    return (
      <div className="card setup-card">
        <h1 className="page-title">{t("title")}</h1>
        <p className="muted">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card queue-card">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="page-stack">
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <PlayerAvatar name={data.user.displayName} size="lg" />
        <div>
          <h1 className="page-title">{data.user.displayName}</h1>
          <p className="page-subtitle">@{data.user.username}</p>
        </div>
      </div>

      {data.rating && (
        <div className="card stat-grid">
          <div className="stat-item">
            <div className="muted">{t("rating")}</div>
            <strong>{data.rating.rating}</strong>
          </div>
          <div className="stat-item">
            <div className="muted">{t("league")}</div>
            <strong>{leagueT(data.rating.league as "bronze")}</strong>
          </div>
          <div className="stat-item">
            <div className="muted">{t("wins")}</div>
            <strong>{data.rating.wins}</strong>
          </div>
          <div className="stat-item">
            <div className="muted">{t("losses")}</div>
            <strong>{data.rating.losses}</strong>
          </div>
          <div className="stat-item">
            <div className="muted">{t("draws")}</div>
            <strong>{data.rating.draws}</strong>
          </div>
          <div className="stat-item">
            <div className="muted">{t("placement")}</div>
            <strong>
              {data.rating.placementGames}
              {t("of")}5
            </strong>
          </div>
        </div>
      )}

      <section className="card" style={{ display: "grid", gap: "0.85rem" }}>
        <h3 style={{ margin: 0 }}>{t("matches")}</h3>
        {data.matches.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            {t("noMatches")}
          </p>
        ) : (
          <ul className="list-stack">
            {data.matches.map((m) => (
              <li key={m.id} className="list-row">
                <span>
                  <span className="badge" style={{ marginRight: "0.5rem" }}>
                    {m.mode}
                  </span>
                  {m.youWere} · {m.result ?? "-"} · {m.moveCount} moves
                </span>
                <span className="muted">
                  {m.endedAt ? new Date(m.endedAt).toLocaleString() : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
