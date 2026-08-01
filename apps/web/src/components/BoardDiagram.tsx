import { Mark } from "@/components/Marks";

type CellMark = "X" | "O" | null;

/**
 * A single 3x3 grid. `hot` outlines the whole board as the one in play,
 * `hints` dots the cells that are still legal.
 */
export function MiniBoardDiagram({
  cells,
  hot = false,
  hints = false,
}: {
  cells: CellMark[];
  hot?: boolean;
  hints?: boolean;
}) {
  return (
    <div className={`dg dg-mini ${hot ? "is-hot" : ""}`.trim()} aria-hidden>
      {cells.map((cell, i) => (
        <span key={i} className="dg-cell">
          {cell ? <Mark player={cell} /> : hints ? <span className="dg-hint" /> : null}
        </span>
      ))}
    </div>
  );
}

interface SubBoard {
  /** Filled cells drawn as small dots. */
  dots?: CellMark[];
  /** Index of the dot drawn as the most recent move. */
  last?: number;
  /** Winner overlay for a captured sub-board. */
  won?: "X" | "O";
  /** Highlighted as the board that must be played next. */
  hot?: boolean;
  dim?: boolean;
}

/** The full 3x3-of-3x3 board. */
export function BigBoardDiagram({
  subs,
  showWinLine = false,
  className = "",
}: {
  subs: SubBoard[];
  showWinLine?: boolean;
  className?: string;
}) {
  return (
    <div className={`dg dg-big ${className}`.trim()} aria-hidden>
      {subs.map((sub, i) => (
        <span
          key={i}
          className={["dg-sub", sub.hot ? "is-hot" : "", sub.dim ? "is-dim" : ""]
            .filter(Boolean)
            .join(" ")}
        >
          {Array.from({ length: 9 }, (_, ci) => {
            const dot = sub.dots?.[ci] ?? null;
            return (
              <span
                key={ci}
                className={[
                  "dg-dot",
                  dot === "X" ? "has-x" : "",
                  dot === "O" ? "has-o" : "",
                  sub.last === ci ? "is-last" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              />
            );
          })}
          {sub.won && (
            <span className="dg-win">
              <Mark player={sub.won} />
            </span>
          )}
        </span>
      ))}
      {showWinLine && <span className="dg-line" />}
    </div>
  );
}

const empty: CellMark[] = Array.from({ length: 9 }, () => null);

function cells(entries: Record<number, CellMark>): CellMark[] {
  const out = [...empty];
  for (const [index, mark] of Object.entries(entries)) out[Number(index)] = mark;
  return out;
}

/** Hero illustration: an Ultimate board mid-match. */
export function HeroBoardDiagram() {
  return (
    <BigBoardDiagram
      className="hero-diagram"
      subs={[
        { won: "X", dots: cells({ 0: "X", 4: "X", 8: "X" }) },
        { dots: cells({ 1: "O", 5: "X", 7: "O" }) },
        { dots: cells({ 3: "X", 4: "O", 7: "O" }) },
        { dots: cells({ 2: "O", 6: "X", 8: "X" }) },
        { won: "O", dots: cells({ 2: "O", 4: "O", 6: "O" }) },
        { dots: cells({ 0: "X", 5: "O", 8: "O" }) },
        { hot: true, dots: cells({ 4: "X" }) },
        { dots: cells({ 1: "X", 3: "O", 5: "X" }) },
        { won: "X", dots: cells({ 2: "X", 4: "X", 6: "X" }) },
      ]}
    />
  );
}

/** Step 1 — the highlighted mini board is the only place you may play. */
export function Step1Diagram() {
  return (
    <MiniBoardDiagram hot hints cells={cells({ 0: "O", 2: "X", 4: "X", 7: "O" })} />
  );
}

/**
 * Step 2 — the cell you pick decides the next board: the last move sits in
 * the middle-right cell, so the middle-right board lights up.
 */
export function Step2Diagram() {
  return (
    <BigBoardDiagram
      subs={[
        { dots: cells({ 0: "X", 4: "O" }), dim: true },
        { dots: cells({ 2: "O", 6: "X" }), dim: true },
        { dots: cells({ 5: "X" }), dim: true },
        { dots: cells({ 1: "O", 7: "X" }), dim: true },
        { dots: cells({ 0: "O", 4: "X", 8: "O" }), last: 5 },
        { hot: true },
        { dots: cells({ 3: "O" }), dim: true },
        { dots: cells({ 8: "X" }), dim: true },
        { dots: cells({ 6: "O" }), dim: true },
      ]}
    />
  );
}

/** Step 3 — three captured boards in a line wins the match. */
export function Step3Diagram() {
  return (
    <BigBoardDiagram
      showWinLine
      subs={[
        { won: "X", dots: cells({ 0: "X", 4: "X", 8: "X" }) },
        { dots: cells({ 1: "O", 5: "X" }) },
        { won: "O", dots: cells({ 2: "O", 4: "O", 6: "O" }) },
        { dots: cells({ 3: "X", 7: "O" }) },
        { won: "X", dots: cells({ 2: "X", 4: "X", 6: "X" }) },
        { dots: cells({ 1: "O", 8: "X" }) },
        { dots: cells({ 0: "O", 8: "X" }) },
        { dots: cells({ 4: "O", 5: "X" }) },
        { won: "X", dots: cells({ 0: "X", 4: "X", 8: "X" }) },
      ]}
    />
  );
}
