import { IconO, IconX } from "@/components/icons";

export function MarkX({ className = "" }: { className?: string }) {
  return (
    <span className={`mark mark-x ${className}`.trim()} aria-hidden>
      <IconX />
    </span>
  );
}

export function MarkO({ className = "" }: { className?: string }) {
  return (
    <span className={`mark mark-o ${className}`.trim()} aria-hidden>
      <IconO />
    </span>
  );
}

export function Mark({
  player,
  className = "",
}: {
  player: "X" | "O";
  className?: string;
}) {
  return player === "X" ? (
    <MarkX className={className} />
  ) : (
    <MarkO className={className} />
  );
}

export function PlayerAvatar({
  name,
  player,
  size = "md",
}: {
  name: string;
  player?: "X" | "O";
  size?: "md" | "lg";
}) {
  const initial = (name.trim().charAt(0) || "?").toUpperCase();
  return (
    <span
      className={[
        "player-avatar",
        player === "X" ? "avatar-x" : "",
        player === "O" ? "avatar-o" : "",
        size === "lg" ? "avatar-lg" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden
    >
      {initial}
    </span>
  );
}
