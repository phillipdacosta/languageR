import { WizardGuidanceItem } from './models/wizard-step-guidance.model';

const G = 'ONBOARDING.WIZARD_GUIDANCE';

export const STUDENT_WIZARD_GUIDANCE: Record<number, WizardGuidanceItem[]> = {
  1: [
    { titleKey: `${G}.STUDENT.STEP1.ITEM1_TITLE`, descKey: `${G}.STUDENT.STEP1.ITEM1_DESC`, icon: 'person-outline', iconModifier: 'face' },
    { titleKey: `${G}.STUDENT.STEP1.ITEM2_TITLE`, descKey: `${G}.STUDENT.STEP1.ITEM2_DESC`, icon: 'eye-outline', iconModifier: 'trust' },
    { titleKey: `${G}.STUDENT.STEP1.ITEM3_TITLE`, descKey: `${G}.STUDENT.STEP1.ITEM3_DESC`, icon: 'flash-outline', iconModifier: 'quick' },
  ],
  2: [
    { titleKey: `${G}.STUDENT.STEP2.ITEM1_TITLE`, descKey: `${G}.STUDENT.STEP2.ITEM1_DESC`, icon: 'chatbubbles-outline', iconModifier: 'light' },
    { titleKey: `${G}.STUDENT.STEP2.ITEM2_TITLE`, descKey: `${G}.STUDENT.STEP2.ITEM2_DESC`, icon: 'globe-outline', iconModifier: 'trust' },
    { titleKey: `${G}.STUDENT.STEP2.ITEM3_TITLE`, descKey: `${G}.STUDENT.STEP2.ITEM3_DESC`, icon: 'sparkles-outline', iconModifier: 'star' },
  ],
  3: [
    { titleKey: `${G}.STUDENT.STEP3.ITEM1_TITLE`, descKey: `${G}.STUDENT.STEP3.ITEM1_DESC`, icon: 'school-outline', iconModifier: 'trust' },
    { titleKey: `${G}.STUDENT.STEP3.ITEM2_TITLE`, descKey: `${G}.STUDENT.STEP3.ITEM2_DESC`, icon: 'locate-outline', iconModifier: 'light' },
    { titleKey: `${G}.STUDENT.STEP3.ITEM3_TITLE`, descKey: `${G}.STUDENT.STEP3.ITEM3_DESC`, icon: 'add-circle-outline', iconModifier: 'quick' },
  ],
  4: [
    { titleKey: `${G}.STUDENT.STEP4.ITEM1_TITLE`, descKey: `${G}.STUDENT.STEP4.ITEM1_DESC`, icon: 'leaf-outline', iconModifier: 'face' },
    { titleKey: `${G}.STUDENT.STEP4.ITEM2_TITLE`, descKey: `${G}.STUDENT.STEP4.ITEM2_DESC`, icon: 'people-outline', iconModifier: 'trust' },
    { titleKey: `${G}.STUDENT.STEP4.ITEM3_TITLE`, descKey: `${G}.STUDENT.STEP4.ITEM3_DESC`, icon: 'ribbon-outline', iconModifier: 'cert' },
  ],
  5: [
    { titleKey: `${G}.STUDENT.STEP5.ITEM1_TITLE`, descKey: `${G}.STUDENT.STEP5.ITEM1_DESC`, icon: 'bar-chart-outline', iconModifier: 'cert' },
    { titleKey: `${G}.STUDENT.STEP5.ITEM2_TITLE`, descKey: `${G}.STUDENT.STEP5.ITEM2_DESC`, icon: 'checkmark-circle-outline', iconModifier: 'secure' },
    { titleKey: `${G}.STUDENT.STEP5.ITEM3_TITLE`, descKey: `${G}.STUDENT.STEP5.ITEM3_DESC`, icon: 'git-compare-outline', iconModifier: 'light' },
  ],
  6: [
    { titleKey: `${G}.STUDENT.STEP6.ITEM1_TITLE`, descKey: `${G}.STUDENT.STEP6.ITEM1_DESC`, icon: 'map-outline', iconModifier: 'trust' },
    { titleKey: `${G}.STUDENT.STEP6.ITEM2_TITLE`, descKey: `${G}.STUDENT.STEP6.ITEM2_DESC`, icon: 'heart-outline', iconModifier: 'star' },
    { titleKey: `${G}.STUDENT.STEP6.ITEM3_TITLE`, descKey: `${G}.STUDENT.STEP6.ITEM3_DESC`, icon: 'leaf-outline', iconModifier: 'face' },
  ],
  7: [
    { titleKey: `${G}.STUDENT.STEP7.ITEM1_TITLE`, descKey: `${G}.STUDENT.STEP7.ITEM1_DESC`, icon: 'happy-outline', iconModifier: 'face' },
    { titleKey: `${G}.STUDENT.STEP7.ITEM2_TITLE`, descKey: `${G}.STUDENT.STEP7.ITEM2_DESC`, icon: 'search-outline', iconModifier: 'light' },
    { titleKey: `${G}.STUDENT.STEP7.ITEM3_TITLE`, descKey: `${G}.STUDENT.STEP7.ITEM3_DESC`, icon: 'refresh-outline', iconModifier: 'quick' },
  ],
  8: [
    { titleKey: `${G}.STUDENT.STEP8.ITEM1_TITLE`, descKey: `${G}.STUDENT.STEP8.ITEM1_DESC`, icon: 'calendar-outline', iconModifier: 'weekly' },
    { titleKey: `${G}.STUDENT.STEP8.ITEM2_TITLE`, descKey: `${G}.STUDENT.STEP8.ITEM2_DESC`, icon: 'flag-outline', iconModifier: 'star' },
    { titleKey: `${G}.STUDENT.STEP8.ITEM3_TITLE`, descKey: `${G}.STUDENT.STEP8.ITEM3_DESC`, icon: 'options-outline', iconModifier: 'trust' },
  ],
};

