import ExpoModulesCore

/**
 * JS → Swift bridge record for a single card. Expo Modules Core maps JS
 * dictionaries onto these `Record` types at prop decode time. Fields declared
 * with `@Field` are read from the matching JS key; absent optional fields
 * decode to `nil`, absent required fields fall back to the `= ""` default.
 *
 * If you add a field here you must also add it to `CardItem` in the
 * module's `index.tsx` and to the Kotlin `CardItemRecord.kt`. All three must
 * stay in sync; there is no code-gen yet for this module.
 */
struct CardItemRecord: Record, Identifiable {
  @Field var id: String = ""
  @Field var title: String = ""
  @Field var subtitle: String?
  @Field var imageUrl: String?
  @Field var badge: String?
  @Field var accentColor: String?
}
