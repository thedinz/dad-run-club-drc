import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import { io, type Socket } from "socket.io-client";
import { API_URL, api } from "../api";
import Screen from "../components/Screen";
import { getStoredItem, setStoredItem } from "../storage";
import { colors, shadows } from "../theme";
import type { ChatMessage, User } from "../types";

type Session = {
  token: string;
  user: User;
};

type PendingAttachment = {
  fileName: string | null;
  mimeType: string;
  data: string;
  uri: string;
};

export default function ChatScreen() {
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null);
  const [loading, setLoading] = useState(true);
  const socketRef = useRef<Socket | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      async function restore() {
        const stored = await getStoredItem("drc-session");
        if (!active) {
          return;
        }

        if (stored) {
          setSession(JSON.parse(stored) as Session);
        }
        setLoading(false);
      }

      void restore();
      return () => {
        active = false;
      };
    }, [])
  );

  useEffect(() => {
    if (!session?.token) {
      return;
    }

    void loadMessages(session.token);
    const socket = io(API_URL, {
      auth: { token: session.token },
      transports: ["websocket"]
    });

    socket.on("chat:message", (incoming: ChatMessage) => {
      setMessages((current) =>
        current.some((item) => item.id === incoming.id)
          ? current
          : [...current, incoming]
      );
    });

    socketRef.current = socket;
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [session]);

  async function loadMessages(token: string) {
    const data = await api<{ messages: ChatMessage[] }>(
      "/chat/messages",
      {},
      token
    );
    setMessages(data.messages);
  }

  async function sendMessage() {
    const trimmed = message.trim();
    if ((!trimmed && !attachment) || !session) {
      return;
    }

    socketRef.current?.emit("chat:send", {
      body: message,
      attachments: attachment
        ? [
            {
              fileName: attachment.fileName,
              mimeType: attachment.mimeType,
              data: attachment.data
            }
          ]
        : []
    });
    setMessage("");
    setAttachment(null);
  }

  async function pickAttachment() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Photos permission", "Allow photo access to share media.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsEditing: false,
      base64: true,
      quality: 0.85
    });

    if (result.canceled || !result.assets[0]) {
      return;
    }

    const asset = result.assets[0];
    if (!asset.base64) {
      Alert.alert("Could not attach media", "Try another item from your library.");
      return;
    }

    setAttachment({
      fileName: asset.fileName ?? null,
      mimeType: asset.mimeType ?? "image/jpeg",
      data: asset.base64,
      uri: asset.uri
    });
  }

  if (loading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.pine} />
        </View>
      </Screen>
    );
  }

  if (!session) {
    return <Signup onSignedIn={setSession} />;
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={84}
        style={styles.chatShell}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>Club Chat</Text>
            <Text style={styles.title}>Hey, {session.user.firstName}</Text>
          </View>
          <View style={styles.chatBadge}>
            <Ionicons name="radio" size={16} color={colors.pine} />
            <Text>Live</Text>
          </View>
        </View>

        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.messages}
          renderItem={({ item }) => (
            <View
              style={[
                styles.messageBubble,
                item.user.id === session.user.id && styles.mine
              ]}
            >
              <Text style={styles.messageName}>
                {item.user.firstName} {item.user.lastName}
              </Text>
              {item.body ? <Text style={styles.messageText}>{item.body}</Text> : null}
              {item.media?.map((media) => {
                const mediaUrl = `${API_URL}${media.url}?token=${encodeURIComponent(
                  session.token
                )}`;
                return media.mimeType.startsWith("image/") ? (
                  <Image
                    key={media.id}
                    source={{ uri: mediaUrl }}
                    style={styles.messageImage}
                  />
                ) : (
                  <TouchableOpacity
                    key={media.id}
                    style={styles.fileChip}
                    onPress={() => Linking.openURL(mediaUrl)}
                  >
                    <Ionicons name="document-attach-outline" size={16} color={colors.ink} />
                    <Text style={styles.fileChipText}>
                      {media.originalName ?? media.mimeType}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        />

        {attachment ? (
          <View style={styles.attachmentPreview}>
            <Image source={{ uri: attachment.uri }} style={styles.attachmentImage} />
            <Text style={styles.attachmentText}>
              {attachment.fileName ?? attachment.mimeType}
            </Text>
            <TouchableOpacity onPress={() => setAttachment(null)}>
              <Ionicons name="close-circle" size={22} color={colors.clay} />
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.composer}>
          <TouchableOpacity style={styles.attachButton} onPress={pickAttachment}>
            <Ionicons name="image-outline" size={20} color={colors.ink} />
          </TouchableOpacity>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder="Message the club"
            placeholderTextColor={colors.muted}
            style={styles.messageInput}
          />
          <TouchableOpacity style={styles.sendButton} onPress={sendMessage}>
            <Ionicons name="send" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Signup({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [mode, setMode] = useState<"login" | "join">("login");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [inviteCode, setInviteCode] = useState("DRC-FOUNDERS");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    setError("");

    try {
      const session = await api<Session>(
        mode === "login" ? "/auth/login" : "/auth/register",
        {
          method: "POST",
          body: JSON.stringify(
            mode === "login"
              ? {
                  email,
                  inviteCode
                }
              : {
                  firstName,
                  lastName,
                  email,
                  inviteCode
                }
          )
        }
      );

      await setStoredItem("drc-session", JSON.stringify(session));
      onSignedIn(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign up");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <View style={styles.signupShell}>
        <View style={styles.signupPanel}>
          <Text style={styles.kicker}>Members only</Text>
          <Text style={styles.title}>
            {mode === "login" ? "Sign in to chat" : "Join DRC chat"}
          </Text>
          <Text style={styles.signupCopy}>
            {mode === "login"
              ? "Already added by an admin? Use your email and club invite code."
              : "Use your invite code to unlock chat and event tools."}
          </Text>
          {mode === "join" ? (
            <>
              <TextInput
                value={firstName}
                onChangeText={setFirstName}
                placeholder="First name"
                placeholderTextColor={colors.muted}
                style={styles.input}
              />
              <TextInput
                value={lastName}
                onChangeText={setLastName}
                placeholder="Last name"
                placeholderTextColor={colors.muted}
                style={styles.input}
              />
            </>
          ) : null}
          <TextInput
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <TextInput
            autoCapitalize="characters"
            value={inviteCode}
            onChangeText={setInviteCode}
            placeholder="Invite code"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TouchableOpacity
            disabled={saving}
            onPress={submit}
            style={[styles.primaryButton, saving && styles.disabled]}
          >
            <Text style={styles.primaryButtonText}>
              {saving ? "Working..." : mode === "login" ? "Sign in" : "Join"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            disabled={saving}
            onPress={() => {
              setError("");
              setMode(mode === "login" ? "join" : "login");
            }}
            style={styles.secondaryAuthButton}
          >
            <Text style={styles.secondaryAuthText}>
              {mode === "login"
                ? "Need to create an account?"
                : "Already have an account?"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center"
  },
  chatShell: {
    flex: 1
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 12,
    paddingTop: 14
  },
  kicker: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800"
  },
  title: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: 0
  },
  chatBadge: {
    alignItems: "center",
    backgroundColor: colors.softPine,
    borderRadius: 8,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  messages: {
    gap: 10,
    paddingVertical: 10
  },
  messageBubble: {
    alignSelf: "flex-start",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    maxWidth: "86%",
    padding: 12,
    ...shadows.panel
  },
  mine: {
    alignSelf: "flex-end",
    backgroundColor: colors.softPine,
    borderColor: "#c8e6da"
  },
  messageName: {
    color: colors.pine,
    fontSize: 12,
    fontWeight: "900",
    marginBottom: 4
  },
  messageText: {
    color: colors.ink,
    fontSize: 16,
    lineHeight: 22
  },
  composer: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    paddingBottom: 12,
    paddingTop: 8
  },
  attachmentPreview: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 8
  },
  attachmentImage: {
    borderRadius: 6,
    height: 42,
    width: 42
  },
  attachmentText: {
    color: colors.ink,
    flex: 1,
    fontWeight: "800"
  },
  attachButton: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    width: 48
  },
  messageInput: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.ink,
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 14
  },
  sendButton: {
    alignItems: "center",
    backgroundColor: colors.ink,
    borderRadius: 8,
    height: 48,
    justifyContent: "center",
    width: 48
  },
  messageImage: {
    aspectRatio: 1,
    borderRadius: 8,
    marginTop: 8,
    width: 220
  },
  fileChip: {
    alignItems: "center",
    backgroundColor: "#eef2ef",
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
    padding: 10
  },
  fileChipText: {
    color: colors.ink,
    fontWeight: "800"
  },
  signupShell: {
    flex: 1,
    justifyContent: "center"
  },
  signupPanel: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 18,
    ...shadows.panel
  },
  signupCopy: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22
  },
  input: {
    backgroundColor: "#fff",
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.ink,
    minHeight: 48,
    paddingHorizontal: 14
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.ink,
    borderRadius: 8,
    minHeight: 48,
    justifyContent: "center"
  },
  disabled: {
    opacity: 0.6
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "900"
  },
  secondaryAuthButton: {
    alignItems: "center",
    minHeight: 42,
    justifyContent: "center"
  },
  secondaryAuthText: {
    color: colors.pine,
    fontSize: 15,
    fontWeight: "900"
  },
  error: {
    color: colors.clay,
    fontWeight: "700"
  }
});
