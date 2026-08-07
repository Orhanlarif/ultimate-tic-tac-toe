"use client";

import { useSession } from "next-auth/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  useFriendChallenges,
  type ChallengeNotice,
  type IncomingChallenge,
  type OutgoingChallenge,
} from "@/hooks/useFriendChallenges";

interface FriendChallengesContextValue {
  online: string[];
  incoming: IncomingChallenge[];
  outgoing: OutgoingChallenge | null;
  notice: ChallengeNotice | null;
  challenge: (toUserId: string) => void;
  cancelChallenge: () => void;
  respond: (id: string, accept: boolean) => void;
  dismissNotice: () => void;
  /** Re-fetch accepted friend ids so presence stays accurate. */
  refreshFriendIds: () => Promise<void>;
}

const FriendChallengesContext = createContext<FriendChallengesContextValue | null>(
  null,
);

export function FriendChallengesProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const signedIn = status === "authenticated";
  const [friendIds, setFriendIds] = useState<string[]>([]);

  const refreshFriendIds = useCallback(async () => {
    if (!signedIn) {
      setFriendIds([]);
      return;
    }
    try {
      const res = await fetch("/api/friends");
      if (res.status === 401) {
        setFriendIds([]);
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as {
        friends?: Array<{ user: { id: string } }>;
      };
      setFriendIds((data.friends ?? []).map((f) => f.user.id));
    } catch {
      // Presence will simply stay stale until the next refresh.
    }
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn) {
      setFriendIds([]);
      return;
    }
    void refreshFriendIds();
  }, [signedIn, refreshFriendIds]);

  const challenges = useFriendChallenges(friendIds, signedIn);

  const value: FriendChallengesContextValue = {
    ...challenges,
    refreshFriendIds,
  };

  return (
    <FriendChallengesContext.Provider value={value}>
      {children}
    </FriendChallengesContext.Provider>
  );
}

export function useFriendChallengesContext(): FriendChallengesContextValue {
  const ctx = useContext(FriendChallengesContext);
  if (!ctx) {
    throw new Error("useFriendChallengesContext must be used within FriendChallengesProvider");
  }
  return ctx;
}
