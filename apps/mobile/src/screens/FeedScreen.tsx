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
import { API_URL, api } from "../api";
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
              onPress={() =>
                Linking.openURL(
                  feed?.profileUrl ??
                    "https://www.instagram.com/dadrunclubplymouth/"
                )
              }
            >
              <Ionicons name="logo-instagram" size={18} color={colors.ink} />
              <Text style={styles.profileText}>
                @{feed?.username ?? "dadrunclubplymouth"}
              </Text>
            </TouchableOpacity>
            {feed?.note ? <Text style={styles.notice}>{feed.note}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Ionicons name="logo-instagram" size={24} color={colors.pine} />
            <Text style={styles.emptyTitle}>Feed unavailable</Text>
            <Text style={styles.emptyCopy}>
              Instagram is not returning public posts right now. The profile button
              opens the live account.
            </Text>
          </View>
        }
        renderItem={({ item }) => <PostCard post={item} />}
        contentContainerStyle={styles.list}
      />
    </Screen>
  );
}

function PostCard({ post }: { post: InstagramPost }) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUri = post.imageUrl ? resolveImageUrl(post.imageUrl) : null;

  return (
    <TouchableOpacity
      activeOpacity={0.86}
      style={styles.card}
      onPress={() => Linking.openURL(post.permalink)}
    >
      <View style={styles.media}>
        {imageUri && !imageFailed ? (
          <Image
            source={{ uri: imageUri }}
            style={styles.mediaImage}
            onError={() => setImageFailed(true)}
          />
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

function resolveImageUrl(url: string) {
  if (url.startsWith("http")) {
    return url;
  }

  return `${API_URL}${url.startsWith("/") ? "" : "/"}${url}`;
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
  emptyCard: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 18,
    ...shadows.panel
  },
  emptyTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "900"
  },
  emptyCopy: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center"
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
