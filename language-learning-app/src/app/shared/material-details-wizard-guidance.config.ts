import { WizardGuidanceItem } from './models/wizard-step-guidance.model';

const G = 'CREATE_MATERIAL.WIZARD_GUIDANCE';

export type MaterialDetailsWizardStepId =
  | 'title'
  | 'description'
  | 'whyTake'
  | 'languageLevel'
  | 'tags'
  | 'customTopics'
  | 'thumbnail'
  | 'videoUrl'
  | 'readingPassage'
  | 'listeningAudio'
  | 'price';

export const MATERIAL_DETAILS_WIZARD_GUIDANCE: Record<MaterialDetailsWizardStepId, WizardGuidanceItem[]> = {
  title: [
    { titleKey: `${G}.TITLE.ITEM1_TITLE`, descKey: `${G}.TITLE.ITEM1_DESC`, icon: 'sparkles-outline', iconModifier: 'star' },
    { titleKey: `${G}.TITLE.ITEM2_TITLE`, descKey: `${G}.TITLE.ITEM2_DESC`, icon: 'search-outline', iconModifier: 'light' },
    { titleKey: `${G}.TITLE.ITEM3_TITLE`, descKey: `${G}.TITLE.ITEM3_DESC`, icon: 'eye-outline', iconModifier: 'trust' },
  ],
  description: [
    { titleKey: `${G}.DESCRIPTION.ITEM1_TITLE`, descKey: `${G}.DESCRIPTION.ITEM1_DESC`, icon: 'document-text-outline', iconModifier: 'trust' },
    { titleKey: `${G}.DESCRIPTION.ITEM2_TITLE`, descKey: `${G}.DESCRIPTION.ITEM2_DESC`, icon: 'bulb-outline', iconModifier: 'light' },
    { titleKey: `${G}.DESCRIPTION.ITEM3_TITLE`, descKey: `${G}.DESCRIPTION.ITEM3_DESC`, icon: 'time-outline', iconModifier: 'quick' },
  ],
  whyTake: [
    { titleKey: `${G}.WHY_TAKE.ITEM1_TITLE`, descKey: `${G}.WHY_TAKE.ITEM1_DESC`, icon: 'megaphone-outline', iconModifier: 'star' },
    { titleKey: `${G}.WHY_TAKE.ITEM2_TITLE`, descKey: `${G}.WHY_TAKE.ITEM2_DESC`, icon: 'card-outline', iconModifier: 'trust' },
    { titleKey: `${G}.WHY_TAKE.ITEM3_TITLE`, descKey: `${G}.WHY_TAKE.ITEM3_DESC`, icon: 'pencil-outline', iconModifier: 'light' },
  ],
  languageLevel: [
    { titleKey: `${G}.LANGUAGE_LEVEL.ITEM1_TITLE`, descKey: `${G}.LANGUAGE_LEVEL.ITEM1_DESC`, icon: 'globe-outline', iconModifier: 'trust' },
    { titleKey: `${G}.LANGUAGE_LEVEL.ITEM2_TITLE`, descKey: `${G}.LANGUAGE_LEVEL.ITEM2_DESC`, icon: 'bar-chart-outline', iconModifier: 'cert' },
    { titleKey: `${G}.LANGUAGE_LEVEL.ITEM3_TITLE`, descKey: `${G}.LANGUAGE_LEVEL.ITEM3_DESC`, icon: 'people-outline', iconModifier: 'face' },
  ],
  tags: [
    { titleKey: `${G}.TAGS.ITEM1_TITLE`, descKey: `${G}.TAGS.ITEM1_DESC`, icon: 'pricetag-outline', iconModifier: 'light' },
    { titleKey: `${G}.TAGS.ITEM2_TITLE`, descKey: `${G}.TAGS.ITEM2_DESC`, icon: 'search-outline', iconModifier: 'trust' },
    { titleKey: `${G}.TAGS.ITEM3_TITLE`, descKey: `${G}.TAGS.ITEM3_DESC`, icon: 'options-outline', iconModifier: 'quick' },
  ],
  customTopics: [
    { titleKey: `${G}.CUSTOM_TOPICS.ITEM1_TITLE`, descKey: `${G}.CUSTOM_TOPICS.ITEM1_DESC`, icon: 'add-circle-outline', iconModifier: 'quick' },
    { titleKey: `${G}.CUSTOM_TOPICS.ITEM2_TITLE`, descKey: `${G}.CUSTOM_TOPICS.ITEM2_DESC`, icon: 'key-outline', iconModifier: 'light' },
    { titleKey: `${G}.CUSTOM_TOPICS.ITEM3_TITLE`, descKey: `${G}.CUSTOM_TOPICS.ITEM3_DESC`, icon: 'ribbon-outline', iconModifier: 'cert' },
  ],
  thumbnail: [
    { titleKey: `${G}.THUMBNAIL.ITEM1_TITLE`, descKey: `${G}.THUMBNAIL.ITEM1_DESC`, icon: 'image-outline', iconModifier: 'star' },
    { titleKey: `${G}.THUMBNAIL.ITEM2_TITLE`, descKey: `${G}.THUMBNAIL.ITEM2_DESC`, icon: 'crop-outline', iconModifier: 'light' },
    { titleKey: `${G}.THUMBNAIL.ITEM3_TITLE`, descKey: `${G}.THUMBNAIL.ITEM3_DESC`, icon: 'eye-outline', iconModifier: 'trust' },
  ],
  videoUrl: [
    { titleKey: `${G}.VIDEO_URL.ITEM1_TITLE`, descKey: `${G}.VIDEO_URL.ITEM1_DESC`, icon: 'logo-youtube', iconModifier: 'light' },
    { titleKey: `${G}.VIDEO_URL.ITEM2_TITLE`, descKey: `${G}.VIDEO_URL.ITEM2_DESC`, icon: 'play-circle-outline', iconModifier: 'quick' },
    { titleKey: `${G}.VIDEO_URL.ITEM3_TITLE`, descKey: `${G}.VIDEO_URL.ITEM3_DESC`, icon: 'shield-checkmark-outline', iconModifier: 'secure' },
  ],
  readingPassage: [
    { titleKey: `${G}.READING_PASSAGE.ITEM1_TITLE`, descKey: `${G}.READING_PASSAGE.ITEM1_DESC`, icon: 'book-outline', iconModifier: 'trust' },
    { titleKey: `${G}.READING_PASSAGE.ITEM2_TITLE`, descKey: `${G}.READING_PASSAGE.ITEM2_DESC`, icon: 'text-outline', iconModifier: 'light' },
    { titleKey: `${G}.READING_PASSAGE.ITEM3_TITLE`, descKey: `${G}.READING_PASSAGE.ITEM3_DESC`, icon: 'school-outline', iconModifier: 'cert' },
  ],
  listeningAudio: [
    { titleKey: `${G}.LISTENING_AUDIO.ITEM1_TITLE`, descKey: `${G}.LISTENING_AUDIO.ITEM1_DESC`, icon: 'headset-outline', iconModifier: 'light' },
    { titleKey: `${G}.LISTENING_AUDIO.ITEM2_TITLE`, descKey: `${G}.LISTENING_AUDIO.ITEM2_DESC`, icon: 'musical-notes-outline', iconModifier: 'light' },
    { titleKey: `${G}.LISTENING_AUDIO.ITEM3_TITLE`, descKey: `${G}.LISTENING_AUDIO.ITEM3_DESC`, icon: 'volume-high-outline', iconModifier: 'quick' },
  ],
  price: [
    { titleKey: `${G}.PRICE.ITEM1_TITLE`, descKey: `${G}.PRICE.ITEM1_DESC`, icon: 'card-outline', iconModifier: 'payout' },
    { titleKey: `${G}.PRICE.ITEM2_TITLE`, descKey: `${G}.PRICE.ITEM2_DESC`, icon: 'cash-outline', iconModifier: 'star' },
    { titleKey: `${G}.PRICE.ITEM3_TITLE`, descKey: `${G}.PRICE.ITEM3_DESC`, icon: 'refresh-outline', iconModifier: 'light' },
  ],
};

