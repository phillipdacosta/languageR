import SwiftUI

// MARK: - Card frame reporting
//
// We need to know, at the moment the user taps a card, exactly where that
// card is on screen (origin + size, in the coordinate space of the hosting
// screen). That rect is the starting frame for the detail view's scale
// animation. SwiftUI has no first-class way to ask "where is this view?"
// so we use the canonical PreferenceKey pattern: each CardRowView reports
// its frame up the tree via GeometryReader, and the parent reads the
// preference into a dictionary keyed by card id.
//
// Coordinate space note: we use a NAMED coordinate space (`cardSpace`)
// anchored on the ExpandingCardScreen root. That way the rects we capture
// are in the same space as the detail overlay we render on top of it.
// Using `.global` would also work but mixes in the status bar / safe area
// origin, which makes the math fiddly.

private struct CardFrameData: Equatable {
  let id: String
  let rect: CGRect
}

private struct CardFramesKey: PreferenceKey {
  static var defaultValue: [CardFrameData] = []
  static func reduce(value: inout [CardFrameData], nextValue: () -> [CardFrameData]) {
    value.append(contentsOf: nextValue())
  }
}

/**
 * SwiftUI screen implementing an Airbnb/Instagram-style hero scale
 * transition from a grid card into a full-screen detail.
 *
 * Why NOT matchedGeometryEffect?
 * -----------------------------
 * We tried matchedGeometryEffect first (see git history). The problem is
 * that it works by SWAPPING the if/else branches of a ZStack — the list
 * view is removed from the hierarchy and the detail view is inserted.
 * During that one-frame swap SwiftUI runs a cross-fade AND tries to
 * interpolate each matched child's geometry. In practice this produces:
 *   - A one-frame blank gap where neither branch is rendered.
 *   - Ghosted/semi-transparent content while the fade runs.
 *   - Text truncation ("Daniel..." instead of "Daniel K.") because the
 *     matched title element is sized mid-interpolation at a width too
 *     narrow for its string.
 * None of that is what Airbnb does. Airbnb renders the detail view at
 * FULL SIZE and applies a CGAffineTransform scale+translate to shrink it
 * into the tapped card's list slot, then animates the transform to
 * identity. The list stays visible behind the growing detail (dimmed).
 *
 * What this file does
 * -------------------
 * 1. CardList is ALWAYS rendered (never conditionally removed).
 * 2. Each CardRowView reports its on-screen rect into a preference key
 *    so the parent knows where every card sits.
 * 3. On tap, we record the tapped card's rect, mount the DetailView as
 *    an overlay at full size, and transform it (scale+offset+corner
 *    radius) so it starts out exactly matching the card's grid slot.
 * 4. Animate `openProgress` 0 → 1 with a spring. The transform, corner
 *    radius, and dim-overlay opacity are all interpolated by progress.
 * 5. On close, animate 1 → 0, then clear `selectedId` at completion so
 *    the overlay unmounts.
 */
struct ExpandingCardScreen: View {
  @ObservedObject var model: CardExpandViewModel
  // Captured on every tap: the rect of the tapped card at that moment,
  // in the `cardSpace` coordinate space.
  @State private var tappedRect: CGRect = .zero
  // 0 = fully collapsed to the card's grid slot. 1 = fully expanded to
  // the screen. Driven by a spring when `selectedId` changes.
  @State private var openProgress: CGFloat = 0
  // Running dictionary of every visible card's on-screen rect, updated
  // continuously as the user scrolls (via PreferenceKey).
  @State private var cardFrames: [String: CGRect] = [:]
  // Cached container size — snapshotted inside a GeometryReader. We
  // need it to compute the scale factor (cardFrame.width / containerSize).
  @State private var containerSize: CGSize = .zero

