/**
 * Singleton Socket.IO client for the mobile app.
 *
 * Responsibilities:
 *  - Authenticated handshake against the backend (same token the REST API
 *    uses). The token is passed at connect-time via `auth` and is re-read
 *    from the shared api client on every `connect()` so token refreshes
 *    automatically flow through on reconnect.
 *  - Resilience: auto-reconnect with exponential back-off; re-subscribes any
 *    rooms the caller had previously joined so ephemeral network blips are
 *    transparent to consumers.
 *  - Room API: a thin typed surface for class detail real-time updates.
 *    Every screen calls `subscribeToClass(id, cb)` on mount and disposes
 *    the returned unsubscribe fn on unmount — no shared mutable state to
 *    leak between screens.
 *
 * Design notes:
 *  - Stays silent when no auth token is set (e.g. during onboarding or
 *    before the user signs in). `connect()` is a no-op in that case — the
 *    caller just re-invokes it after sign-in.
 *  - Events are delivered via per-class callback sets rather than a single
 *    global emitter so each screen only pays for filtering that concerns it.
 *  - Uses `io.transports = ['websocket']` on native + `'polling'` fallback
 *    for Expo Go dev clients that can't always upgrade.
 */

import { io, Socket } from 'socket.io-client';
import { env } from '../config/env';
import { api } from './api';

export type ClassStateReason =
  | 'student_enrolled'
  | 'student_unenrolled'
  | 'student_removed'
  | 'student_invited'
  | 'payment_status_changed'
  | 'class_cancelled'
  | 'class_auto_cancelled'
  | 'class_updated'
  | 'initial_snapshot';

export interface ClassStatePatch {
  confirmedStudents: Array<{ id: string; name: string; picture?: string }>;
  studentPayments: { [studentId: string]: string };
  capacity: number | null;
  minStudents: number | null;
  flexibleMinimum: boolean;
  price: number | null;
  status: string;
  cancelReason?: string | null;
}

export interface ClassStateEvent {
  classId: string;
  version: string | null;
  reason: ClassStateReason | string;
  actorId?: string | null;
  timestamp?: string;
  state: ClassStatePatch;
}

type ClassStateHandler = (event: ClassStateEvent) => void;

/**
 * Generic, typed event names we surface to screens. The backend already
 * delivers these to `user:{auth0Id}` rooms via `req.io.to(room).emit(...)`;
 * we just need per-screen subscribers.
 */
export type UserEventName =
  | 'new_message'
  | 'message_sent'
  | 'message_deleted'
  | 'reaction_updated'
  | 'new_notification'
  | 'user_typing'
  | 'gcal-events-updated'
  | 'gcal-status-updated';

type UserEventHandler = (payload: any) => void;

class SocketService {
  private socket: Socket | null = null;
  private connecting = false;

  /**
   * Per-class listener registry. Each class id maps to a Set of handlers
   * that fire when a patch for that id arrives. Empty sets are pruned so
   * `getSubscribedClassIds()` reflects only active rooms.
   */
  private classHandlers: Map<string, Set<ClassStateHandler>> = new Map();

  /**
   * Per-event listener registry for the generic "user events" surface
   * (`new_message`, `new_notification`, etc). Each event name maps to a
   * Set of handlers. Empty sets are pruned.
   */
  private userEventHandlers: Map<UserEventName, Set<UserEventHandler>> = new Map();

  /** Monotonic correlation id used for ack-based initial snapshot fetches. */
  private ackCounter = 0;

  /**
   * Boot the socket. Safe to call repeatedly — no-ops if already connected
   * or connecting. Pulls the bearer token from the api client so a refresh
   * performed by the REST layer automatically benefits the socket too.
   */
  connect(): void {
    if (this.socket && (this.socket.connected || this.connecting)) return;

    const token = api.getToken?.();
    if (!token) {
      // Nothing to authenticate with yet; useAuth will call again after
      // login completes.
      return;
    }

    this.connecting = true;
    this.socket = io(env.backendUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });

    this.socket.on('connect', () => {
      this.connecting = false;
      // Re-subscribe to every room we had active. The backend assigned us
      // a new socket id; it no longer knows which rooms we care about.
      for (const classId of this.classHandlers.keys()) {
        this.emitClassSubscribe(classId);
      }
    });

    this.socket.on('disconnect', () => {
      this.connecting = false;
    });

