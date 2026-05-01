import { api } from './api';

export interface GroupParticipantSummary {
  id: string;
  auth0Id: string;
  name: string;
  picture?: string | null;
  userType?: string;
}

export interface Conversation {
  conversationId: string;
  otherUser: {
    id: string;
    auth0Id?: string;
    name: string;
    picture?: string;
    userType: string;
    timezone?: string;
  } | null;
  // Group-thread metadata (present when the conversation is a multi-participant group).
  isGroup?: boolean;
  groupId?: string;
  groupName?: string;
  /** Kind of group thread. class-broadcast = anchored to a class roster. */
  type?: 'class-broadcast' | 'ad-hoc-group';
  /** Populated for class-broadcasts; lets the client deep-link to the class. */
  classId?: string | null;
  /** Active members (used by the avatar cluster). Left members are excluded. */
  participants?: GroupParticipantSummary[];
  /** Full historical roster for rendering old messages with correct names. */
  allParticipants?: GroupParticipantSummary[];
  /** True when the current user is no longer an active member. */
  archived?: boolean;
  /** When the current user left the thread, if ever. */
  leftAt?: string | null;
  /** When the current user joined; bounds visible history. */
  joinedAt?: string | null;
  /** Per-user inbox state — true when the user moved this thread to Archive. */
  userArchived?: boolean;
  userArchivedAt?: string | null;
  /** True when the caller owns this class chat as the tutor — drives kebab policy. */
  isTutor?: boolean;
  /** Class-broadcast threads only: true when the underlying class is cancelled. */
  classCancelled?: boolean;
  /** Raw class status, when applicable. */
  classStatus?: string | null;
  // Pre-computed on the client for avatar clusters in the list.
  displayParticipants?: GroupParticipantSummary[];
  extraCount?: number;
  lastMessage: {
    content: string;
    senderId: string;
    createdAt: string;
    type: string;
    isSystemMessage?: boolean;
  };
  unreadCount: number;
  updatedAt: string;
}

export interface GroupResponse {
  success: boolean;
  groupId: string;
  type?: 'class-broadcast' | 'ad-hoc-group';
  classId?: string | null;
  participants: GroupParticipantSummary[];
  participantIds: string[];
  name: string;
  alreadyExists: boolean;
  archived?: boolean;
  joinedAt?: string | null;
  leftAt?: string | null;
}

export interface GroupMessagesResponse {
  success: boolean;
  messages: Message[];
  participants?: string[];
  archived?: boolean;
  joinedAt?: string | null;
  leftAt?: string | null;
  type?: 'class-broadcast' | 'ad-hoc-group';
  classId?: string | null;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  receiverId: string;
  content: string;
  type: string;
  read: boolean;
  createdAt: string;
  fileUrl?: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  thumbnailUrl?: string;
  duration?: number;
  sender?: { id: string; name: string; picture?: string };
  replyTo?: {
    messageId: string;
    content?: string;
    senderId?: string;
    senderName?: string;
    type?: string;
  };
  isSystemMessage?: boolean;
  reactions?: Array<{ emoji: string; userId: string; userName: string }>;
}

interface ConversationsResponse {
  success?: boolean;
  conversations?: Conversation[];
}

interface MessagesResponse {
  success?: boolean;
  messages?: Message[];
}

