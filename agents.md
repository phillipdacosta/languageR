# Agent Rules & Guidelines

## Code Quality Standards

### HTML/Template Rules
- **MUST NOT** add functions to HTML templates
- **MUST NOT** call methods directly in templates (causes performance issues with change detection)
- **ALWAYS** use properties/variables instead of function calls
- Calculate values once in TypeScript, store in properties, use in template

**Bad Example:**
```html
<div *ngIf="isTutor()">{{ getTutorName() }}</div>
```

**Good Example:**
```typescript
// In component
isTutorUser: boolean = false;
tutorName: string = '';

ngOnInit() {
  this.isTutorUser = this.isTutor();
  this.tutorName = this.getTutorName();
}
```
```html
<div *ngIf="isTutorUser">{{ tutorName }}</div>
```

## Design Standards

### Apple-Inspired Design Principles
- **MUST** make design look and feel like Apple design
- **Clean** - Minimal clutter, purposeful whitespace
- **Modern** - Contemporary styling, smooth animations
- **Consistent** - Unified design language across all components

### Design Characteristics
- **Typography**: San Francisco-style fonts, clear hierarchy, readable sizes
- **Colors**: Subtle, refined palette with purpose
- **Spacing**: Generous padding, logical grouping
- **Borders**: Subtle, rounded corners (12-16px)
- **Shadows**: Soft, realistic depth (0 2px 12px rgba(0,0,0,0.08))
- **Animations**: Smooth, purposeful (0.2-0.4s ease)
- **Buttons**: Clear, tactile, appropriate sizing
- **Cards**: Clean white backgrounds with subtle shadows
- **Icons**: Clear, recognizable, appropriate sizing

### Component-Specific Guidelines

#### Banners & Alerts
- Use gradient backgrounds for important CTAs
- Clear hierarchy: icon → title → description → action
- Mobile-responsive (stack on small screens)
- Smooth entrance animations

#### Forms & Inputs
- Clear labels above inputs
- Appropriate input sizing (44px+ for touch targets)
- Error states with helpful messaging
- Loading states for async operations

#### Lists & Cards
- Consistent padding (16-24px)
- Clear separators (1px, subtle colors)
- Hover states where appropriate
- Smooth transitions

## Performance Rules
- Avoid repeated calculations in templates
- Use `OnPush` change detection where appropriate
- Unsubscribe from observables properly
- Lazy load images and heavy components

## Testing & Debugging
- Remove console.logs before committing
- Add meaningful variable names
- Comment complex logic
- Use TypeScript types strictly