    this.socket.on('connect_error', (err) => {
      this.connecting = false;
      console.warn('[socket] connect_error:', err?.message || err);
    });

    this.socket.on('class_state_changed', (event: ClassStateEvent) => {
      if (!event || !event.classId || !event.state) return;
      const handlers = this.classHandlers.get(event.classId);
      if (!handlers || handlers.size === 0) return;
      handlers.forEach((fn) => {
        try {
          fn(event);
        } catch (e) {
          console.warn('[socket] class handler error:', e);
        }
      });
    });

    const USER_EVENTS: UserEventName[] = [
      'new_message',
      'message_sent',
      'message_deleted',
      'reaction_updated',
      'new_notification',
      'user_typing',
      'gcal-events-updated',
      'gcal-status-updated',
    ];
    for (const evt of USER_EVENTS) {
      this.socket.on(evt, (payload: any) => this.dispatchUserEvent(evt, payload));
    }
  }

  /**
   * Tear down the active socket and forget all room subscriptions. Call on
   * logout to ensure the next user can't observe the previous user's rooms.
   */
  disconnect(): void {
    try {
      this.socket?.removeAllListeners();
      this.socket?.disconnect();
    } catch {}
    this.socket = null;
    this.connecting = false;
    this.classHandlers.clear();
    this.userEventHandlers.clear();
  }

  isConnected(): boolean {
    return !!this.socket && this.socket.connected;
  }

  /**
   * Subscribe to a class room. Returns an unsubscribe function the caller
   * must invoke on teardown (mirrors rxjs / DOM addEventListener). The
   * first handler for a given class triggers a `class:subscribe` to the
   * server; the last removed handler triggers `class:unsubscribe` so rooms
   * don't linger and flood the app with updates for screens that are gone.
   */
  subscribeToClass(classId: string, handler: ClassStateHandler): () => void {
    if (!classId || typeof handler !== 'function') return () => {};
    let set = this.classHandlers.get(classId);
    const isFirst = !set || set.size === 0;
    if (!set) {
      set = new Set<ClassStateHandler>();
      this.classHandlers.set(classId, set);
    }
    set.add(handler);

    if (isFirst) {
      // Lazy-connect on first room subscription so the socket doesn't eat
      // battery on screens that never ask for realtime.
      this.connect();
      this.emitClassSubscribe(classId);
    }

    return () => {
      const current = this.classHandlers.get(classId);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.classHandlers.delete(classId);
        if (this.socket && this.socket.connected) {
          this.socket.emit('class:unsubscribe', { classId });
        }
      }
    };
  }

  /**
   * Subscribe to a user-scoped event (`new_message`, `new_notification`, ...).
   * Returns an unsubscribe function. The server-side room (`user:{auth0Id}`)
   * is joined automatically on connect, so callers don't need to manage rooms.
   *
   * Safe to call before `connect()` — handlers are kept in the registry and
   * start firing as soon as the socket receives the event.
   */
  on(event: UserEventName, handler: UserEventHandler): () => void {
    if (!event || typeof handler !== 'function') return () => {};
    let set = this.userEventHandlers.get(event);
    if (!set) {
      set = new Set<UserEventHandler>();
      this.userEventHandlers.set(event, set);
    }
    set.add(handler);

    this.connect();

    return () => {
      const current = this.userEventHandlers.get(event);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) this.userEventHandlers.delete(event);
    };
  }

  private dispatchUserEvent(event: UserEventName, payload: any): void {
    const handlers = this.userEventHandlers.get(event);
    if (!handlers || handlers.size === 0) return;
    handlers.forEach((fn) => {
      try {
        fn(payload);
      } catch (e) {
        console.warn(`[socket] ${event} handler error:`, e);
      }
    });
  }

  private emitClassSubscribe(classId: string): void {
    if (!this.socket || !this.socket.connected) return;
    const cid = ++this.ackCounter;
    this.socket.emit('class:subscribe', { classId }, (ack: any) => {
      if (!ack || !ack.ok || !ack.state) return;
      // Replay the server-supplied initial snapshot through the normal
      // handler path so consumers have a single code path.
      const handlers = this.classHandlers.get(classId);
      if (!handlers) return;
      handlers.forEach((fn) => {
        try {
          fn(ack.state as ClassStateEvent);
        } catch (e) {
          console.warn('[socket] initial snapshot handler error:', cid, e);
        }
      });
    });
  }
}

export const socketService = new SocketService();
