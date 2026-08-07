"use client";

import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { useFriendChallengesContext } from "@/components/FriendChallengesProvider";
import { PlayerAvatar } from "@/components/Marks";

/** Casual / ranked queue & match — keep the board clear of popups. */
export function isMatchFocusPath(pathname: string): boolean {
  return pathname === "/play";
}

/**
 * Floating play-request card. Hidden on casual/ranked so focus stays on the
 * match; those pages only show a quiet account-menu indicator instead.
 */
export function ChallengeToast() {
  const t = useTranslations("friends");
  const pathname = usePathname();
  const { incoming, respond } = useFriendChallengesContext();

  if (incoming.length === 0 || isMatchFocusPath(pathname)) return null;

  return (
    <aside className="challenge-toast" role="status" aria-live="polite">
      {incoming.map((c) => (
        <article key={c.id} className="challenge-toast-card">
          <div className="challenge-toast-head">
            <PlayerAvatar name={c.from.displayName} size="lg" />
            <div className="challenge-toast-copy">
              <span className="challenge-toast-label">{t("challengeTitle")}</span>
              <p>{t("challengeFrom", { name: c.from.displayName })}</p>
            </div>
          </div>
          <div className="challenge-toast-actions">
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={() => respond(c.id, true)}
            >
              {t("accept")}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => respond(c.id, false)}
            >
              {t("reject")}
            </button>
          </div>
        </article>
      ))}
    </aside>
  );
}
