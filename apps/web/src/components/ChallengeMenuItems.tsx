"use client";

import { useTranslations } from "next-intl";
import { useFriendChallengesContext } from "@/components/FriendChallengesProvider";
import { PlayerAvatar } from "@/components/Marks";

/** Compact accept/decline block for account menu / mobile sheet. */
export function ChallengeMenuItems({ onDone }: { onDone?: () => void }) {
  const t = useTranslations("friends");
  const { incoming, respond } = useFriendChallengesContext();

  if (incoming.length === 0) return null;

  return (
    <div className="challenge-menu">
      {incoming.map((c) => (
        <div key={c.id} className="challenge-menu-item">
          <span className="challenge-menu-copy">
            <PlayerAvatar name={c.from.displayName} />
            <span>
              <strong>{t("challengeTitle")}</strong>
              <span className="muted">{c.from.displayName}</span>
            </span>
          </span>
          <span className="challenge-menu-actions">
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={() => {
                respond(c.id, true);
                onDone?.();
              }}
            >
              {t("accept")}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => {
                respond(c.id, false);
                onDone?.();
              }}
            >
              {t("reject")}
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
