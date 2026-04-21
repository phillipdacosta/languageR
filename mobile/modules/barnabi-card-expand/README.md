# barnabi-card-expand

Local Expo module that implements a native shared-element card expand —
the exact primitive Airbnb uses in production for their listing detail
transition.

- **iOS**: SwiftUI `matchedGeometryEffect` inside a `UIHostingController`.
- **Android**: Jetpack Compose `SharedTransitionLayout` +
  `Modifier.sharedElement` inside a `ComposeView`.
- **JS**: exposed as `<BarnabiCardExpandView />` via Expo's
  `requireNativeView`, fully Fabric-compatible.

This is a **prototype for Scope 1** — the native view renders its own list
AND its own detail body. That lets us evaluate the motion feel before
committing to Scope 3 (swap the native detail body for a React Native
child view so the existing lesson detail content can live inside the
native morph).

## Why this exists

Our existing React Native overlay pattern (`LessonDetailOverlay.tsx`)
cannot match Airbnb's motion because it is an architectural mismatch:
the overlay is a DIFFERENT view from the source card, so JS has to
measure card frames, construct a clone, interpolate its frame manually,
and coordinate unmount/remount with the source. Every seam becomes a
potential "flash" or "fade back in" glitch.

Native shared-element APIs don't have seams. Both the list and the detail
are just two layouts of the SAME conceptual view; the framework
interpolates every matched sub-element's frame across the swap on a single
animation. That's what Airbnb uses.

## Files

```
modules/barnabi-card-expand/
├── expo-module.config.json       # declares iOS + Android module classes
├── package.json                  # local package metadata
├── index.tsx                     # JS entry (exports BarnabiCardExpandView)
├── ios/
│   ├── BarnabiCardExpand.podspec
│   ├── BarnabiCardExpandModule.swift   # Expo module definition
│   ├── BarnabiCardExpandView.swift     # ExpoView → UIHostingController host
│   ├── CardItemRecord.swift            # JS→Swift bridge record
│   └── ExpandingCardScreen.swift       # SwiftUI list + detail + morph
└── android/
    ├── build.gradle                    # Compose + Coil deps, Kotlin plugin
    └── src/main/java/expo/modules/barnabicardexpand/
        ├── BarnabiCardExpandModule.kt  # Expo module definition
        ├── BarnabiCardExpandView.kt    # ExpoView → ComposeView host
        ├── CardItemRecord.kt           # JS→Kotlin bridge record
        └── ExpandingCardScreen.kt      # Compose list + detail + morph
```

## How to build & run

This is a local Expo module. Expo autolinking discovers it automatically
on the next native build. You do NOT need to edit `AppDelegate.swift`,
`MainApplication.kt`, `Podfile`, or `settings.gradle`.

### iOS

```bash
cd mobile/ios
pod install          # picks up BarnabiCardExpand.podspec
cd ..
npx expo run:ios     # or open ios/BarnabiDev.xcworkspace in Xcode and Run
```

### Android

```bash
cd mobile
npx expo run:android
```

The first Android build will be slower than usual — Gradle needs to pull
Compose + Coil artifacts and configure the Compose compiler plugin.

## How to test the demo

1. Launch the app in dev mode.
2. Go to the **Lessons** tab.
3. Tap the **"Native"** button (flask icon, next to "Filters") in the
   list header. It is visible only when `__DEV__` is true.
4. A fullscreen modal opens, rendering the first 20 lessons through the
   native module.
5. Tap any card — the native shared-element transition takes over. The
   hero image, badge, title, and subtitle all morph to their detail
   positions along a single spring.
6. Tap the close button to reverse the morph.

For comparison: closing the modal and tapping a card normally will
still go through the existing `LessonDetailOverlay.tsx`, so you can
A/B the two side-by-side in the same session.

## Prop reference

| Prop         | Type                              | Notes |
| ------------ | --------------------------------- | ----- |
| `items`      | `CardItem[]`                      | Array of collapsed-card content. |
| `colorScheme`| `'light' \| 'dark'` (optional)    | Forces theme; omit to inherit system. |
| `tintColor`  | `string` (optional)               | Hex `#RRGGBB` accent for badges/CTA. |
| `onOpenDetail` | `(e: { nativeEvent: { id }}) => void` | Fires when user taps a card. |
| `onCloseDetail` | `(e: { nativeEvent: {} }) => void`  | Fires when detail is dismissed. |

## Known limits (by design, for Scope 1)

- The detail body is a native placeholder, not your real lesson detail.
- No RN gesture integration — closing uses the native close button only.
- Items list is capped to 20 in the demo caller for easy scrolling.

Scope 3 will lift all three.
