package expo.modules.barnabicardexpand

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/**
 * Bridge between the Fabric view hierarchy and the Compose
 * `ExpandingCardScreen`. Owns a single `ComposeView` as its only child.
 *
 * Prop setters push into reactive Compose `State<T>` properties. The
 * Compose tree reads those states inside `setContent { }` so every prop
 * update triggers a recomposition with no manual invalidation. This mirrors
 * how the SwiftUI side uses an `ObservableObject` — same architecture, same
 * thread semantics.
 *
 * A note on the pending-items queue: we deliberately delay item updates
 * that arrive while the detail is open AND the currently-selected id is
 * about to be removed. If we applied them immediately, Compose's
 * SharedTransitionLayout would lose its target and crossfade — the exact
 * bug we're replacing.
 */
class BarnabiCardExpandView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  /** Dispatched with `{ id }` at the instant the user taps a card. */
  val onOpenDetail by EventDispatcher<Map<String, Any?>>()
  /** Dispatched with `{}` at the instant the detail dismisses. */
  val onCloseDetail by EventDispatcher<Map<String, Any?>>()

  // Compose state bag. Any mutation triggers a recomposition of the subtree
  // that reads it. All mutations MUST happen on the main thread — Expo's
  // prop setters already run there, and our event callbacks bounce back to
  // the main thread via the Compose effect system.
  internal var itemsState by mutableStateOf<List<CardItemRecord>>(emptyList())
  internal var selectedIdState by mutableStateOf<String?>(null)
  internal var forcedColorSchemeState by mutableStateOf<String?>(null)
  internal var tintColorState by mutableStateOf<Color?>(null)

  /** Parked update, applied when the detail collapses. See `setItems`. */
  private var pendingItems: List<CardItemRecord>? = null

  init {
    addView(
      ComposeView(context).apply {
        // Fabric view hosts do not always expose a LifecycleOwner via the
        // ViewTree. Without an explicit composition strategy, Compose can
        // crash with "ViewTreeLifecycleOwner not found" when the parent
        // navigator recycles us. `DisposeOnDetachedFromWindow` ties the
        // composition lifetime directly to our own view attachment, which
        // is always well-defined under Fabric.
        setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnDetachedFromWindow)
        setContent {
          ExpandingCardScreen(
            items = itemsState,
            selectedId = selectedIdState,
            forcedColorScheme = forcedColorSchemeState,
            tintColor = tintColorState,
            onTapCard = { id ->
              onOpenDetail(mapOf("id" to id))
              selectedIdState = id
            },
            onCloseDetail = {
              onCloseDetail(emptyMap())
              selectedIdState = null
              applyPendingItems()
            }
          )
        }
      }
    )
  }

  fun setItems(items: List<CardItemRecord>) {
    val selectedId = selectedIdState
    val newIds = items.map { it.id }.toHashSet()
    if (selectedId != null && selectedId !in newIds) {
      // Detail is open and this update would remove its target. Park it.
      pendingItems = items
    } else {
      itemsState = items
      pendingItems = null
    }
  }

  fun setColorScheme(scheme: String?) {
    forcedColorSchemeState = when (scheme) {
      "light", "dark" -> scheme
      else -> null
    }
  }

  fun setTintColor(hex: String?) {
    tintColorState = hex?.let { parseHexColor(it) }
  }

  private fun applyPendingItems() {
    pendingItems?.let { items ->
      itemsState = items
      pendingItems = null
    }
  }

  /**
   * Parses `"#RRGGBB"` or `"#RRGGBBAA"` into a Compose `Color`. Returns
   * null on malformed input so the caller can fall back to the theme accent.
   */
  private fun parseHexColor(input: String): Color? {
    val trimmed = input.trim().removePrefix("#")
    return try {
      when (trimmed.length) {
        6 -> Color(android.graphics.Color.parseColor("#$trimmed"))
        8 -> {
          // Android's parseColor expects #AARRGGBB; JS sends #RRGGBBAA.
          val rgb = trimmed.substring(0, 6)
          val a = trimmed.substring(6, 8)
          Color(android.graphics.Color.parseColor("#$a$rgb"))
        }
        else -> null
      }
    } catch (e: IllegalArgumentException) {
      null
    }
  }
}
