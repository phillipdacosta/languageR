# 🧪 Gamification System - Quick Test Guide

## How to Test the New Features

### Test Scenario 1: Pre-Unlock (< 5 lessons)
**Setup:** Login as a student with 0-4 completed lessons

**Expected Behavior:**
1. ✅ See unlock checklist card with trophy icon
2. ✅ Checklist shows 1-5 lessons (completed ones have green checkmarks)
3. ✅ "What you'll unlock" preview shows 4 features
4. ✅ Circular progress ring shows X/5
5. ✅ Message: "X more lessons to unlock!"
6. ✅ NO detailed analytics (no radar chart, no skills, no level badge)
7. ✅ NO badge showcase
8. ✅ NO lesson analyses timeline
9. ✅ Study time and streak still visible (if available)

**Visual Checks:**
- Trophy icon pulses/animates
- Completed lessons are green with checkmarks
- Uncompleted lessons are grayed out
- Progress ring fills proportionally (1/5 = 20%, 4/5 = 80%)
- Preview items have hover effect (lift on hover)

---

### Test Scenario 2: Just Unlocked (Exactly 5 lessons)
**Setup:** Complete your 5th lesson

**Expected Behavior:**
1. ✅ Unlock card DISAPPEARS
2. ✅ Next Goal card appears (showing progress to 10 lessons)
3. ✅ Badge Showcase appears with 20 badges
4. ✅ "Getting Started" badge (5 lessons) is EARNED (colored)
5. ✅ All other badges are LOCKED (grayscale with lock icons)
6. ✅ Badge count shows "1/20 badges" (or more if level/streak badges earned too)
7. ✅ Full analytics appear: Streak card, Level badge, Radar chart, Skills bars
8. ✅ Progress Over Time chart appears (vertical timeline)
9. ✅ Lesson Analyses timeline appears (horizontal dots)

**Visual Checks:**
- Next goal shows "5/10" with progress bar
- Getting Started badge is in full color (blue)
- Other badges are grayed out with lock icons
- Badge grid is responsive (5 columns desktop, 2-3 mobile)
- All previous analytics sections are visible

---

### Test Scenario 3: Multiple Badges (10+ lessons)
**Setup:** Complete 10 lessons with decent progress

**Expected Behavior:**
1. ✅ "Getting Started" badge earned (5 lessons)
2. ✅ "Committed Learner" badge earned (10 lessons)
3. ✅ Possible level badges earned (depending on proficiency reached)
4. ✅ Next goal updates to 25 lessons (or next streak milestone)
5. ✅ Badge count increases (e.g., "3/20 badges")
6. ✅ Progress bar shows 10/25 = 40%

**Badge Combination Examples:**
- **10 lessons + B1 level + 7-day streak** = 4 badges:
  - Getting Started (5 lessons)
  - Committed Learner (10 lessons)
  - Intermediate Achiever (B1)
  - Week Warrior (7 days)

**Visual Checks:**
- Multiple badges in full color
- Earned badges have green border and shadow
- Hover on earned badges lifts them up
- Progress bar color matches next goal type

---

### Test Scenario 4: Skill Badges (5+ lessons with high scores)
**Setup:** Complete 5+ lessons with 90%+ in a skill area

**Expected Behavior:**
- ✅ If grammar average ≥ 90%: "Grammar Guru" badge earned
- ✅ If vocabulary average ≥ 90%: "Vocabulary Virtuoso" badge earned
- ✅ If pronunciation average ≥ 90%: "Pronunciation Pro" badge earned
- ✅ If fluency average ≥ 90%: "Fluency Master" badge earned
- ✅ If ALL skills ≥ 80%: "All-Rounder" badge earned

**Note:** Skill badges ONLY unlock after 5 lessons minimum.

---

### Test Scenario 5: Streak Badges
**Setup:** Maintain daily lesson streak

**Expected Behavior:**
- ✅ 7-day streak: "Week Warrior" badge (red flame icon)
- ✅ 14-day streak: "Two-Week Champion" badge (orange flame)
- ✅ 30-day streak: "Monthly Master" badge (gold trophy)

**Visual Checks:**
- Streak badges use flame/trophy icons
- Colors transition from red → orange → gold as streaks grow
- Next goal switches to streak if closer than lesson milestone

---

### Test Scenario 6: Mobile Responsiveness
**Setup:** View on mobile device or narrow browser window (< 768px)

**Expected Behavior:**
1. ✅ Badge grid collapses to 2-3 columns
2. ✅ Next goal card compacts (smaller icons, font)
3. ✅ Unlock card preview becomes single column
4. ✅ All text remains readable
5. ✅ Touch targets are large enough
6. ✅ Progress ring scales down (120px → 100px)

**Visual Checks:**
- No horizontal scrolling (except timeline)
- Icons remain visible and not cut off
- Padding/spacing is proportional
- Buttons and cards are tappable

---

### Test Scenario 7: Edge Cases

#### **A. No Next Goal (All milestones achieved)**
**Setup:** Complete 100+ lessons with 100+ day streak

**Expected:**
- ✅ Next Goal card does NOT appear (hidden)
- ✅ All lesson badges earned (5, 10, 25, 50, 100)
- ✅ All streak badges earned (7, 14, 30, 60, 100)
- ✅ Badge count: "15/20" or "20/20" if all skills earned too

