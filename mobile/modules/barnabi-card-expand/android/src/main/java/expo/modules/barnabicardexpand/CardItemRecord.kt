package expo.modules.barnabicardexpand

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/**
 * JS → Kotlin bridge record for a single card. Mirror of iOS's
 * `CardItemRecord.swift` and JS's `CardItem` type. Fields must stay
 * synchronized across all three; there is no shared schema.
 *
 * `Record` is Expo's equivalent of a Codable/Decodable data class. At prop
 * decode time, expo-modules-core takes the JS-side dictionary and populates
 * the `@Field`-annotated properties. Missing optional fields stay null;
 * missing non-null fields fall back to the declared default.
 */
class CardItemRecord : Record {
  @Field var id: String = ""
  @Field var title: String = ""
  @Field var subtitle: String? = null
  @Field var imageUrl: String? = null
  @Field var badge: String? = null
  @Field var accentColor: String? = null
}
