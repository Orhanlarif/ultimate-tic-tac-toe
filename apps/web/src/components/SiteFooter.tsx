"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

export function SiteFooter() {
  const t = useTranslations("app");
  const f = useTranslations("footer");

  return (
    <footer className="site-footer">
      <div className="container site-footer-inner">
        <div className="site-footer-brand">
          <span className="brand-mark" aria-hidden="true">
            {Array.from({ length: 9 }, (_, index) => (
              <span key={index} />
            ))}
          </span>
          <div className="brand-copy">
            <strong>{t("name")}</strong>
            <span className="muted">{f("blurb")}</span>
          </div>
        </div>
        <div className="site-footer-meta">
          <span>5+2 · Glicko-2</span>
          <Link href="/leaderboard">{t("leaderboard")}</Link>
          <Link href="/play/bot">{t("playBot")}</Link>
        </div>
      </div>
    </footer>
  );
}
