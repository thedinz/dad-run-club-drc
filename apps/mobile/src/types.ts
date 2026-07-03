export type InstagramPost = {
  id: string;
  caption: string;
  imageUrl: string | null;
  permalink: string;
  mediaType: string;
  timestamp: string;
};

export type FeedResponse = {
  source: string;
  username: string;
  profileUrl: string;
  note?: string;
  posts: InstagramPost[];
};

export type User = {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
};

export type ChatMessage = {
  id: string;
  body: string;
  createdAt: string;
  user: {
    id?: string;
    firstName: string;
    lastName: string;
  };
  media: Array<{
    id: string;
    originalName: string | null;
    mimeType: string;
    sizeBytes: number;
    url: string;
    createdAt: string;
  }>;
};

export type CalendarEvent = {
  id: string;
  eventId: string;
  title: string;
  description: string | null;
  location: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  recurring: boolean;
  color: string;
};