const P = 'CREATE_MATERIAL.WIZARD_GUIDANCE.PRICING';

export const MATERIAL_PRICING_WIZARD_GUIDANCE: WizardGuidanceItem[] = [
  { titleKey: `${P}.ITEM1_TITLE`, descKey: `${P}.ITEM1_DESC`, icon: 'gift-outline', iconModifier: 'face' },
  { titleKey: `${P}.ITEM2_TITLE`, descKey: `${P}.ITEM2_DESC`, icon: 'card-outline', iconModifier: 'paid' },
  { titleKey: `${P}.ITEM3_TITLE`, descKey: `${P}.ITEM3_DESC`, icon: 'people-outline', iconModifier: 'trust' },
];

const Q = 'CREATE_MATERIAL.WIZARD_GUIDANCE.QUIZ';

export const MATERIAL_QUIZ_WIZARD_GUIDANCE: WizardGuidanceItem[] = [
  { titleKey: `${Q}.ITEM1_TITLE`, descKey: `${Q}.ITEM1_DESC`, icon: 'create-outline', iconModifier: 'light' },
  { titleKey: `${Q}.ITEM2_TITLE`, descKey: `${Q}.ITEM2_DESC`, icon: 'checkmark-circle-outline', iconModifier: 'trust' },
  { titleKey: `${Q}.ITEM3_TITLE`, descKey: `${Q}.ITEM3_DESC`, icon: 'bulb-outline', iconModifier: 'star' },
];

