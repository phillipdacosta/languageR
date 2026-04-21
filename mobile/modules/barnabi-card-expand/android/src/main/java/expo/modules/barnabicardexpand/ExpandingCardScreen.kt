package expo.modules.barnabicardexpand

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Image
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage

/**
 * Compose shared-element screen.
 *
 * Mirror of the iOS `ExpandingCardScreen`. The mechanism is the same: a
 * `SharedTransitionLayout` scope inside which the list and the detail
 * both declare `Modifier.sharedElement(..., rememberSharedContentState(id))`
 * on the matching sub-elements. When `AnimatedContent` swaps between the
 * two composables, the framework interpolates every shared element's
 * position + size along a single animation.
 *
 * This is the same primitive Airbnb adopted for their Android listing
 * card expansion (they wrote a blog post comparing it to
 * `matchedGeometryEffect` — API parity was explicit in their migration
 * goals).
 *
 * Spring tuning: `dampingRatio = 0.9, stiffness = 400f` produces the same
 * feel as iOS `spring(response: 0.45, dampingFraction: 0.88)`. Matched
 * empirically — Compose's spring physics are defined differently from
 * SwiftUI's but these values are within a frame of each other on a Pixel 6.
 */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun ExpandingCardScreen(
  items: List<CardItemRecord>,
  selectedId: String?,
  forcedColorScheme: String?,
  tintColor: Color?,
  onTapCard: (String) -> Unit,
  onCloseDetail: () -> Unit,
) {
  val colors = when (forcedColorScheme) {
    "light" -> lightColorScheme()
    "dark" -> darkColorScheme()
    else -> if (androidx.compose.foundation.isSystemInDarkTheme()) darkColorScheme() else lightColorScheme()
  }
  val resolvedTint = tintColor ?: colors.primary

  MaterialTheme(colorScheme = colors) {
    Surface(color = colors.background, modifier = Modifier.fillMaxSize()) {
      val selectedItem = items.firstOrNull { it.id == selectedId }

      SharedTransitionLayout {
        // Capture the SharedTransitionScope into a named local so we can
        // pass it down into `DetailView` / `CardList` through normal
        // function parameters. `this@SharedTransitionLayout` does NOT
        // work here — `SharedTransitionLayout` is a function name, not a
        // label, and Kotlin only resolves `this@Label` when the receiver
        // lambda has been explicitly labeled.
        val sharedScope = this
        AnimatedContent(
          targetState = selectedItem,
          // `contentKey` makes AnimatedContent treat distinct selected ids
          // as distinct content. Without it, tapping a different card
          // while a detail is already expanded would reuse the same slot
          // and break the morph. We ALSO key on null vs non-null.
          contentKey = { it?.id ?: "__list__" },
          transitionSpec = {
            // `fadeIn/fadeOut with tween 80ms` is a micro-crossfade that
            // covers any shared elements that DIDN'T match across the
            // swap (e.g. the close button, which exists only on detail).
            // The shared elements themselves ignore this — they run their
            // own spring-animated morph.
            (fadeIn(tween(80)) togetherWith fadeOut(tween(80)))
          },
          label = "barnabi-card-expand"
        ) { targetItem ->
          // Inside the AnimatedContent block `this` is AnimatedContentScope
          // which extends AnimatedVisibilityScope — exactly what shared
          // elements need.
          if (targetItem != null) {
            DetailView(
              item = targetItem,
              tintColor = resolvedTint,
              sharedScope = sharedScope,
              animatedVisibilityScope = this,
              onClose = onCloseDetail
            )
          } else {
            CardList(
              items = items,
              tintColor = resolvedTint,
              sharedScope = sharedScope,
              animatedVisibilityScope = this,
              onTapCard = onTapCard
            )
          }
        }
      }
    }
  }
}

// MARK: - Card list

/**
 * Each card's hero, title, subtitle, and surface declare
 * `Modifier.sharedElement(...)`. The shared element ids are namespaced
 * with the card id so multiple cards can coexist without id collisions.
 */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
