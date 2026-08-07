"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useFriendChallengesContext } from "@/components/FriendChallengesProvider";
import { PlayerAvatar } from "@/components/Marks";

interface FriendItem {
  id: string;
  status: string;
  direction: "incoming" | "outgoing";
  user: { id: string; username: string; displayName: string };
}

const NOTICE_KEYS = {
  declined: "noticeDeclined",
  cancelled: "noticeCancelled",
  expired: "noticeExpired",
  offline: "noticeOffline",
  userOffline: "noticeUserOffline",
  userBusy: "noticeUserBusy",
  selfBusy: "noticeSelfBusy",
  failed: "noticeFailed",
} as const;

export default function FriendsPage() {
  const t = useTranslations("friends");
  const a = useTranslations("app");
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [pending, setPending] = useState<FriendItem[]>([]);
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  const {
    online,
    outgoing,
    notice,
    challenge,
    cancelChallenge,
    refreshFriendIds,
  } = useFriendChallengesContext();

  async function load() {
    try {
      const res = await fetch("/api/friends");
      if (res.status === 401) {
        setUnauthorized(true);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setFriends(data.friends ?? []);
      setPending(data.pending ?? []);
      await refreshFriendIds();
    } catch {
      setError(t("loadError"));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function sendRequest() {
    setError(null);
    const res = await fetch("/api/friends", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, action: "request" }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? t("loadError"));
      return;
    }
    setUsername("");
    await load();
  }

  async function act(friendshipId: string, action: "accept" | "reject") {
    await fetch("/api/friends", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ friendshipId, action }),
    });
    await load();
  }

  if (unauthorized) {
    return (
      <div className="card setup-card">
        <h1 className="page-title">{t("title")}</h1>
        <p className="muted">{t("loginRequired")}</p>
        <Link className="btn btn-primary" href="/login?next=/friends">
          {a("signIn")}
        </Link>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <h1 className="page-title">{t("title")}</h1>

      <div className="card">
        <div className="form-row">
          <input
            className="input input-pill"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t("username")}
            onKeyDown={(e) => {
              if (e.key === "Enter") void sendRequest();
            }}
          />
          <button className="btn btn-primary" type="button" onClick={() => void sendRequest()}>
            {t("add")}
          </button>
        </div>
        {error && <p style={{ color: "var(--danger)", margin: "0.75rem 0 0" }}>{error}</p>}
      </div>

      <section className="card" style={{ display: "grid", gap: "0.85rem" }}>
        <h3 style={{ margin: 0 }}>{t("pending")}</h3>
        {pending.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            {t("emptyPending")}
          </p>
        ) : (
          <ul className="list-stack">
            {pending.map((p) => (
              <li key={p.id} className="list-row">
                <span style={{ display: "flex", alignItems: "center", gap: "0.7rem" }}>
                  <PlayerAvatar name={p.user.displayName} />
                  <span>
                    <Link href={`/u/${p.user.username}`}>
                      <strong>{p.user.displayName}</strong>
                    </Link>{" "}
                    <span className="muted">({p.direction})</span>
                  </span>
                </span>
                {p.direction === "incoming" && (
                  <span style={{ display: "flex", gap: "0.35rem" }}>
                    <button
                      className="btn btn-primary btn-sm"
                      type="button"
                      onClick={() => void act(p.id, "accept")}
                    >
                      {t("accept")}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      onClick={() => void act(p.id, "reject")}
                    >
                      {t("reject")}
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" style={{ display: "grid", gap: "0.85rem" }}>
        <h3 style={{ margin: 0 }}>{t("accepted")}</h3>
        {notice && <p className="muted challenge-notice">{t(NOTICE_KEYS[notice])}</p>}
        {friends.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            {t("empty")}
          </p>
        ) : (
          <ul className="list-stack">
            {friends.map((f) => {
              const isOnline = online.includes(f.user.id);
              const waiting = outgoing?.toUserId === f.user.id;
              return (
                <li key={f.id} className={`list-row ${waiting ? "is-pending" : ""}`}>
                  <span className="list-row-main">
                    <PlayerAvatar name={f.user.displayName} />
                    <span className="list-row-copy">
                      <Link href={`/u/${f.user.username}`}>
                        <strong>{f.user.displayName}</strong>
                      </Link>
                      <span className="presence">
                        <i className={isOnline ? "presence-dot is-online" : "presence-dot"} />
                        {isOnline ? t("online") : t("offline")}
                      </span>
                    </span>
                  </span>
                  {waiting ? (
                    <span className="friend-pending">
                      <span className="friend-pending-label">{t("playPending")}</span>
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        onClick={cancelChallenge}
                      >
                        {t("playCancel")}
                      </button>
                    </span>
                  ) : (
                    <button
                      className="btn btn-primary btn-sm"
                      type="button"
                      disabled={!isOnline || outgoing !== null}
                      onClick={() => challenge(f.user.id)}
                    >
                      {t("play")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