const R = 'CREATE_MATERIAL.WIZARD_GUIDANCE.PREVIEW';

export const MATERIAL_PREVIEW_WIZARD_GUIDANCE: WizardGuidanceItem[] = [
  { titleKey: `${R}.ITEM1_TITLE`, descKey: `${R}.ITEM1_DESC`, icon: 'eye-outline', iconModifier: 'light' },
  { titleKey: `${R}.ITEM2_TITLE`, descKey: `${R}.ITEM2_DESC`, icon: 'document-text-outline', iconModifier: 'trust' },
  { titleKey: `${R}.ITEM3_TITLE`, descKey: `${R}.ITEM3_DESC`, icon: 'shield-checkmark-outline', iconModifier: 'secure' },
];

export type BundleWizardStepId =
  | 'bundleShare'
  | 'bundleTitle'
  | 'bundleDescription'
  | 'bundleMaterials'
  | 'bundleCover'
  | 'bundleLanguageLevel'
  | 'bundleTags'
  | 'bundlePrice';

const B = 'CREATE_MATERIAL.WIZARD_GUIDANCE';

export const BUNDLE_WIZARD_GUIDANCE: Record<BundleWizardStepId, WizardGuidanceItem[]> = {
  bundleShare: [
    { titleKey: `${B}.BUNDLE_SHARE.ITEM1_TITLE`, descKey: `${B}.BUNDLE_SHARE.ITEM1_DESC`, icon: 'gift-outline', iconModifier: 'face' },
    { titleKey: `${B}.BUNDLE_SHARE.ITEM2_TITLE`, descKey: `${B}.BUNDLE_SHARE.ITEM2_DESC`, icon: 'card-outline', iconModifier: 'paid' },
    { titleKey: `${B}.BUNDLE_SHARE.ITEM3_TITLE`, descKey: `${B}.BUNDLE_SHARE.ITEM3_DESC`, icon: 'layers-outline', iconModifier: 'trust' },
  ],
  bundleTitle: [
    { titleKey: `${B}.BUNDLE_TITLE.ITEM1_TITLE`, descKey: `${B}.BUNDLE_TITLE.ITEM1_DESC`, icon: 'sparkles-outline', iconModifier: 'star' },
    { titleKey: `${B}.BUNDLE_TITLE.ITEM2_TITLE`, descKey: `${B}.BUNDLE_TITLE.ITEM2_DESC`, icon: 'search-outline', iconModifier: 'light' },
    { titleKey: `${B}.BUNDLE_TITLE.ITEM3_TITLE`, descKey: `${B}.BUNDLE_TITLE.ITEM3_DESC`, icon: 'eye-outline', iconModifier: 'trust' },
  ],
  bundleDescription: [
    { titleKey: `${B}.BUNDLE_DESCRIPTION.ITEM1_TITLE`, descKey: `${B}.BUNDLE_DESCRIPTION.ITEM1_DESC`, icon: 'document-text-outline', iconModifier: 'trust' },
    { titleKey: `${B}.BUNDLE_DESCRIPTION.ITEM2_TITLE`, descKey: `${B}.BUNDLE_DESCRIPTION.ITEM2_DESC`, icon: 'bulb-outline', iconModifier: 'light' },
    { titleKey: `${B}.BUNDLE_DESCRIPTION.ITEM3_TITLE`, descKey: `${B}.BUNDLE_DESCRIPTION.ITEM3_DESC`, icon: 'time-outline', iconModifier: 'quick' },
  ],
  bundleMaterials: [
    { titleKey: `${B}.BUNDLE_MATERIALS.ITEM1_TITLE`, descKey: `${B}.BUNDLE_MATERIALS.ITEM1_DESC`, icon: 'checkbox-outline', iconModifier: 'trust' },
    { titleKey: `${B}.BUNDLE_MATERIALS.ITEM2_TITLE`, descKey: `${B}.BUNDLE_MATERIALS.ITEM2_DESC`, icon: 'layers-outline', iconModifier: 'light' },
    { titleKey: `${B}.BUNDLE_MATERIALS.ITEM3_TITLE`, descKey: `${B}.BUNDLE_MATERIALS.ITEM3_DESC`, icon: 'gift-outline', iconModifier: 'face' },
  ],
  bundleCover: [
    { titleKey: `${B}.BUNDLE_COVER.ITEM1_TITLE`, descKey: `${B}.BUNDLE_COVER.ITEM1_DESC`, icon: 'image-outline', iconModifier: 'star' },
    { titleKey: `${B}.BUNDLE_COVER.ITEM2_TITLE`, descKey: `${B}.BUNDLE_COVER.ITEM2_DESC`, icon: 'crop-outline', iconModifier: 'light' },
    { titleKey: `${B}.BUNDLE_COVER.ITEM3_TITLE`, descKey: `${B}.BUNDLE_COVER.ITEM3_DESC`, icon: 'eye-outline', iconModifier: 'trust' },
  ],
  bundleLanguageLevel: [
    { titleKey: `${B}.BUNDLE_LANGUAGE_LEVEL.ITEM1_TITLE`, descKey: `${B}.BUNDLE_LANGUAGE_LEVEL.ITEM1_DESC`, icon: 'globe-outline', iconModifier: 'trust' },
    { titleKey: `${B}.BUNDLE_LANGUAGE_LEVEL.ITEM2_TITLE`, descKey: `${B}.BUNDLE_LANGUAGE_LEVEL.ITEM2_DESC`, icon: 'bar-chart-outline', iconModifier: 'cert' },
    { titleKey: `${B}.BUNDLE_LANGUAGE_LEVEL.ITEM3_TITLE`, descKey: `${B}.BUNDLE_LANGUAGE_LEVEL.ITEM3_DESC`, icon: 'people-outline', iconModifier: 'face' },
  ],
  bundleTags: [
    { titleKey: `${B}.BUNDLE_TAGS.ITEM1_TITLE`, descKey: `${B}.BUNDLE_TAGS.ITEM1_DESC`, icon: 'pricetag-outline', iconModifier: 'light' },
    { titleKey: `${B}.BUNDLE_TAGS.ITEM2_TITLE`, descKey: `${B}.BUNDLE_TAGS.ITEM2_DESC`, icon: 'search-outline', iconModifier: 'trust' },
    { titleKey: `${B}.BUNDLE_TAGS.ITEM3_TITLE`, descKey: `${B}.BUNDLE_TAGS.ITEM3_DESC`, icon: 'options-outline', iconModifier: 'quick' },
  ],
  bundlePrice: [
    { titleKey: `${B}.BUNDLE_PRICE.ITEM1_TITLE`, descKey: `${B}.BUNDLE_PRICE.ITEM1_DESC`, icon: 'card-outline', iconModifier: 'payout' },
    { titleKey: `${B}.BUNDLE_PRICE.ITEM2_TITLE`, descKey: `${B}.BUNDLE_PRICE.ITEM2_DESC`, icon: 'cash-outline', iconModifier: 'star' },
    { titleKey: `${B}.BUNDLE_PRICE.ITEM3_TITLE`, descKey: `${B}.BUNDLE_PRICE.ITEM3_DESC`, icon: 'refresh-outline', iconModifier: 'light' },
  ],
};
