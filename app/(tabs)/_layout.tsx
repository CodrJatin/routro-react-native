import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useEffect } from 'react';
import { useAuth } from '../../src/auth/AuthProvider';
import { MetroTabBar } from '../../src/components/MetroTabBar';
import { FriendshipsProvider } from '../../src/friends/FriendshipsProvider';
import { useActiveFriendCount } from '../../src/friends/useActiveFriendCount';
import { usePendingInviteResume } from '../../src/friends/pendingInvite';
import { initJourneyController } from '../../src/journey/journeyController';
import { JourneyNotice } from '../../src/journey/JourneyNotice';
import { LocationProvider } from '../../src/realtime/LocationProvider';

export default function TabsLayout() {
  const { session } = useAuth();

  // Reconciles a journey left over from a previous launch. The foreground
  // service can't outlive the process, so this almost always just clears
  // stale state -- but leaving it uncleared would show a journey bar for a
  // journey with nothing behind it.
  useEffect(() => {
    void initJourneyController();
  }, []);

  // Reopens an invite link that was tapped before signing in -- this layout is
  // the first thing to mount behind the auth guard, so it's the earliest point
  // where there's a session to send the request with.
  usePendingInviteResume(!!session);

  return (
    <FriendshipsProvider userId={session?.user.id}>
      <LocationProvider>
        <JourneyNotice />
        <TabsNavigator selfUserId={session?.user.id} />
      </LocationProvider>
    </FriendshipsProvider>
  );
}

/** Split out from TabsLayout so it can read friendships/presence -- both come
 * from providers that wrap this component -- to badge the Friends tab. */
function TabsNavigator({ selfUserId }: { selfUserId: string | undefined }) {
  // Just the count: MetroTabBar turns any truthy tabBarBadge into a plain
  // dot rather than printing the number, so this only decides whether the
  // dot is showing.
  const activeFriendCount = useActiveFriendCount(selfUserId);

  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <MetroTabBar {...props} />}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Map',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'map' : 'map-outline'} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="route"
        options={{
          title: 'Route',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'navigate' : 'navigate-outline'} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{
          title: 'Friends',
          tabBarBadge: activeFriendCount > 0 ? activeFriendCount : undefined,
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'people' : 'people-outline'} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'settings' : 'settings-outline'} color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
