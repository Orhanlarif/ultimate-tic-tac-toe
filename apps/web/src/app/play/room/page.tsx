"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { RoomLobby } from "@/components/RoomLobby";

function RoomInner() {
  const params = useSearchParams();
  const autoCreate = params.get("create") === "1";
  return <RoomLobby autoCreate={autoCreate} />;
}

export default function RoomPage() {
  return (
    <Suspense fallback={<div className="card setup-card">…</div>}>
      <RoomInner />
    </Suspense>
  );
}