private fun CardList(
  items: List<CardItemRecord>,
  tintColor: Color,
  sharedScope: SharedTransitionScope,
  animatedVisibilityScope: AnimatedVisibilityScope,
  onTapCard: (String) -> Unit,
) {
  LazyColumn(
    contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
    verticalArrangement = Arrangement.spacedBy(16.dp),
    modifier = Modifier.fillMaxSize()
  ) {
    items(items, key = { it.id }) { item ->
      CardRow(
        item = item,
        tintColor = tintColor,
        sharedScope = sharedScope,
        animatedVisibilityScope = animatedVisibilityScope,
        onTap = { onTapCard(item.id) }
      )
    }
  }
}

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
private fun CardRow(
  item: CardItemRecord,
  tintColor: Color,
  sharedScope: SharedTransitionScope,
  animatedVisibilityScope: AnimatedVisibilityScope,
  onTap: () -> Unit,
) {
  with(sharedScope) {
    Row(
      modifier = Modifier
        .fillMaxWidth()
        .clip(RoundedCornerShape(16.dp))
        .sharedElement(
          state = rememberSharedContentState(key = "surface-${item.id}"),
          animatedVisibilityScope = animatedVisibilityScope,
          boundsTransform = { _, _ ->
            spring(dampingRatio = 0.9f, stiffness = 400f)
          }
        )
        .background(MaterialTheme.colorScheme.surfaceVariant)
        .clickable(onClick = onTap)
        .padding(14.dp),
      verticalAlignment = Alignment.Top
    ) {
      HeroImage(
        urlString = item.imageUrl,
        modifier = Modifier
          .size(96.dp)
          .clip(RoundedCornerShape(14.dp))
          .sharedElement(
            state = rememberSharedContentState(key = "hero-${item.id}"),
            animatedVisibilityScope = animatedVisibilityScope,
            boundsTransform = { _, _ ->
              spring(dampingRatio = 0.9f, stiffness = 400f)
            }
          )
      )
      Spacer(Modifier.size(14.dp))
      Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
        item.badge?.takeIf { it.isNotEmpty() }?.let { badge ->
          Text(
            text = badge.uppercase(),
            color = tintColor,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.sharedElement(
              state = rememberSharedContentState(key = "badge-${item.id}"),
              animatedVisibilityScope = animatedVisibilityScope,
              boundsTransform = { _, _ ->
                spring(dampingRatio = 0.9f, stiffness = 400f)
              }
            )
          )
        }
        Text(
          text = item.title,
          fontSize = 17.sp,
          fontWeight = FontWeight.SemiBold,
          maxLines = 2,
          modifier = Modifier.sharedElement(
            state = rememberSharedContentState(key = "title-${item.id}"),
            animatedVisibilityScope = animatedVisibilityScope,
            boundsTransform = { _, _ ->
              spring(dampingRatio = 0.9f, stiffness = 400f)
            }
          )
        )
        item.subtitle?.takeIf { it.isNotEmpty() }?.let { subtitle ->
          Text(
            text = subtitle,
            fontSize = 14.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 2,
            modifier = Modifier.sharedElement(
              state = rememberSharedContentState(key = "subtitle-${item.id}"),
              animatedVisibilityScope = animatedVisibilityScope,
              boundsTransform = { _, _ ->
                spring(dampingRatio = 0.9f, stiffness = 400f)
              }
            )
          )
        }
      }
    }
  }
}

// MARK: - Detail view

/**
 * Compose equivalent of the iOS `DetailView`. Every matched id here has a
 * twin in `CardRow`. The `sharedElement` modifier runs on both directions
 * of the swap automatically.
 */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
