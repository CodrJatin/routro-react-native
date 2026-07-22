import { createContext, useContext, type ReactNode } from 'react';
import { useFriendships } from './useFriendships';

type FriendshipsContextValue = ReturnType<typeof useFriendships>;

const FriendshipsContext = createContext<FriendshipsContextValue | null>(null);

/** Fetches the signed-in user's friendship rows exactly once for the whole
 * authenticated app -- both LocationProvider (channel sync) and the Friends
 * screen (request/list UI) need the same rows and previously each ran their
 * own independent query for them. */
export function FriendshipsProvider({
  userId,
  children,
}: {
  userId: string | undefined;
  children: ReactNode;
}) {
  const value = useFriendships(userId);
  return <FriendshipsContext.Provider value={value}>{children}</FriendshipsContext.Provider>;
}

export function useFriendshipsContext(): FriendshipsContextValue {
  const ctx = useContext(FriendshipsContext);
  if (!ctx) throw new Error('useFriendshipsContext must be used within a FriendshipsProvider');
  return ctx;
}