  // Airbnb's spring feels like a tight, slightly bouncy settle. Measured
  // against their recordings: ~0.45s total motion, under 1 cycle of bounce.
  // response=0.42, damping=0.84 reproduces this almost exactly on iPhone.
  private var openSpring: Animation {
    .spring(response: 0.42, dampingFraction: 0.84)
  }
  private var closeSpring: Animation {
    // Slightly faster on close so dismissal feels snappy (Airbnb's own
    // motion is asymmetric in the same direction — open is elegant,
    // close is brisk).
    .spring(response: 0.36, dampingFraction: 0.86)
  }

  var body: some View {
    GeometryReader { geo in
      ZStack(alignment: .topLeading) {
        backgroundColor
          .ignoresSafeArea()

        CardList(
          items: model.items,
          tintColor: model.tintColor,
          onTap: { id in
            // Look up the tapped card's current rect from our own
            // preference-synced dictionary (populated continuously as
            // the list lays out / scrolls). Doing the lookup here — in
            // the parent — means each CardRowView doesn't need to carry
            // its own @State CGRect and re-render on scroll.
            let rect = cardFrames[id] ?? .zero
            tappedRect = rect
            openProgress = 0
            model.selectedId = id
            model.onOpenDetail(id)
            // CRITICAL: mount the detail (selectedId=id, openProgress=0)
            // on THIS runloop tick, then start the spring on the NEXT
            // tick. If we called `withAnimation { openProgress = 1 }`
            // synchronously in the same tick, SwiftUI batches all the
            // state changes and renders the detail at openProgress=1
            // FULL-SCREEN on its very first frame — there's no "before
            // frame" for scaleEffect to interpolate from, so it pops in
            // instantly. Deferring by one runloop guarantees frame 1 =
            // shrunk card, frame 2+ = spring interpolating toward 1.
            DispatchQueue.main.async {
              withAnimation(openSpring) {
                openProgress = 1
              }
            }
          }
        )
        .onPreferenceChange(CardFramesKey.self) { data in
          var newMap: [String: CGRect] = [:]
          for entry in data {
            newMap[entry.id] = entry.rect
          }
          cardFrames = newMap
        }
        // Dim the list while a detail is open. This is what makes the
        // detail feel "on top" during the expand — without it, the
        // growing card looks like it's the same layer as the list.
        .overlay(
          Color.black
            .opacity(dimOpacity)
            .allowsHitTesting(openProgress > 0)
            .ignoresSafeArea()
        )

        // Detail overlay. Only mounted when a selection exists. We
        // deliberately keep CardList rendered behind it so the feed
        // stays visible through the transition (dimmed by the overlay
        // above).
        if let selected = model.selectedItem {
          let rect = resolvedRect(forId: selected.id, containerSize: geo.size)
          let scaleX = lerp(from: rect.width / max(geo.size.width, 1), to: 1, t: openProgress)
          let scaleY = lerp(from: rect.height / max(geo.size.height, 1), to: 1, t: openProgress)
          let offsetX = lerp(from: rect.minX, to: 0, t: openProgress)
          let offsetY = lerp(from: rect.minY, to: 0, t: openProgress)
          // Card corner radius (16) at closed → 0 at fully open. This
          // matches Airbnb: the detail stays visibly CARD-SHAPED
          // throughout the motion, flattening at the final frame.
          let corner = lerp(from: 16, to: 0, t: openProgress)

          DetailView(
            item: selected,
            tintColor: model.tintColor,
            onClose: closeDetail
          )
          .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
          .clipShape(RoundedRectangle(cornerRadius: corner, style: .continuous))
          // Scale first, then offset — ordering matters. We want the
          // view to shrink around its topLeading anchor, then translate
          // to the card's origin. Swapping these inverts the math.
          .scaleEffect(x: scaleX, y: scaleY, anchor: .topLeading)
          .offset(x: offsetX, y: offsetY)
          .shadow(color: .black.opacity(shadowOpacity), radius: 20, x: 0, y: 10)
          .transition(.identity)
        }
      }
      .coordinateSpace(name: Self.cardSpaceName)
      .onAppear { containerSize = geo.size }
      .onChange(of: geo.size) { newSize in
        containerSize = newSize
      }
      .onChange(of: model.selectedId) { newValue in
        // When React Native or the close handler sets selectedId to nil
        // while openProgress is still 1, we need to animate back. The
        // close handler already does this, but JS-driven closes (future)
        // won't, so we defensively animate here too.
        if newValue == nil && openProgress > 0 {
          withAnimation(closeSpring) {
            openProgress = 0
          }
        }
        if newValue == nil {
          model.applyPendingItems()
        }
      }
    }
    .preferredColorScheme(model.forcedColorScheme)
  }

