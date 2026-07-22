import { create } from 'zustand';

export type PresenceStatus = 'offline' | 'online' | 'broadcasting';

export interface FriendLocation {
  userId: string;
  lat: number;
  lon: number;
  heading: number | null;
  /** ms since epoch, from the sender's device clock */
  ts: number;
}

interface LocationState {
  isBroadcasting: boolean;
  friendLocations: Record<string, FriendLocation>;
  friendPresence: Record<string, PresenceStatus>;
  setBroadcasting: (value: boolean) => void;
  upsertFriendLocation: (loc: FriendLocation) => void;
  setFriendPresence: (userId: string, status: PresenceStatus) => void;
  removeFriend: (userId: string) => void;
}

/** Global, ephemeral, in-memory only -- nothing here is ever persisted.
 * The Map screen subscribes to just `friendLocations` via a selector so a
 * location tick only re-renders the small <FriendsLayer/> leaf component,
 * never the map canvas or the rest of the screen tree. */
export const useLocationStore = create<LocationState>((set) => ({
  isBroadcasting: false,
  friendLocations: {},
  friendPresence: {},

  setBroadcasting: (value) => set({ isBroadcasting: value }),

  upsertFriendLocation: (loc) =>
    set((state) => ({
      friendLocations: { ...state.friendLocations, [loc.userId]: loc },
    })),

  setFriendPresence: (userId, status) =>
    set((state) => ({
      friendPresence: { ...state.friendPresence, [userId]: status },
    })),

  removeFriend: (userId) =>
    set((state) => {
      const friendLocations = { ...state.friendLocations };
      const friendPresence = { ...state.friendPresence };
      delete friendLocations[userId];
      delete friendPresence[userId];
      return { friendLocations, friendPresence };
    }),
}));
