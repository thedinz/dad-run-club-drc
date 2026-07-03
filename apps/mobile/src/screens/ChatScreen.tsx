import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
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

export default function ChatScreen() {
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
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
    if (!trimmed || !session) {
      return;
    }

    socketRef.current?.emit("chat:send", { body: trimmed });
    setMessage("");
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
              <Text style={styles.messageText}>{item.body}</Text>
            </View>
          )}
        />

        <View style={styles.composer}>
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
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [inviteCode, setInviteCode] = useState("DRC-FOUNDERS");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function signUp() {
    setSaving(true);
    setError("");

    try {
      const session = await api<Session>("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          firstName,
          lastName,
          email,
          inviteCode
        })
      });

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
          <Text style={styles.title}>Join DRC chat</Text>
          <Text style={styles.signupCopy}>
            Use your invite code to unlock chat and event tools.
          </Text>
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
            onPress={signUp}
            style={[styles.primaryButton, saving && styles.disabled]}
          >
            <Text style={styles.primaryButtonText}>
              {saving ? "Joining..." : "Join"}
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
  error: {
    color: colors.clay,
    fontWeight: "700"
  }
});
