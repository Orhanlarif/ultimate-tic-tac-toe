"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useState } from "react";

interface Entry {
  rank: number;
  username: string;
  displayName: string;
  rating: number;
  league: string;
  wins: number;
  losses: number;
  draws: number;
}

export default function LeaderboardPage() {
  const t = useTranslations("leaderboard");
  const leagueT = useTranslations("league");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [seasonName, setSeasonName] = useState<string | null>(null);
  const [memoryOnly, setMemoryOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/leaderboard");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setEntries(data.entries ?? []);
        setSeasonName(data.season?.name ?? null);
        setMemoryOnly(Boolean(data.memoryOnly));
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page-stack">
      <div>
        <h1 className="page-title">
          {t("title")}
          {seasonName ? ` · ${seasonName}` : ""}
        </h1>
        {memoryOnly && <p className="page-subtitle">{t("memoryOnly")}</p>}
      </div>

      <div className="card" style={{ overflowX: "auto", padding: 0 }}>
        {loading ? (
          <div className="empty-state">
            <div className="spinner" />
          </div>
        ) : failed ? (
          <div className="empty-state">{t("loadError")}</div>
        ) : entries.length === 0 ? (
          <div className="empty-state">{t("empty")}</div>
        ) : (
          <table className="data-table leaderboard-table">
            <thead>
              <tr>
                <th>{t("rank")}</th>
                <th>{t("player")}</th>
                <th className="col-num">{t("rating")}</th>
                <th className="col-league">{t("league")}</th>
                <th className="col-num">{t("record")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.username}>
                  <td>
                    <span className={e.rank <= 3 ? "badge badge-warn" : "badge"}>
                      #{e.rank}
                    </span>
                  </td>
                  <td>
                    <Link href={`/u/${e.username}`}>
                      <strong>{e.displayName}</strong>
                    </Link>
                    <span className="cell-sub">{leagueT(e.league as "bronze")}</span>
                  </td>
                  <td className="col-num col-rating">{e.rating}</td>
                  <td className="col-league">{leagueT(e.league as "bronze")}</td>
                  <td className="col-num">
                    {e.wins}/{e.losses}/{e.draws}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
