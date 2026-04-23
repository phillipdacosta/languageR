import { requireNativeView } from 'expo';
import * as React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

/**
 * Minimal card shape required by the native card-expand view.
 *
 * Why this is small: the point of this module is to prove the shared-element
 * transition (the MOTION). The detail page in this prototype is rendered
 * entirely natively (SwiftUI / Jetpack Compose), not by bridging React Native
 * children. Keeping the payload tiny makes the JS↔native serialization cost
 * trivial and sidesteps a whole class of prop-update timing bugs during the
 * animation's critical first frames.
 *
 * If/when we move to Scope 3 (native transition + RN detail content), we'll
 * add an `onDetailRequestContent` event and mount a React subtree inside the
 * morphing native container via UIViewRepresentable (iOS) / AndroidView
 * (Android). This type will remain the source of truth for the card LIST
 * item content; only the detail body will move to RN.
 */
export type CardItem = {
  id: string;
  title: string;
  subtitle?: string;
  /** Optional image URL rendered as the card's hero. Used as the shared element target. */
  imageUrl?: string;
  /** Optional short badge shown above the title (e.g. "TODAY", "TOMORROW"). */
  badge?: string;
  /** Optional hex accent color ("#RRGGBB") used for the badge fill and CTA tint. */
  accentColor?: string;
};

export type BarnabiCardExpandViewProps = {
  items: CardItem[];
  /** Forces the native color scheme. Defaults to the system setting if omitted. */
  colorScheme?: 'light' | 'dark';
  /** Global tint color ("#RRGGBB") — falls back to iOS/Android system tint. */
  tintColor?: string;
  /** Fired when a card is tapped and the native expand animation BEGINS. */
  onOpenDetail?: (event: { nativeEvent: { id: string } }) => void;
  /** Fired when the user dismisses the detail and the collapse animation BEGINS. */
  onCloseDetail?: (event: { nativeEvent: Record<string, never> }) => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * `requireNativeView` is Expo's Fabric-aware bridge helper. It returns a React
 * component backed by the native view whose `Name("BarnabiCardExpand")` was
 * declared in the Swift / Kotlin module definitions. The second argument is
 * optional and only needed when the module declares multiple views (we have
 * one, so we omit it).
 *
 * On the New Architecture (Fabric — enabled in this app via `newArchEnabled:
 * true`), this renders directly via Fabric's renderer without going through
 * the legacy bridge. Prop updates are applied on the UI thread. That's
 * essential for shared-element animations: if prop updates round-tripped
 * through the JS bridge they could desynchronize with the animation frames.
 */
const NativeView = requireNativeView<BarnabiCardExpandViewProps>('BarnabiCardExpand');

export default function BarnabiCardExpandView(props: BarnabiCardExpandViewProps) {
  return <NativeView {...props} />;
}
