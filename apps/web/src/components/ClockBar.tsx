"use client";

import type { ClockState } from "@uttt/contracts";
import type { Player } from "@uttt/game-engine";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

function formatMs(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function ClockBar({
  clock,
  youAre,
  serverOffsetMs = 0,
}: {
  clock: ClockState;
  youAre: Player;
  serverOffsetMs?: number;
}) {
  const t = useTranslations("play");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);

  function remainingMs(player: Player) {
    let ms = player === "X" ? clock.xMs : clock.oMs;
    if (clock.activePlayer === player && clock.turnStartedAt) {
      const serverNow = now + serverOffsetMs;
      ms = Math.max(0, ms - (serverNow - clock.turnStartedAt));
    }
    return ms;
  }

  return (
    <div className="clock-bar">
      {(["X", "O"] as const).map((p) => {
        const active = clock.activePlayer === p;
        const mine = youAre === p;
        const ms = remainingMs(p);
        const low = active && ms <= 30_000;
        return (
          <div
            key={p}
            className={[
              "clock-card",
              mine ? "is-mine" : "",
              active ? "is-active" : "",
              low ? "is-low" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            role="timer"
            aria-live={low ? "polite" : "off"}
            aria-label={`${p} clock ${formatMs(ms)}${low ? ", low time" : ""}`}
          >
            <div className="clock-label">
              {p} {mine ? `(${t("youLabel")})` : ""}
            </div>
            <div className="clock-value">{formatMs(ms)}</div>
          </div>
        );
      })}
    </div>
  );
}
