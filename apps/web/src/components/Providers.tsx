"use client";

import { SessionProvider } from "next-auth/react";
import { FriendChallengesProvider } from "@/components/FriendChallengesProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <FriendChallengesProvider>{children}</FriendChallengesProvider>
    </SessionProvider>
  );
}