export const messagingService = {
  /**
   * Fetch the current user's conversation list.
   *
   * @param filter 'all' (default; active inbox, hides per-user archived
   *               threads) or 'archived' (Archive folder).
   */
  async getConversations(filter: 'all' | 'archived' = 'all'): Promise<Conversation[]> {
    try {
      const url = filter === 'archived'
        ? '/messaging/conversations?filter=archived'
        : '/messaging/conversations';
      const data = await api.get<any>(url);
      console.log('[Messaging] getConversations raw:', JSON.stringify(data).substring(0, 500));
      if (Array.isArray(data)) return data;
      if (data?.conversations && Array.isArray(data.conversations)) return data.conversations;
      return [];
    } catch (err: any) {
      console.warn('[Messaging] getConversations failed:', err?.message || err);
      return [];
    }
  },

  /**
   * Move a conversation to the user's Archive folder. Reversible via
   * `unarchiveConversation`. Other party is unaffected.
   */
  async archiveConversation(conversationId: string): Promise<boolean> {
    try {
      await api.post(`/messaging/conversations/${encodeURIComponent(conversationId)}/archive`);
      return true;
    } catch (err: any) {
      console.warn('[Messaging] archiveConversation failed:', err?.message || err);
      return false;
    }
  },

  /** Move an archived conversation back to the active inbox. */
  async unarchiveConversation(conversationId: string): Promise<boolean> {
    try {
      await api.post(`/messaging/conversations/${encodeURIComponent(conversationId)}/unarchive`);
      return true;
    } catch (err: any) {
      console.warn('[Messaging] unarchiveConversation failed:', err?.message || err);
      return false;
    }
  },

  /**
   * Permanently remove a conversation from this user's UI. For groups, also
   * leaves the active roster (no future messages). Tutor-on-class-broadcast
   * keeps roster membership but the thread is hidden from their inbox.
   */
  async deleteConversation(conversationId: string): Promise<boolean> {
    try {
      await api.post(`/messaging/conversations/${encodeURIComponent(conversationId)}/delete`);
      return true;
    } catch (err: any) {
      console.warn('[Messaging] deleteConversation failed:', err?.message || err);
      return false;
    }
  },

  async getMessages(otherUserId: string, limit = 50, before?: string): Promise<Message[]> {
    try {
      let url = `/messaging/conversations/${otherUserId}/messages?limit=${limit}`;
      if (before) url += `&before=${before}`;
      const data = await api.get<MessagesResponse | Message[]>(url);
      if (Array.isArray(data)) return data;
      return (data as MessagesResponse).messages || [];
    } catch (err: any) {
      console.warn('[Messaging] getMessages failed:', err?.message || err);
      return [];
    }
  },

  async sendMessage(receiverId: string, content: string, type = 'text', replyTo?: { messageId: string; content?: string; senderId?: string; senderName?: string; type?: string }): Promise<Message | null> {
    try {
      const body: any = { content, type };
      if (replyTo) body.replyTo = replyTo;
      const data = await api.post<any>(`/messaging/conversations/${receiverId}/messages`, body);
      return data.message || data;
    } catch (err: any) {
      console.warn('[Messaging] sendMessage failed:', err?.message || err);
      return null;
    }
  },

  async markRead(otherUserId: string): Promise<void> {
    try {
      await api.put(`/messaging/conversations/${otherUserId}/read`);
    } catch (err: any) {
      console.warn('[Messaging] markRead failed:', err?.message || err);
    }
  },

  async addReaction(messageId: string, emoji: string): Promise<Message | null> {
    try {
      const data = await api.post<any>(`/messaging/messages/${messageId}/reactions`, { emoji });
      return data.message || data;
    } catch (err: any) {
      console.warn('[Messaging] addReaction failed:', err?.message || err);
      return null;
    }
  },

  async deleteMessage(messageId: string): Promise<boolean> {
    try {
      await api.delete(`/messaging/messages/${messageId}`);
      return true;
    } catch (err: any) {
      console.warn('[Messaging] deleteMessage failed:', err?.message || err);
      return false;
    }
  },

  /**
   * Create or fetch a group conversation.
   *
   * Two modes:
   *   - `classId` provided → class-broadcast thread. Idempotent per class,
   *     membership follows enrollment. `participantIds` is ignored; backend
   *     is authoritative.
   *   - `classId` omitted → ad-hoc thread keyed by the sha1 hash of the
   *     participant set; members are immutable after creation.
   */
  async createOrGetGroup(
    participantIds: string[],
    name?: string,
    classId?: string
  ): Promise<GroupResponse | null> {
    try {
      const body: any = { participantIds: participantIds || [], name };
      if (classId) body.classId = classId;
      const data = await api.post<any>('/messaging/groups', body);
      if (!data?.groupId) return null;
      return data as GroupResponse;
    } catch (err: any) {
      console.warn('[Messaging] createOrGetGroup failed:', err?.message || err);
      return null;
    }
  },

  /**
   * Post a message to a group thread. On the first write for a group, the
   * backend requires `participantIds` so it can verify the hash matches
   * `groupId`.
   */
  async sendGroupMessage(
    groupId: string,
    content: string,
    opts: {
      type?: string;
      participantIds?: string[];
      name?: string;
      replyTo?: Message['replyTo'];
    } = {}
  ): Promise<Message | null> {
    try {
      const body: any = { content, type: opts.type || 'text' };
      if (opts.participantIds?.length) body.participantIds = opts.participantIds;
      if (opts.name) body.name = opts.name;
      if (opts.replyTo) body.replyTo = opts.replyTo;
      const data = await api.post<any>(`/messaging/groups/${groupId}/messages`, body);
      return data?.message || null;
    } catch (err: any) {
      console.warn('[Messaging] sendGroupMessage failed:', err?.message || err);
      return null;
    }
  },

  async getGroupMessages(groupId: string, limit = 50, before?: string): Promise<Message[]> {
    try {
      let url = `/messaging/groups/${groupId}/messages?limit=${limit}`;
      if (before) url += `&before=${before}`;
      const data = await api.get<any>(url);
      if (Array.isArray(data)) return data;
      return data?.messages || [];
    } catch (err: any) {
      console.warn('[Messaging] getGroupMessages failed:', err?.message || err);
      return [];
    }
  },

  /**
   * Variant of `getGroupMessages` that surfaces the backend's per-member
   * metadata (archived / leftAt / etc). Used by `ChatScreen` to decide
   * whether to show the composer or a read-only archived banner.
   */
  async getGroupMessagesWithMeta(
    groupId: string,
    limit = 50,
    before?: string
  ): Promise<GroupMessagesResponse | null> {
    try {
      let url = `/messaging/groups/${groupId}/messages?limit=${limit}`;
      if (before) url += `&before=${before}`;
      const data = await api.get<any>(url);
      if (!data) return null;
      return {
        success: !!data.success,
        messages: Array.isArray(data.messages) ? data.messages : (Array.isArray(data) ? data : []),
        participants: data.participants,
        archived: data.archived,
        joinedAt: data.joinedAt,
        leftAt: data.leftAt,
        type: data.type,
        classId: data.classId
      };
    } catch (err: any) {
      console.warn('[Messaging] getGroupMessagesWithMeta failed:', err?.message || err);
      return null;
    }
  },

  async markGroupRead(groupId: string): Promise<void> {
    try {
      await api.put(`/messaging/groups/${groupId}/read`);
    } catch (err: any) {
      console.warn('[Messaging] markGroupRead failed:', err?.message || err);
    }
  },

  async uploadFile(receiverId: string, uri: string, fileName: string, mimeType: string, messageType: 'image' | 'file' | 'voice'): Promise<Message | null> {
    try {
      const formData = new FormData();
      formData.append('file', { uri, name: fileName, type: mimeType } as any);
      formData.append('messageType', messageType);
      const data = await api.upload<any>(`/messaging/conversations/${receiverId}/upload`, formData);
      return data.message || data;
    } catch (err: any) {
      console.warn('[Messaging] uploadFile failed:', err?.message || err);
      return null;
    }
  },
};
