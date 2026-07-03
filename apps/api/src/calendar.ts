import { RRule, rrulestr } from "rrule";

export type RecurrenceFrequency = "NONE" | "DAILY" | "WEEKLY" | "MONTHLY";

export type EventRow = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_at: Date;
  end_at: Date;
  all_day: boolean;
  recurrence_rule: string | null;
  color: string;
  created_by_id: string | null;
  created_at: Date;
  updated_at: Date;
};

export type ExceptionRow = {
  id: string;
  event_id: string;
  occurrence_start_at: Date;
  action: string;
};

export function buildRecurrenceRule(
  startAt: Date,
  frequency: RecurrenceFrequency,
  until?: Date | null
) {
  if (frequency === "NONE") {
    return null;
  }

  const freq = {
    DAILY: RRule.DAILY,
    WEEKLY: RRule.WEEKLY,
    MONTHLY: RRule.MONTHLY
  }[frequency];

  return new RRule({
    dtstart: startAt,
    freq,
    interval: 1,
    until: until ?? undefined
  }).toString();
}

export function expandEvents(
  events: EventRow[],
  exceptions: ExceptionRow[],
  from: Date,
  to: Date
) {
  return events.flatMap((event) => {
    if (!event.recurrence_rule) {
      if (event.start_at <= to && event.end_at >= from) {
        return [formatOccurrence(event, event.start_at, false)];
      }
      return [];
    }

    const duration = event.end_at.getTime() - event.start_at.getTime();
    const rule = rrulestr(event.recurrence_rule);
    const occurrences = rule.between(from, to, true);

    return occurrences
      .filter((occurrence) => {
        const exception = exceptions.find(
          (item) =>
            item.event_id === event.id &&
            item.occurrence_start_at.getTime() === occurrence.getTime()
        );
        return exception?.action !== "CANCELLED";
      })
      .map((occurrence) =>
        formatOccurrence(event, occurrence, true, new Date(occurrence.getTime() + duration))
      );
  });
}

function formatOccurrence(
  event: EventRow,
  occurrenceStartAt: Date,
  recurring: boolean,
  occurrenceEndAt = event.end_at
) {
  return {
    id: recurring ? `${event.id}:${occurrenceStartAt.toISOString()}` : event.id,
    eventId: event.id,
    title: event.title,
    description: event.description,
    location: event.location,
    startAt: occurrenceStartAt.toISOString(),
    endAt: occurrenceEndAt.toISOString(),
    allDay: event.all_day,
    recurring,
    recurrenceRule: event.recurrence_rule,
    color: event.color,
    createdById: event.created_by_id,
    createdAt: event.created_at.toISOString(),
    updatedAt: event.updated_at.toISOString()
  };
}