#### **B. Just Started (1-2 lessons)**
**Expected:**
- ✅ Unlock checklist shows 1-2 green checkmarks
- ✅ 3-4 lessons remaining grayed out
- ✅ Progress ring barely filled (20-40%)
- ✅ Message: "4 more lessons to unlock!" or "3 more lessons to unlock!"

#### **C. High Performance Student**
**Setup:** 25+ lessons, B2 level, 30-day streak, 90%+ all skills

**Expected Badges:**
- Getting Started, Committed Learner, Dedicated Student
- Breaking Through, Intermediate Achiever, Advanced Learner
- Week Warrior, Two-Week Champion, Monthly Master
- Grammar Guru, Vocabulary Virtuoso, Pronunciation Pro, Fluency Master, All-Rounder
- **Total: ~15 badges earned**

---

## 🎨 Visual Regression Tests

### Animations to Check:
1. **Trophy Icon Pulse** (pre-unlock)
   - Should scale 1.0 → 1.05 → 1.0 every 2 seconds
   - Shadow should pulse in sync

2. **Progress Ring Fill** (pre-unlock)
   - Should animate smoothly when lesson count changes
   - Stroke should be gradient (purple to indigo)

3. **Badge Earn Animation** (post-unlock)
   - When badge is earned, icon should scale 1.0 → 1.15 → 1.0
   - Should happen on page load if badge was just earned

4. **Hover Effects**
   - Preview items: Lift -4px, shadow increases
   - Earned badges: Lift -4px, shadow increases
   - Locked badges: No hover effect

5. **Progress Bar Fill** (next goal)
   - Should animate from 0 to X% over 0.6 seconds
   - Color should match goal type

---

## 🐛 Known Issues to Watch For

### Potential Bugs:
1. **Badge count mismatch** - Ensure `earnedBadgesCount` matches visible earned badges
2. **Next goal not updating** - Should recalculate after new lesson
3. **Timeline visibility** - Lesson Analyses should NOT show pre-unlock
4. **Stats not calculating** - If < 5 lessons, detailed stats should be skipped
5. **Mobile overflow** - Badge grid should not overflow horizontally

### How to Debug:
```typescript
// In browser console:
// Check current state
console.log('Analyses count:', analyses.length);
console.log('Is unlocked:', this.isProfileUnlocked);
console.log('Badges:', this.badges.filter(b => b.earned));
console.log('Next goal:', this.nextGoal);
```

---

## ✅ Complete Testing Checklist

### Pre-Unlock (< 5 lessons):
- [ ] Unlock card visible
- [ ] Trophy icon animating
- [ ] Checklist shows correct completion status
- [ ] Preview grid displays 4 items
- [ ] Progress ring shows correct percentage
- [ ] Lessons remaining message is accurate
- [ ] NO badge showcase visible
- [ ] NO lesson analyses timeline visible
- [ ] NO detailed analytics visible

### Post-Unlock (5+ lessons):
- [ ] Unlock card hidden
- [ ] Next goal card visible (if applicable)
- [ ] Badge showcase visible
- [ ] At least 1 badge earned (Getting Started)
- [ ] Badge count accurate
- [ ] Progress bar fills correctly
- [ ] All analytics sections visible
- [ ] Lesson analyses timeline visible
- [ ] Radar chart renders
- [ ] Skills bars display

### Badge Logic:
- [ ] Lesson badges earned at correct thresholds (5, 10, 25, 50, 100)
- [ ] Level badges earned when reaching CEFR levels
- [ ] Streak badges earned for consecutive days
- [ ] Skill badges earned only after 5+ lessons
- [ ] Locked badges show lock icon and grayscale

### UI/UX:
- [ ] Animations smooth and not janky
- [ ] Hover effects work on desktop
- [ ] Touch interactions work on mobile
- [ ] No layout shifts or content jumping
- [ ] Colors match design system
- [ ] Typography is readable
- [ ] Icons load correctly
- [ ] No console errors

### Responsive:
- [ ] Desktop layout (> 768px) displays correctly
- [ ] Mobile layout (≤ 768px) adapts properly
- [ ] Badge grid responsive
- [ ] Next goal card responsive
- [ ] Unlock card responsive
- [ ] No horizontal overflow

---

## 🎯 Success Criteria

**The gamification system is working correctly if:**
1. ✅ Students see clear motivation to reach 5 lessons
2. ✅ Badge system accurately reflects achievements
3. ✅ Next goal provides immediate target
4. ✅ UI is beautiful and animations are smooth
5. ✅ No bugs or broken layouts
6. ✅ Performance is good (no lag)
7. ✅ Mobile experience matches desktop quality

---

## 📱 Device Testing Matrix

| Device | Screen Size | Test Status | Notes |
|--------|-------------|-------------|-------|
| iPhone 13 | 390x844 | ⏳ Pending | Check badge grid (2 cols) |
| iPad Air | 820x1180 | ⏳ Pending | Check badge grid (3-4 cols) |
| MacBook Pro | 1440x900 | ⏳ Pending | Check badge grid (5 cols) |
| Desktop 4K | 3840x2160 | ⏳ Pending | Ensure not too spread out |
| Galaxy S21 | 360x800 | ⏳ Pending | Smallest mobile screen |

---

**Test Date:** _____________
**Tester:** _____________
**Build Version:** _____________
**Pass/Fail:** _____________
**Notes:** _____________