  // MARK: - Helpers

  static let cardSpaceName = "BarnabiCardExpand.cardSpace"

  private var backgroundColor: Color {
    switch model.forcedColorScheme {
    case .dark: return Color.black
    default: return Color(.systemBackground)
    }
  }

  // Eased towards Airbnb's dim level. 0.35 reads as "clearly focused
  // on the growing card" without completely hiding the feed.
  private var dimOpacity: Double {
    Double(openProgress) * 0.35
  }

  // Shadow fades OUT as the detail reaches its final full-screen frame
  // — a full-screen view doesn't need a shadow. During mid-flight the
  // shadow gives the card a sense of elevation over the dimmed list.
  private var shadowOpacity: Double {
    let p = Double(openProgress)
    // Peaks around the middle of the animation and fades back to 0.
    return 0.18 * (1 - abs(p - 0.5) * 2)
  }

  /// Finds the starting rect for the current open animation. Priority:
  /// the rect captured at tap time (most accurate), fallback to the
  /// preference-key-reported rect, last resort a small centered rect.
  private func resolvedRect(forId id: String, containerSize: CGSize) -> CGRect {
    if tappedRect != .zero { return tappedRect }
    if let live = cardFrames[id] { return live }
    let w = containerSize.width * 0.8
    let h = w * 0.6
    return CGRect(x: (containerSize.width - w) / 2,
                  y: (containerSize.height - h) / 2,
                  width: w,
                  height: h)
  }

  /// Close animation + state cleanup. We animate progress back to 0
  /// FIRST, then clear selectedId in the completion so the overlay
  /// stays mounted long enough for the collapse to finish drawing.
  private func closeDetail() {
    withAnimation(closeSpring) {
      openProgress = 0
    }
    // Delay matches the spring's settling time. `selectedId = nil`
    // unmounts the overlay, so we can't do it synchronously without
    // the closing card vanishing mid-animation.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.34) {
      model.selectedId = nil
      model.onCloseDetail()
      model.applyPendingItems()
    }
  }

  private func lerp(from a: CGFloat, to b: CGFloat, t: CGFloat) -> CGFloat {
    a + (b - a) * t
  }
}

// MARK: - Card list

struct CardList: View {
  let items: [CardItemRecord]
  let tintColor: Color
  let onTap: (String) -> Void

  var body: some View {
    ScrollView {
      LazyVStack(spacing: 24) {
        ForEach(items, id: \.id) { item in
          CardRowView(item: item, tintColor: tintColor, onTap: onTap)
        }
      }
      .padding(.horizontal, 20)
      .padding(.top, 16)
      .padding(.bottom, 32)
    }
  }
}

/**
 * Collapsed grid card. Layout mirrors Airbnb's feed cards: full-width
 * hero on top at 5:4 aspect, text block below.
 *
 * The card reports its on-screen rect every layout pass via a
 * `background(GeometryReader)` trick. The reported rect is in the
 * `ExpandingCardScreen.cardSpaceName` coordinate space (set up on the
 * screen root). The parent reads these rects out of the preference
 * key to know where to start the expand animation.
 */
