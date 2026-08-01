"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  HeroBoardDiagram,
  Step1Diagram,
  Step2Diagram,
  Step3Diagram,
} from "@/components/BoardDiagram";
import {
  IconBot,
  IconDevice,
  IconDoor,
  IconTrophy,
  IconZap,
} from "@/components/icons";

export function HomeView({ isSignedIn }: { isSignedIn: boolean }) {
  const t = useTranslations("home");
  const a = useTranslations("app");
  const rankedHref = isSignedIn
    ? "/play?mode=ranked"
    : "/login?next=/play?mode=ranked";

  const steps = [
    { title: "guide1Title", body: "guide1Body", figure: <Step1Diagram /> },
    { title: "guide2Title", body: "guide2Body", figure: <Step2Diagram /> },
    { title: "guide3Title", body: "guide3Body", figure: <Step3Diagram /> },
  ] as const;

  return (
    <div className="home">
      <section className="card hero">
        <div className="hero-copy">
          <h1>{t("heroTitle")}</h1>
          <p className="hero-lead">{t("heroBody")}</p>

          <div className="play-tiles">
            <Link className="play-tile is-primary" href={rankedHref}>
              <span className="play-tile-icon">
                <IconTrophy />
              </span>
              <span className="play-tile-copy">
                <strong>{a("playRanked")}</strong>
                <span>{t("modeRankedDesc")}</span>
              </span>
            </Link>

            <Link className="play-tile tile-casual" href="/play?mode=casual">
              <span className="play-tile-icon icon-casual">
                <IconZap />
              </span>
              <span className="play-tile-copy">
                <strong>{a("playCasual")}</strong>
                <span>{t("modeCasualDesc")}</span>
              </span>
            </Link>

            <Link className="play-tile tile-bot" href="/play/bot">
              <span className="play-tile-icon icon-bot">
                <IconBot />
              </span>
              <span className="play-tile-copy">
                <strong>{a("playBot")}</strong>
                <span>{t("modeBotDesc")}</span>
              </span>
            </Link>

            <Link className="play-tile tile-local" href="/play/local">
              <span className="play-tile-icon icon-local">
                <IconDevice />
              </span>
              <span className="play-tile-copy">
                <strong>{a("playLocal")}</strong>
                <span>{t("modeLocalDesc")}</span>
              </span>
            </Link>

            <Link className="play-tile tile-room" href="/play/room">
              <span className="play-tile-icon icon-room">
                <IconDoor />
              </span>
              <span className="play-tile-copy">
                <strong>{a("playRoom")}</strong>
                <span>{t("modeRoomDesc")}</span>
              </span>
            </Link>
          </div>

          {!isSignedIn && <p className="muted hero-note">{t("rankedRequiresAuth")}</p>}
        </div>

        <div className="hero-visual">
          <HeroBoardDiagram />
        </div>
      </section>

      <section className="guide">
        <div className="section-head">
          <div>
            <h2>{t("guideTitle")}</h2>
            <p>{t("guideBody")}</p>
          </div>
        </div>

        <div className="guide-grid">
          {steps.map((step, index) => (
            <article key={step.title} className="card guide-card">
              <div className="guide-figure">{step.figure}</div>
              <div className="guide-head">
                <span className="guide-step">{index + 1}</span>
                <h3>{t(step.title)}</h3>
              </div>
              <p>{t(step.body)}</p>
            </article>
          ))}
        </div>

        <div className="card guide-legend">
          <span className="legend-item">
            <span className="legend-swatch is-playable" />
            {t("legendPlayable")}
          </span>
          <span className="legend-item">
            <span className="legend-swatch is-hint" />
            {t("legendHint")}
          </span>
          <span className="legend-item">
            <span className="legend-swatch is-last" />
            {t("legendLast")}
          </span>
        </div>

        <p className="muted spec-note">{t("specNote")}</p>
      </section>
    </div>
  );
}
