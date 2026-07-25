import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useAuth } from '../../src/auth/AuthProvider';
import { MetroTabBar } from '../../src/components/MetroTabBar';
import { FriendshipsProvider } from '../../src/friends/FriendshipsProvider';
import { LocationProvider } from '../../src/realtime/LocationProvider';

export default function TabsLayout() {
  const { session } = useAuth();

  return (
    <FriendshipsProvider userId={session?.user.id}>
      <LocationProvider>
        <Tabs
          screenOptions={{ headerShown: false }}
          tabBar={(props) => <MetroTabBar {...props} />}
        >
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
                <Ionicons
                  name={focused ? 'navigate' : 'navigate-outline'}
                  color={color}
                  size={size}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="friends"
            options={{
              title: 'Friends',
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
                <Ionicons
                  name={focused ? 'settings' : 'settings-outline'}
                  color={color}
                  size={size}
                />
              ),
            }}
          />
        </Tabs>
      </LocationProvider>
    </FriendshipsProvider>
  );
}
