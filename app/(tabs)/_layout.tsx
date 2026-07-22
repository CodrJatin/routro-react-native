import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useAuth } from '../../src/auth/AuthProvider';
import { FriendshipsProvider } from '../../src/friends/FriendshipsProvider';
import { LocationProvider } from '../../src/realtime/LocationProvider';
import { colors } from '../../src/theme/colors';

export default function TabsLayout() {
  const { session } = useAuth();

  return (
    <FriendshipsProvider userId={session?.user.id}>
      <LocationProvider>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: colors.accent,
            tabBarInactiveTintColor: colors.textSecondary,
            tabBarStyle: {
              backgroundColor: colors.surface,
              borderTopColor: colors.border,
            },
          }}
        >
          <Tabs.Screen
            name="index"
            options={{
              title: 'Route',
              tabBarIcon: ({ color, size }) => <Ionicons name="navigate" color={color} size={size} />,
            }}
          />
          <Tabs.Screen
            name="map"
            options={{
              title: 'Map',
              tabBarIcon: ({ color, size }) => <Ionicons name="map" color={color} size={size} />,
            }}
          />
          <Tabs.Screen
            name="friends"
            options={{
              title: 'Friends',
              tabBarIcon: ({ color, size }) => <Ionicons name="people" color={color} size={size} />,
            }}
          />
          <Tabs.Screen
            name="settings"
            options={{
              title: 'Settings',
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="settings" color={color} size={size} />
              ),
            }}
          />
        </Tabs>
      </LocationProvider>
    </FriendshipsProvider>
  );
}
