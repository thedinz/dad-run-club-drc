import { ReactNode } from "react";
import { SafeAreaView, StyleSheet, View } from "react-native";
import { colors } from "../theme";

export default function Screen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: colors.paper,
    flex: 1
  },
  body: {
    flex: 1,
    paddingHorizontal: 18
  }
});
