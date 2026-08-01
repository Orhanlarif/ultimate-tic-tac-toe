"use client";

import { useParams } from "next/navigation";
import { RoomLobby } from "@/components/RoomLobby";

export default function RoomJoinPage() {
  const params = useParams<{ code: string }>();
  const code = typeof params.code === "string" ? params.code : "";
  return <RoomLobby joinCode={code} />;
}