export const TUTOR_WIZARD_GUIDANCE: Record<number, WizardGuidanceItem[]> = {
  1: [
    { titleKey: `${G}.TUTOR.STEP1.ITEM1_TITLE`, descKey: `${G}.TUTOR.STEP1.ITEM1_DESC`, icon: 'person-outline', iconModifier: 'face' },
    { titleKey: `${G}.TUTOR.STEP1.ITEM2_TITLE`, descKey: `${G}.TUTOR.STEP1.ITEM2_DESC`, icon: 'eye-outline', iconModifier: 'trust' },
    { titleKey: `${G}.TUTOR.STEP1.ITEM3_TITLE`, descKey: `${G}.TUTOR.STEP1.ITEM3_DESC`, icon: 'flash-outline', iconModifier: 'quick' },
  ],
  2: [
    { titleKey: `${G}.TUTOR.STEP2.ITEM1_TITLE`, descKey: `${G}.TUTOR.STEP2.ITEM1_DESC`, icon: 'earth-outline', iconModifier: 'trust' },
    { titleKey: `${G}.TUTOR.STEP2.ITEM2_TITLE`, descKey: `${G}.TUTOR.STEP2.ITEM2_DESC`, icon: 'people-outline', iconModifier: 'face' },
    { titleKey: `${G}.TUTOR.STEP2.ITEM3_TITLE`, descKey: `${G}.TUTOR.STEP2.ITEM3_DESC`, icon: 'shield-checkmark-outline', iconModifier: 'secure' },
  ],
  3: [
    { titleKey: `${G}.TUTOR.STEP3.ITEM1_TITLE`, descKey: `${G}.TUTOR.STEP3.ITEM1_DESC`, icon: 'card-outline', iconModifier: 'payout' },
    { titleKey: `${G}.TUTOR.STEP3.ITEM2_TITLE`, descKey: `${G}.TUTOR.STEP3.ITEM2_DESC`, icon: 'lock-closed-outline', iconModifier: 'secure' },
    { titleKey: `${G}.TUTOR.STEP3.ITEM3_TITLE`, descKey: `${G}.TUTOR.STEP3.ITEM3_DESC`, icon: 'globe-outline', iconModifier: 'light' },
  ],
  4: [
    { titleKey: `${G}.TUTOR.STEP4.ITEM1_TITLE`, descKey: `${G}.TUTOR.STEP4.ITEM1_DESC`, icon: 'chatbubbles-outline', iconModifier: 'light' },
    { titleKey: `${G}.TUTOR.STEP4.ITEM2_TITLE`, descKey: `${G}.TUTOR.STEP4.ITEM2_DESC`, icon: 'document-text-outline', iconModifier: 'trust' },
    { titleKey: `${G}.TUTOR.STEP4.ITEM3_TITLE`, descKey: `${G}.TUTOR.STEP4.ITEM3_DESC`, icon: 'sparkles-outline', iconModifier: 'star' },
  ],
  5: [
    { titleKey: `${G}.TUTOR.STEP5.ITEM1_TITLE`, descKey: `${G}.TUTOR.STEP5.ITEM1_DESC`, icon: 'leaf-outline', iconModifier: 'face' },
    { titleKey: `${G}.TUTOR.STEP5.ITEM2_TITLE`, descKey: `${G}.TUTOR.STEP5.ITEM2_DESC`, icon: 'people-outline', iconModifier: 'trust' },
    { titleKey: `${G}.TUTOR.STEP5.ITEM3_TITLE`, descKey: `${G}.TUTOR.STEP5.ITEM3_DESC`, icon: 'ribbon-outline', iconModifier: 'cert' },
  ],
  6: [
    { titleKey: `${G}.TUTOR.STEP6.ITEM1_TITLE`, descKey: `${G}.TUTOR.STEP6.ITEM1_DESC`, icon: 'bar-chart-outline', iconModifier: 'cert' },
    { titleKey: `${G}.TUTOR.STEP6.ITEM2_TITLE`, descKey: `${G}.TUTOR.STEP6.ITEM2_DESC`, icon: 'checkmark-circle-outline', iconModifier: 'secure' },
    { titleKey: `${G}.TUTOR.STEP6.ITEM3_TITLE`, descKey: `${G}.TUTOR.STEP6.ITEM3_DESC`, icon: 'git-compare-outline', iconModifier: 'light' },
  ],
  7: [
    { titleKey: `${G}.TUTOR.STEP7.ITEM1_TITLE`, descKey: `${G}.TUTOR.STEP7.ITEM1_DESC`, icon: 'book-outline', iconModifier: 'trust' },
    { titleKey: `${G}.TUTOR.STEP7.ITEM2_TITLE`, descKey: `${G}.TUTOR.STEP7.ITEM2_DESC`, icon: 'locate-outline', iconModifier: 'light' },
    { titleKey: `${G}.TUTOR.STEP7.ITEM3_TITLE`, descKey: `${G}.TUTOR.STEP7.ITEM3_DESC`, icon: 'add-circle-outline', iconModifier: 'quick' },
  ],
  8: [
    { titleKey: `${G}.TUTOR.STEP8.ITEM1_TITLE`, descKey: `${G}.TUTOR.STEP8.ITEM1_DESC`, icon: 'medal-outline', iconModifier: 'cert' },
    { titleKey: `${G}.TUTOR.STEP8.ITEM2_TITLE`, descKey: `${G}.TUTOR.STEP8.ITEM2_DESC`, icon: 'star-outline', iconModifier: 'star' },
    { titleKey: `${G}.TUTOR.STEP8.ITEM3_TITLE`, descKey: `${G}.TUTOR.STEP8.ITEM3_DESC`, icon: 'trending-up-outline', iconModifier: 'trust' },
  ],
  9: [
    { titleKey: `${G}.TUTOR.STEP9.ITEM1_TITLE`, descKey: `${G}.TUTOR.STEP9.ITEM1_DESC`, icon: 'calendar-outline', iconModifier: 'weekly' },
    { titleKey: `${G}.TUTOR.STEP9.ITEM2_TITLE`, descKey: `${G}.TUTOR.STEP9.ITEM2_DESC`, icon: 'time-outline', iconModifier: 'recent' },
    { titleKey: `${G}.TUTOR.STEP9.ITEM3_TITLE`, descKey: `${G}.TUTOR.STEP9.ITEM3_DESC`, icon: 'options-outline', iconModifier: 'light' },
  ],
  10: [
    { titleKey: `${G}.TUTOR.STEP10.ITEM1_TITLE`, descKey: `${G}.TUTOR.STEP10.ITEM1_DESC`, icon: 'create-outline', iconModifier: 'trust' },
    { titleKey: `${G}.TUTOR.STEP10.ITEM2_TITLE`, descKey: `${G}.TUTOR.STEP10.ITEM2_DESC`, icon: 'heart-outline', iconModifier: 'star' },
    { titleKey: `${G}.TUTOR.STEP10.ITEM3_TITLE`, descKey: `${G}.TUTOR.STEP10.ITEM3_DESC`, icon: 'leaf-outline', iconModifier: 'face' },
  ],
  11: [
    { titleKey: `${G}.TUTOR.STEP11.ITEM1_TITLE`, descKey: `${G}.TUTOR.STEP11.ITEM1_DESC`, icon: 'cash-outline', iconModifier: 'payout' },
    { titleKey: `${G}.TUTOR.STEP11.ITEM2_TITLE`, descKey: `${G}.TUTOR.STEP11.ITEM2_DESC`, icon: 'trending-up-outline', iconModifier: 'star' },
    { titleKey: `${G}.TUTOR.STEP11.ITEM3_TITLE`, descKey: `${G}.TUTOR.STEP11.ITEM3_DESC`, icon: 'refresh-outline', iconModifier: 'quick' },
  ],
};
