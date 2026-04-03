import { api } from './api';

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
  async getConversations(): Promise<Conversation[]> {
    try {
      const data = await api.get<any>('/messaging/conversations');
      console.log('[Messaging] getConversations raw:', JSON.stringify(data).substring(0, 500));
      if (Array.isArray(data)) return data;
      if (data?.conversations && Array.isArray(data.conversations)) return data.conversations;
      return [];
    } catch (err: any) {
      console.warn('[Messaging] getConversations failed:', err?.message || err);
      return [];
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
