import { Ionicons } from "@expo/vector-icons";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import CalendarScreen from "./src/screens/CalendarScreen";
import ChatScreen from "./src/screens/ChatScreen";
import FeedScreen from "./src/screens/FeedScreen";
import { colors } from "./src/theme";

type TabParamList = {
  Feed: undefined;
  Chat: undefined;
  Calendar: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="dark" />
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarActiveTintColor: colors.pine,
            tabBarInactiveTintColor: colors.muted,
            tabBarLabelStyle: {
              fontSize: 12,
              fontWeight: "700"
            },
            tabBarStyle: {
              borderTopColor: colors.line,
              height: 84,
              paddingBottom: 24,
              paddingTop: 8
            },
            tabBarIcon: ({ color, size }) => {
              const icons = {
                Feed: "home-outline",
                Chat: "chatbubbles-outline",
                Calendar: "calendar-outline"
              } as const;

              return (
                <Ionicons
                  name={icons[route.name]}
                  size={size}
                  color={color}
                />
              );
            }
          })}
        >
          <Tab.Screen name="Feed" component={FeedScreen} />
          <Tab.Screen name="Chat" component={ChatScreen} />
          <Tab.Screen name="Calendar" component={CalendarScreen} />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