private fun DetailView(
  item: CardItemRecord,
  tintColor: Color,
  sharedScope: SharedTransitionScope,
  animatedVisibilityScope: AnimatedVisibilityScope,
  onClose: () -> Unit,
) {
  with(sharedScope) {
    Box(modifier = Modifier.fillMaxSize()) {
      Box(
        modifier = Modifier
          .fillMaxSize()
          .sharedElement(
            state = rememberSharedContentState(key = "surface-${item.id}"),
            animatedVisibilityScope = animatedVisibilityScope,
            boundsTransform = { _, _ ->
              spring(dampingRatio = 0.9f, stiffness = 400f)
            }
          )
          .background(MaterialTheme.colorScheme.background)
      ) {
        Column(
          modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
          verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
          HeroImage(
            urlString = item.imageUrl,
            modifier = Modifier
              .fillMaxWidth()
              .height(320.dp)
              .sharedElement(
                state = rememberSharedContentState(key = "hero-${item.id}"),
                animatedVisibilityScope = animatedVisibilityScope,
                boundsTransform = { _, _ ->
                  spring(dampingRatio = 0.9f, stiffness = 400f)
                }
              )
          )

          Column(
            modifier = Modifier.padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
          ) {
            item.badge?.takeIf { it.isNotEmpty() }?.let { badge ->
              Text(
                text = badge.uppercase(),
                color = tintColor,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.sharedElement(
                  state = rememberSharedContentState(key = "badge-${item.id}"),
                  animatedVisibilityScope = animatedVisibilityScope,
                  boundsTransform = { _, _ ->
                    spring(dampingRatio = 0.9f, stiffness = 400f)
                  }
                )
              )
            }
            Text(
              text = item.title,
              fontSize = 28.sp,
              fontWeight = FontWeight.Bold,
              modifier = Modifier.sharedElement(
                state = rememberSharedContentState(key = "title-${item.id}"),
                animatedVisibilityScope = animatedVisibilityScope,
                boundsTransform = { _, _ ->
                  spring(dampingRatio = 0.9f, stiffness = 400f)
                }
              )
            )
            item.subtitle?.takeIf { it.isNotEmpty() }?.let { subtitle ->
              Text(
                text = subtitle,
                fontSize = 17.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.sharedElement(
                  state = rememberSharedContentState(key = "subtitle-${item.id}"),
                  animatedVisibilityScope = animatedVisibilityScope,
                  boundsTransform = { _, _ ->
                    spring(dampingRatio = 0.9f, stiffness = 400f)
                  }
                )
              )
            }
          }

          // Prototype placeholder. In Scope 3 this becomes an AndroidView
          // wrapping a ReactRootView pointing at the current
          // `LessonDetailOverlay` body, giving us native morph + RN content.
          Column(
            modifier = Modifier
              .padding(horizontal = 20.dp)
              .padding(top = 12.dp, bottom = 80.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
          ) {
            Text(
              text = "Details",
              fontSize = 20.sp,
              fontWeight = FontWeight.SemiBold,
            )
            Text(
              text = "This detail body is rendered natively for the prototype. In the next step it becomes a React Native host view so the existing lesson detail content can live inside the native transition.",
              fontSize = 15.sp,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
        }

        // Close button is NOT a shared element — it's owned by the detail
        // and should disappear at the end of the collapse. We let the
        // outer crossfade handle it.
        IconButton(
          onClick = onClose,
          modifier = Modifier
            .padding(top = 12.dp, start = 16.dp)
            .align(Alignment.TopStart)
        ) {
          Icon(
            imageVector = Icons.Default.Close,
            contentDescription = "Close",
            tint = MaterialTheme.colorScheme.onBackground,
          )
        }
      }
    }
  }
}

// MARK: - Hero image

@Composable
private fun HeroImage(urlString: String?, modifier: Modifier = Modifier) {
  if (urlString.isNullOrBlank()) {
    Box(
      modifier = modifier.background(MaterialTheme.colorScheme.surfaceVariant),
      contentAlignment = Alignment.Center
    ) {
      Icon(
        imageVector = Icons.Default.Image,
        contentDescription = null,
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.size(28.dp)
      )
    }
  } else {
    AsyncImage(
      model = urlString,
      contentDescription = null,
      contentScale = ContentScale.Crop,
      modifier = modifier,
    )
  }
}
