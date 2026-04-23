import ExpoModulesCore

/**
 * Expo module definition for `BarnabiCardExpand`.
 *
 * This module exposes exactly one native view (`BarnabiCardExpandView`) and
 * two events. It is auto-registered at runtime via Expo's module discovery
 * — no AppDelegate changes are needed. `requireNativeView('BarnabiCardExpand')`
 * on the JS side matches the `Name(...)` declared here.
 *
 * Everything declared in `definition()` runs at module-registration time on
 * the main thread. Prop updates (the closures inside `Prop(...)`) run on the
 * UI thread in Fabric. Event dispatches (`EventDispatcher`) are thread-safe
 * and are automatically dispatched through the RN event emitter.
 */
public class BarnabiCardExpandModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BarnabiCardExpand")

    View(BarnabiCardExpandView.self) {
      /**
       * Cards are re-decoded on every prop update. For the card list that's
       * fine — the list typically updates at most a few times per second,
       * far below our frame budget. However, we deliberately AVOID mutating
       * items while a transition is in flight (see `setItems` in the view
       * for the defensive check). Otherwise SwiftUI may try to match-geometry
       * into an id that no longer exists and fall back to a crossfade.
       */
      Prop("items") { (view: BarnabiCardExpandView, items: [CardItemRecord]) in
        view.setItems(items)
      }

      /**
       * `colorScheme` is a forced override. Pass `"light"` or `"dark"` from
       * JS to match the app's theme state regardless of the system setting.
       * If omitted or sent as nil the native view inherits from the system
       * (via SwiftUI's default `ColorScheme` environment).
       */
      Prop("colorScheme") { (view: BarnabiCardExpandView, scheme: String?) in
        view.setColorScheme(scheme)
      }

      /**
       * Hex accent color ("#RRGGBB"). Applied to the badge fill on collapsed
       * cards and to the "close" chevron on the detail view. Parsed lazily;
       * invalid strings fall back to the system accent color.
       */
      Prop("tintColor") { (view: BarnabiCardExpandView, tint: String?) in
        view.setTintColor(tint)
      }

      Events("onOpenDetail", "onCloseDetail")
    }
  }
}
