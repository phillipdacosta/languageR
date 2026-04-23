package expo.modules.barnabicardexpand

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Expo module definition for `BarnabiCardExpand` on Android.
 *
 * Registration is automatic: Expo's autolinking scans every module listed
 * in `expo-module.config.json`'s `android.modules` array and calls their
 * definitions at app startup. `requireNativeView('BarnabiCardExpand')` on
 * the JS side maps to the `Name("BarnabiCardExpand")` declared here.
 *
 * Prop updates invoked inside `Prop { }` closures run on the UI thread
 * under Fabric. We call into `BarnabiCardExpandView` setters that push
 * into a Compose state bag; Compose re-composes on the next frame. Keep
 * the code inside these closures minimal — anything expensive would block
 * the main thread during list updates.
 */
class BarnabiCardExpandModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BarnabiCardExpand")

    View(BarnabiCardExpandView::class) {
      Events("onOpenDetail", "onCloseDetail")

      /**
       * Parsing notes: Expo decodes the JS array-of-objects into a
       * `List<CardItemRecord>` via the `Record` subsystem. If an item is
       * missing a required field (id, title) we get an empty string —
       * NOT a crash — so the UI will render but show a blank row. That's
       * intentional: the animation prototype should stay visible even if
       * the caller sends slightly malformed data.
       */
      Prop("items") { view: BarnabiCardExpandView, items: List<CardItemRecord> ->
        view.setItems(items)
      }

      Prop("colorScheme") { view: BarnabiCardExpandView, scheme: String? ->
        view.setColorScheme(scheme)
      }

      Prop("tintColor") { view: BarnabiCardExpandView, tint: String? ->
        view.setTintColor(tint)
      }
    }
  }
}
