import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import { api } from "../api";
import Screen from "../components/Screen";
import { getStoredItem } from "../storage";
import { colors, shadows } from "../theme";
import type { CalendarEvent } from "../types";

type ViewMode = "month" | "list";
type Recurrence = "NONE" | "DAILY" | "WEEKLY" | "MONTHLY";

type EventForm = {
  title: string;
  location: string;
  description: string;
  date: string;
  startTime: string;
  endTime: string;
  recurrenceFrequency: Recurrence;
};

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CalendarScreen() {
  const [token, setToken] = useState<string | null>(null);
  const [activeMonth, setActiveMonth] = useState(startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<EventForm>(blankForm(new Date()));

  const days = useMemo(() => buildMonthGrid(activeMonth), [activeMonth]);
  const monthEvents = useMemo(
    () =>
      events.filter((event) =>
        sameMonth(new Date(event.startAt), activeMonth)
      ),
    [activeMonth, events]
  );
  const selectedEvents = useMemo(
    () =>
      events.filter((event) =>
        sameDay(new Date(event.startAt), selectedDate)
      ),
    [events, selectedDate]
  );

  useFocusEffect(
    useCallback(() => {
      void getStoredItem("drc-session").then((stored) => {
        if (stored) {
          setToken(JSON.parse(stored).token as string);
        }
      });
    }, [])
  );

  useEffect(() => {
    void loadEvents();
  }, [activeMonth]);

  async function loadEvents() {
    setLoading(true);
    const from = days[0] ?? startOfMonth(activeMonth);
    const to = days[days.length - 1] ?? endOfMonth(activeMonth);
    const data = await api<{ events: CalendarEvent[] }>(
      `/events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(
        endOfDay(to).toISOString()
      )}`
    );
    setEvents(data.events);
    setLoading(false);
  }

  async function saveEvent() {
    if (!token) {
      Alert.alert("Join first", "Use the Chat tab to sign up before adding events.");
      return;
    }

    const startAt = combineDateTime(form.date, form.startTime);
    const endAt = combineDateTime(form.date, form.endTime);

    if (!startAt || !endAt || endAt <= startAt) {
      Alert.alert("Check the time", "Use a valid date and an end time after start.");
      return;
    }

    await api(
      editingId ? `/events/${editingId}` : "/events",
      {
        method: editingId ? "PUT" : "POST",
        body: JSON.stringify({
          title: form.title,
          location: form.location,
          description: form.description,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          recurrenceFrequency: form.recurrenceFrequency,
          color: colors.pine
        })
      },
      token
    );

    setShowForm(false);
    setEditingId(null);
    setForm(blankForm(selectedDate));
    await loadEvents();
  }

  function beginAdd(date = selectedDate) {
    setEditingId(null);
    setForm(blankForm(date));
    setShowForm(true);
  }

  function beginEdit(event: CalendarEvent) {
    const start = new Date(event.startAt);
    const end = new Date(event.endAt);
    setEditingId(event.eventId);
    setForm({
      title: event.title,
      location: event.location ?? "",
      description: event.description ?? "",
      date: formatInputDate(start),
      startTime: formatInputTime(start),
      endTime: formatInputTime(end),
      recurrenceFrequency: event.recurring ? "WEEKLY" : "NONE"
    });
    setShowForm(true);
  }

  function confirmDelete(event: CalendarEvent) {
    if (!token) {
      return;
    }

    if (event.recurring) {
      Alert.alert("Delete recurring event", event.title, [
        { text: "Cancel", style: "cancel" },
        {
          text: "This occurrence",
          onPress: () => deleteEvent(event, "single")
        },
        {
          text: "Entire series",
          style: "destructive",
          onPress: () => deleteEvent(event, "series")
        }
      ]);
      return;
    }

    Alert.alert("Delete event", event.title, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => deleteEvent(event, "series")
      }
    ]);
  }

  async function deleteEvent(event: CalendarEvent, scope: "single" | "series") {
    await api(
      `/events/${event.eventId}?scope=${scope}&occurrenceStartAt=${encodeURIComponent(
        event.startAt
      )}`,
      { method: "DELETE" },
      token
    );
    await loadEvents();
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>Calendar</Text>
            <Text style={styles.title}>
              {new Intl.DateTimeFormat("en", {
                month: "long",
                year: "numeric"
              }).format(activeMonth)}
            </Text>
          </View>
          <TouchableOpacity style={styles.addButton} onPress={() => beginAdd()}>
            <Ionicons name="add" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.toolbar}>
          <View style={styles.monthControls}>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => setActiveMonth(addMonths(activeMonth, -1))}
            >
              <Ionicons name="chevron-back" size={18} color={colors.ink} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => setActiveMonth(addMonths(activeMonth, 1))}
            >
              <Ionicons name="chevron-forward" size={18} color={colors.ink} />
            </TouchableOpacity>
          </View>
          <View style={styles.segmented}>
            {(["month", "list"] as ViewMode[]).map((mode) => (
              <TouchableOpacity
                key={mode}
                style={[
                  styles.segment,
                  viewMode === mode && styles.segmentActive
                ]}
                onPress={() => setViewMode(mode)}
              >
                <Text
                  style={[
                    styles.segmentText,
                    viewMode === mode && styles.segmentTextActive
                  ]}
                >
                  {mode === "month" ? "Month" : "List"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {showForm ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>
              {editingId ? "Edit event series" : "Add event"}
            </Text>
            <TextInput
              value={form.title}
              onChangeText={(title) => setForm({ ...form, title })}
              placeholder="Title"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            <TextInput
              value={form.location}
              onChangeText={(location) => setForm({ ...form, location })}
              placeholder="Location"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            <View style={styles.twoCol}>
              <TextInput
                value={form.date}
                onChangeText={(date) => setForm({ ...form, date })}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.muted}
                style={styles.input}
              />
              <TextInput
                value={form.startTime}
                onChangeText={(startTime) => setForm({ ...form, startTime })}
                placeholder="08:00"
                placeholderTextColor={colors.muted}
                style={styles.input}
              />
            </View>
            <View style={styles.twoCol}>
              <TextInput
                value={form.endTime}
                onChangeText={(endTime) => setForm({ ...form, endTime })}
                placeholder="09:00"
                placeholderTextColor={colors.muted}
                style={styles.input}
              />
              <TouchableOpacity
                style={styles.selectLike}
                onPress={() => cycleRecurrence(form, setForm)}
              >
                <Text style={styles.selectText}>
                  {recurrenceLabel(form.recurrenceFrequency)}
                </Text>
              </TouchableOpacity>
            </View>
            <TextInput
              multiline
              value={form.description}
              onChangeText={(description) => setForm({ ...form, description })}
              placeholder="Notes"
              placeholderTextColor={colors.muted}
              style={[styles.input, styles.textarea]}
            />
            <View style={styles.formActions}>
              <TouchableOpacity style={styles.primaryButton} onPress={saveEvent}>
                <Text style={styles.primaryText}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => setShowForm(false)}
              >
                <Text style={styles.secondaryText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {loading ? (
          <ActivityIndicator color={colors.pine} />
        ) : viewMode === "month" ? (
          <View style={styles.panel}>
            <View style={styles.weekdays}>
              {weekdays.map((day) => (
                <Text style={styles.weekday} key={day}>
                  {day}
                </Text>
              ))}
            </View>
            <View style={styles.grid}>
              {days.map((day) => {
                const dayEvents = events.filter((event) =>
                  sameDay(new Date(event.startAt), day)
                );
                const isSelected = sameDay(day, selectedDate);
                return (
                  <TouchableOpacity
                    key={day.toISOString()}
                    style={[
                      styles.dayCell,
                      !sameMonth(day, activeMonth) && styles.dayOutside,
                      isSelected && styles.daySelected
                    ]}
                    onPress={() => {
                      setSelectedDate(day);
                      if (dayEvents.length > 0) {
                        setViewMode("list");
                      }
                    }}
                  >
                    <Text
                      style={[
                        styles.dayNumber,
                        isSelected && styles.dayNumberSelected
                      ]}
                    >
                      {day.getDate()}
                    </Text>
                    <View style={styles.dots}>
                      {dayEvents.slice(0, 3).map((event) => (
                        <View
                          key={event.id}
                          style={[styles.dot, { backgroundColor: event.color }]}
                        />
                      ))}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
            <DayAgenda
              events={selectedEvents}
              onAdd={() => beginAdd(selectedDate)}
              onEdit={beginEdit}
              onDelete={confirmDelete}
            />
          </View>
        ) : (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>This month</Text>
            {monthEvents.length === 0 ? (
              <Text style={styles.empty}>No events yet.</Text>
            ) : (
              monthEvents.map((event) => (
                <EventRow
                  event={event}
                  key={event.id}
                  onEdit={beginEdit}
                  onDelete={confirmDelete}
                />
              ))
            )}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function DayAgenda({
  events,
  onAdd,
  onEdit,
  onDelete
}: {
  events: CalendarEvent[];
  onAdd: () => void;
  onEdit: (event: CalendarEvent) => void;
  onDelete: (event: CalendarEvent) => void;
}) {
  return (
    <View style={styles.agenda}>
      <View style={styles.agendaHeading}>
        <Text style={styles.panelTitle}>Selected day</Text>
        <TouchableOpacity onPress={onAdd}>
          <Text style={styles.link}>Add</Text>
        </TouchableOpacity>
      </View>
      {events.length === 0 ? (
        <Text style={styles.empty}>No events on this day.</Text>
      ) : (
        events.map((event) => (
          <EventRow
            event={event}
            key={event.id}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))
      )}
    </View>
  );
}

function EventRow({
  event,
  onEdit,
  onDelete
}: {
  event: CalendarEvent;
  onEdit: (event: CalendarEvent) => void;
  onDelete: (event: CalendarEvent) => void;
}) {
  return (
    <View style={styles.eventRow}>
      <View style={[styles.eventStripe, { backgroundColor: event.color }]} />
      <View style={styles.eventBody}>
        <Text style={styles.eventTitle}>{event.title}</Text>
        <Text style={styles.eventMeta}>
          {formatDisplayDate(event.startAt)} - {formatDisplayTime(event.endAt)}
          {event.location ? ` at ${event.location}` : ""}
        </Text>
        {event.description ? (
          <Text style={styles.eventDescription}>{event.description}</Text>
        ) : null}
      </View>
      <View style={styles.eventActions}>
        <TouchableOpacity style={styles.miniButton} onPress={() => onEdit(event)}>
          <Ionicons name="create-outline" size={16} color={colors.ink} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.miniButton, styles.deleteButton]}
          onPress={() => onDelete(event)}
        >
          <Ionicons name="trash-outline" size={16} color={colors.clay} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function blankForm(date: Date): EventForm {
  return {
    title: "",
    location: "",
    description: "",
    date: formatInputDate(date),
    startTime: "08:00",
    endTime: "09:00",
    recurrenceFrequency: "NONE"
  };
}

function cycleRecurrence(
  form: EventForm,
  setForm: (form: EventForm) => void
) {
  const order: Recurrence[] = ["NONE", "DAILY", "WEEKLY", "MONTHLY"];
  const next = order[(order.indexOf(form.recurrenceFrequency) + 1) % order.length];
  setForm({ ...form, recurrenceFrequency: next });
}

function recurrenceLabel(value: Recurrence) {
  return {
    NONE: "One time",
    DAILY: "Daily",
    WEEKLY: "Weekly",
    MONTHLY: "Monthly"
  }[value];
}

function buildMonthGrid(month: Date) {
  const first = startOfMonth(month);
  const firstGrid = new Date(first);
  firstGrid.setDate(firstGrid.getDate() - firstGrid.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstGrid);
    date.setDate(firstGrid.getDate() + index);
    return date;
  });
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function endOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function addMonths(date: Date, count: number) {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function sameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function formatInputDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatInputTime(date: Date) {
  return date.toTimeString().slice(0, 5);
}

function combineDateTime(date: string, time: string) {
  const combined = new Date(`${date}T${time}:00`);
  return Number.isNaN(combined.getTime()) ? null : combined;
}

function formatDisplayDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDisplayTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

const styles = StyleSheet.create({
  scroll: {
    gap: 14,
    paddingBottom: 26,
    paddingTop: 14
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
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
  addButton: {
    alignItems: "center",
    backgroundColor: colors.ink,
    borderRadius: 8,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  toolbar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  monthControls: {
    flexDirection: "row",
    gap: 8
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40
  },
  segmented: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    padding: 3
  },
  segment: {
    borderRadius: 6,
    minWidth: 72,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  segmentActive: {
    backgroundColor: colors.ink
  },
  segmentText: {
    color: colors.muted,
    fontWeight: "900",
    textAlign: "center"
  },
  segmentTextActive: {
    color: "#fff"
  },
  panel: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 14,
    ...shadows.panel
  },
  panelTitle: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: "900"
  },
  weekdays: {
    flexDirection: "row"
  },
  weekday: {
    color: colors.muted,
    flex: 1,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center"
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap"
  },
  dayCell: {
    aspectRatio: 1,
    borderColor: "#edf1ed",
    borderRadius: 8,
    borderWidth: 1,
    margin: "0.5%",
    padding: 6,
    width: "13.28%"
  },
  dayOutside: {
    opacity: 0.36
  },
  daySelected: {
    backgroundColor: colors.softPine,
    borderColor: colors.pine
  },
  dayNumber: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "900"
  },
  dayNumberSelected: {
    color: colors.pine
  },
  dots: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 2,
    marginTop: 8
  },
  dot: {
    borderRadius: 99,
    height: 5,
    width: 5
  },
  agenda: {
    gap: 10,
    paddingTop: 4
  },
  agendaHeading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  link: {
    color: colors.pine,
    fontWeight: "900"
  },
  empty: {
    color: colors.muted,
    lineHeight: 22
  },
  input: {
    backgroundColor: "#fff",
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.ink,
    minHeight: 46,
    paddingHorizontal: 12
  },
  textarea: {
    minHeight: 84,
    paddingTop: 12,
    textAlignVertical: "top"
  },
  twoCol: {
    flexDirection: "row",
    gap: 10
  },
  selectLike: {
    alignItems: "center",
    backgroundColor: colors.softPine,
    borderRadius: 8,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 12
  },
  selectText: {
    color: colors.pine,
    fontWeight: "900"
  },
  formActions: {
    flexDirection: "row",
    gap: 10
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.ink,
    borderRadius: 8,
    flex: 1,
    justifyContent: "center",
    minHeight: 46
  },
  primaryText: {
    color: "#fff",
    fontWeight: "900"
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#eef2ef",
    borderRadius: 8,
    flex: 1,
    justifyContent: "center",
    minHeight: 46
  },
  secondaryText: {
    color: colors.ink,
    fontWeight: "900"
  },
  eventRow: {
    alignItems: "stretch",
    backgroundColor: "#fafbf8",
    borderColor: "#edf1ed",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
    overflow: "hidden",
    padding: 10
  },
  eventStripe: {
    borderRadius: 99,
    width: 5
  },
  eventBody: {
    flex: 1,
    gap: 4
  },
  eventTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "900"
  },
  eventMeta: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18
  },
  eventDescription: {
    color: colors.ink,
    lineHeight: 20
  },
  eventActions: {
    gap: 8,
    justifyContent: "center"
  },
  miniButton: {
    alignItems: "center",
    backgroundColor: "#eef2ef",
    borderRadius: 8,
    height: 34,
    justifyContent: "center",
    width: 34
  },
  deleteButton: {
    backgroundColor: colors.softClay
  }
});
