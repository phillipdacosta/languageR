import ExpoModulesCore
import SwiftUI
import UIKit

/**
 * Bridge layer between the RN Fabric view hierarchy and our SwiftUI screen.
 *
 * `ExpoView` is a `UIView` subclass Expo provides for view modules. We host
 * the SwiftUI screen inside a `UIHostingController` and attach its root view
 * to `self` with Auto Layout. All JS prop updates funnel into a single
 * `ObservableObject` (`CardExpandViewModel`) that SwiftUI observes — this
 * keeps the SwiftUI side free of any imperative mutation and lets the
 * framework coalesce updates across the same runloop.
 *
 * The `onOpenDetail` and `onCloseDetail` event dispatchers are wired to the
 * model's callback closures; SwiftUI invokes them at the moment the user
 * taps a card or dismisses the detail (BEFORE the animation completes), so
 * the JS side can start preparing detail content in parallel with the
 * native expand animation.
 */
class BarnabiCardExpandView: ExpoView {
  /// Dispatched with `{ id: String }` when the user taps a card. Fires at
  /// the same instant the native expand animation begins.
  let onOpenDetail = EventDispatcher()
  /// Dispatched with `{}` when the detail view is dismissed. Fires at the
  /// instant the collapse animation begins.
  let onCloseDetail = EventDispatcher()

  /// Single source of truth for all SwiftUI-driven state. Props push into
  /// this from `setItems` / `setColorScheme` / `setTintColor`; user
  /// interactions push into it via the closures assigned in `init`.
  private let model = CardExpandViewModel()

  /// Hosting controller is created eagerly because `ExpoView` may not be
  /// attached to a window at init time on some RN bridging paths; creating
  /// the SwiftUI root late can leak reference cycles through `self`.
  private var hostingController: UIHostingController<ExpandingCardScreen>!

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    // Wire model → events. These closures run on the main thread (SwiftUI
    // guarantees it) so we can call the event dispatchers directly.
    model.onOpenDetail = { [weak self] id in
      self?.onOpenDetail(["id": id])
    }
    model.onCloseDetail = { [weak self] in
      self?.onCloseDetail([:])
    }

    let screen = ExpandingCardScreen(model: model)
    hostingController = UIHostingController(rootView: screen)
    // Transparent hosting background — the SwiftUI screen paints its own
    // background (including theme-aware surface colors). If we let the
    // hosting controller default to system background, the transition's
    // first frame would flash whatever UIKit considers "systemBackground"
    // before SwiftUI renders, which is jarring on dark mode.
    hostingController.view.backgroundColor = .clear
    hostingController.view.translatesAutoresizingMaskIntoConstraints = false

    addSubview(hostingController.view)
    NSLayoutConstraint.activate([
      hostingController.view.topAnchor.constraint(equalTo: topAnchor),
      hostingController.view.bottomAnchor.constraint(equalTo: bottomAnchor),
      hostingController.view.leadingAnchor.constraint(equalTo: leadingAnchor),
      hostingController.view.trailingAnchor.constraint(equalTo: trailingAnchor),
    ])
  }

  /**
   * Replace the card list. If a detail is currently open and the selected
   * card's id is NOT in the new list, we defer the update until after the
   * collapse animation completes — otherwise matchedGeometryEffect loses
   * its target mid-transition and SwiftUI falls back to a crossfade (which
   * looks exactly like the "content fades back in" bug we're trying to
   * eliminate with this module).
   */
  func setItems(_ items: [CardItemRecord]) {
    let newIds = Set(items.map { $0.id })
    if let currentlySelected = model.selectedId, !newIds.contains(currentlySelected) {
      // Park the update until the user dismisses.
      model.pendingItems = items
    } else {
      model.items = items
      model.pendingItems = nil
    }
  }

  /**
   * Forces a color scheme (`"light"` / `"dark"`) or clears the override.
   * Any other string (including nil) means "inherit system".
   */
  func setColorScheme(_ scheme: String?) {
    switch scheme {
    case "light": model.forcedColorScheme = .light
    case "dark":  model.forcedColorScheme = .dark
    default:      model.forcedColorScheme = nil
    }
  }

  /**
   * Parses a `"#RRGGBB"` hex into a SwiftUI `Color`. The 8-char `#RRGGBBAA`
   * variant is supported too. On any parse failure we clear the override
   * so the view falls back to the system accent.
   */
  func setTintColor(_ hex: String?) {
    model.tintColor = hex.flatMap(Color.init(hexString:)) ?? .accentColor
  }
}

/**
 * Observable bag owned by the ExpoView and observed by `ExpandingCardScreen`.
 * Keeping props/state out of `@State` in SwiftUI and into an external
 * `ObservableObject` is deliberate: it lets UIKit-side code (prop setters,
 * event dispatchers) mutate the same source of truth the SwiftUI tree is
 * reading from. If we used `@State` in the SwiftUI view, we'd need a
 * re-entrant bridge to push updates in — ugly and race-prone.
 */
class CardExpandViewModel: ObservableObject {
  @Published var items: [CardItemRecord] = []
  @Published var selectedId: String?
  @Published var forcedColorScheme: ColorScheme?
  @Published var tintColor: Color = .accentColor

  /// Parked items waiting for the current detail to collapse (see `setItems`).
  var pendingItems: [CardItemRecord]?

  var onOpenDetail: (String) -> Void = { _ in }
  var onCloseDetail: () -> Void = {}

  /// Convenience: resolves `selectedId` into the matching item. Returns nil
  /// if nothing is selected OR if the selected id is no longer in `items`
  /// (which would be a bug but we guard anyway to avoid crashes).
  var selectedItem: CardItemRecord? {
    guard let id = selectedId else { return nil }
    return items.first(where: { $0.id == id })
  }

  /// Apply any parked item list once the detail collapses. Called from the
  /// SwiftUI side at the completion of the close transition.
  func applyPendingItems() {
    if let pending = pendingItems {
      items = pending
      pendingItems = nil
    }
  }
}

// MARK: - Color(hex:) helper

extension Color {
  /**
   * Parses `"#RRGGBB"` or `"#RRGGBBAA"` into a SwiftUI `Color`. Returns nil
   * for any malformed input. Intentionally does not support named colors
   * ("#blue" etc.) — we only want hex.
   */
  init?(hexString: String) {
    let scanner = Scanner(string: hexString.trimmingCharacters(in: .whitespacesAndNewlines))
    scanner.currentIndex = scanner.string.startIndex
    if scanner.string.first == "#" {
      scanner.currentIndex = scanner.string.index(after: scanner.string.startIndex)
    }
    var value: UInt64 = 0
    guard scanner.scanHexInt64(&value) else { return nil }
    let length = scanner.string.count - (scanner.string.first == "#" ? 1 : 0)
    switch length {
    case 6:
      let r = Double((value >> 16) & 0xFF) / 255.0
      let g = Double((value >> 8) & 0xFF) / 255.0
      let b = Double(value & 0xFF) / 255.0
      self = Color(.sRGB, red: r, green: g, blue: b, opacity: 1)
    case 8:
      let r = Double((value >> 24) & 0xFF) / 255.0
      let g = Double((value >> 16) & 0xFF) / 255.0
      let b = Double((value >> 8) & 0xFF) / 255.0
      let a = Double(value & 0xFF) / 255.0
      self = Color(.sRGB, red: r, green: g, blue: b, opacity: a)
    default:
      return nil
    }
  }
}
