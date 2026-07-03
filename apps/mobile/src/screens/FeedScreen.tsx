import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import { api } from "../api";
import Screen from "../components/Screen";
import { colors, shadows } from "../theme";
import type { FeedResponse, InstagramPost } from "../types";

const logo = require("../../assets/logo.png");

export default function FeedScreen() {
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadFeed = useCallback(async () => {
    try {
      const data = await api<FeedResponse>("/instagram/feed");
      setFeed(data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  if (loading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.pine} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={feed?.posts ?? []}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.pine}
            onRefresh={() => {
              setRefreshing(true);
              void loadFeed();
            }}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.brand}>
              <Image source={logo} style={styles.logo} />
              <View>
                <Text style={styles.kicker}>Dad Run Club</Text>
                <Text style={styles.title}>Plymouth Feed</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.profileButton}
              onPress={() => Linking.openURL(feed?.profileUrl ?? "https://www.instagram.com/dadrunclubplymouth/")}
            >
              <Ionicons name="logo-instagram" size={18} color={colors.ink} />
              <Text style={styles.profileText}>@{feed?.username}</Text>
            </TouchableOpacity>
            {feed?.note ? <Text style={styles.notice}>{feed.note}</Text> : null}
          </View>
        }
        renderItem={({ item }) => <PostCard post={item} />}
        contentContainerStyle={styles.list}
      />
    </Screen>
  );
}

function PostCard({ post }: { post: InstagramPost }) {
  return (
    <TouchableOpacity
      activeOpacity={0.86}
      style={styles.card}
      onPress={() => Linking.openURL(post.permalink)}
    >
      <View style={styles.media}>
        {post.imageUrl ? (
          <Image source={{ uri: post.imageUrl }} style={styles.mediaImage} />
        ) : (
          <View style={styles.placeholder}>
            <Image source={logo} style={styles.placeholderLogo} />
          </View>
        )}
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.postDate}>{formatDate(post.timestamp)}</Text>
        <Text style={styles.caption}>{post.caption}</Text>
      </View>
    </TouchableOpacity>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

const styles = StyleSheet.create({
  list: {
    gap: 16,
    paddingBottom: 24,
    paddingTop: 12
  },
  center: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center"
  },
  header: {
    gap: 16,
    paddingTop: 8
  },
  brand: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12
  },
  logo: {
    borderRadius: 8,
    height: 58,
    width: 58
  },
  kicker: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700"
  },
  title: {
    color: colors.ink,
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: 0
  },
  profileButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  profileText: {
    color: colors.ink,
    fontWeight: "800"
  },
  notice: {
    backgroundColor: "#fff4df",
    borderLeftColor: colors.gold,
    borderLeftWidth: 4,
    borderRadius: 8,
    color: "#654911",
    padding: 12
  },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
    ...shadows.panel
  },
  media: {
    aspectRatio: 1.1,
    backgroundColor: colors.softPine
  },
  mediaImage: {
    height: "100%",
    width: "100%"
  },
  placeholder: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center"
  },
  placeholderLogo: {
    borderRadius: 8,
    height: 112,
    opacity: 0.92,
    width: 112
  },
  cardBody: {
    gap: 8,
    padding: 14
  },
  postDate: {
    color: colors.pine,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  caption: {
    color: colors.ink,
    fontSize: 16,
    lineHeight: 22
  }
});