struct CardRowView: View {
  let item: CardItemRecord
  let tintColor: Color
  let onTap: (String) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      CardHeroImage(urlString: item.imageUrl)
        .aspectRatio(5.0 / 4.0, contentMode: .fill)
        .frame(maxWidth: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

      VStack(alignment: .leading, spacing: 4) {
        if let badge = item.badge, !badge.isEmpty {
          Text(badge)
            .font(.system(size: 11, weight: .semibold))
            .tracking(0.6)
            .foregroundStyle(tintColor)
        }
        Text(item.title)
          .font(.system(size: 17, weight: .semibold))
          .lineLimit(2)
        if let subtitle = item.subtitle, !subtitle.isEmpty {
          Text(subtitle)
            .font(.system(size: 14))
            .foregroundStyle(.secondary)
            .lineLimit(2)
        }
      }
      .padding(.horizontal, 2)
      .padding(.bottom, 2)
    }
    .background(
      GeometryReader { geo in
        // Report this card's rect in the named card space on every
        // layout pass. `.clear` so it has no visual effect; the parent
        // reads this via PreferenceKey.
        Color.clear
          .preference(
            key: CardFramesKey.self,
            value: [CardFrameData(id: item.id, rect: geo.frame(in: .named(ExpandingCardScreen.cardSpaceName)))]
          )
      }
    )
    .background(
      RoundedRectangle(cornerRadius: 16, style: .continuous)
        .fill(Color(.secondarySystemBackground))
    )
    .contentShape(Rectangle())
    .onTapGesture { onTap(item.id) }
  }
}

// MARK: - Detail view
//
// Rendered at FULL SIZE always. The parent applies scale+offset to
// shrink it into the tapped card's grid slot during open/close
// animation. So this view's body doesn't need to know anything about
// the animation; it just renders the final expanded state.

struct DetailView: View {
  let item: CardItemRecord
  let tintColor: Color
  let onClose: () -> Void

  var body: some View {
    ZStack(alignment: .topLeading) {
      Color(.systemBackground)

      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          CardHeroImage(urlString: item.imageUrl)
            .frame(maxWidth: .infinity)
            .frame(height: 360)

          VStack(alignment: .leading, spacing: 10) {
            if let badge = item.badge, !badge.isEmpty {
              Text(badge)
                .font(.system(size: 13, weight: .semibold))
                .tracking(0.8)
                .foregroundStyle(tintColor)
            }
            Text(item.title)
              .font(.system(size: 30, weight: .bold))
              .lineLimit(2)
            if let subtitle = item.subtitle, !subtitle.isEmpty {
              Text(subtitle)
                .font(.system(size: 17))
                .foregroundStyle(.secondary)
            }
          }
          .padding(.horizontal, 20)

          VStack(alignment: .leading, spacing: 14) {
            Text("Details")
              .font(.system(size: 20, weight: .semibold))
              .padding(.top, 12)
            Text("This detail body is rendered natively for the prototype. In the next step it becomes a React Native host view so the existing lesson detail content can live inside the native transition.")
              .font(.system(size: 15))
              .foregroundStyle(.secondary)
              .fixedSize(horizontal: false, vertical: true)
          }
          .padding(.horizontal, 20)
          .padding(.bottom, 80)
        }
      }

      Button(action: onClose) {
        Image(systemName: "xmark")
          .font(.system(size: 15, weight: .bold))
          .foregroundStyle(.primary)
          .frame(width: 36, height: 36)
          .background(
            Circle()
              .fill(Color(.systemBackground).opacity(0.92))
              .shadow(color: .black.opacity(0.18), radius: 6, y: 2)
          )
      }
      .padding(.top, 12)
      .padding(.leading, 16)
      .accessibilityLabel("Close")
    }
  }
}

// MARK: - Hero image

struct CardHeroImage: View {
  let urlString: String?

  var body: some View {
    if let urlString, let url = URL(string: urlString) {
      AsyncImage(url: url) { phase in
        switch phase {
        case .success(let image):
          image.resizable().aspectRatio(contentMode: .fill)
        case .failure:
          placeholder
        case .empty:
          placeholder
        @unknown default:
          placeholder
        }
      }
    } else {
      placeholder
    }
  }

  private var placeholder: some View {
    Rectangle()
      .fill(Color(.tertiarySystemBackground))
      .overlay(
        Image(systemName: "photo")
          .font(.system(size: 22, weight: .regular))
          .foregroundStyle(.tertiary)
      )
  }
}
