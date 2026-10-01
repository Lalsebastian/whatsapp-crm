# Joboy CRM design system

This guide keeps the CRM recognisably Joboy and prevents future screens from drifting into generic dashboard styling.

## Product voice

- Use direct operational language: “Today’s workload”, “Open complaints”, “Assign technician”.
- Name the object and the action. Avoid vague labels such as “intelligence”, “magic”, “pulse”, or “command centre”.
- Empty states explain why the area is empty and offer the next useful action.
- Confirmation messages state what changed and identify the record when possible.

## Colour

- Navy is the primary text, navigation and trust colour in light mode.
- Yellow marks the active route and primary action. It is an accent, not a page fill.
- Dark mode uses yellow for emphasis and warm off-white for longer text.
- Pink is reserved for exceptional brand moments; it is not a navigation or status colour.
- Success, warning and destructive colours communicate state and must not be used decoratively.

## Typography and numbers

- Use the application sans-serif stack and sentence case.
- Page titles are concise; descriptions explain scope or reporting period.
- Use tabular numerals for money, counts, times and references.
- Uppercase text is limited to short section labels, with moderate letter spacing.

## Icons

- Use Lucide icons with a consistent 1.9–2.3 stroke width.
- Choose literal task icons: calendar for bookings, clipboard for complaints, people for escalation, wrench for field work.
- Do not use sparkles, wands, brains or robots to decorate ordinary CRM actions.
- Icons supplement labels; unfamiliar actions must never be icon-only without an accessible name.

## Surfaces and clay depth

- Clay depth is reserved for buttons and compact icon anchors that can be acted on.
- Data panels remain flatter so dense information is easy to scan.
- Use one border, one soft outer shadow and at most one inset highlight.
- Pressed controls move down slightly and reduce their shadow. They never wobble or morph.

## Motion

- Motion explains a change: opening detail, updating status, revealing content or refreshing data.
- Productive transitions target 150–300 ms. Page entrances may run up to 500 ms.
- Avoid continuous animation on icons, status indicators and data rows.
- Every animation must stop under reduced-motion or the CRM “Still” preference.

## Layout and density

- Phone navigation may float at the bottom, but content reserves safe space for it.
- Tablet and desktop layouts never show the phone bottom navigator.
- Compact, comfortable and spacious density modes preserve the same information hierarchy.
- Tables use sticky headers, keyboard-operable rows and mobile cards below the medium breakpoint.

## Records and actions

- Record links are URL-addressable and may be copied or pinned.
- Status changes remain close to the record and provide visible completion or failure feedback.
- Bulk actions always state the selected count and require an explicit Apply action.
- Activity history distinguishes operational milestones from verified database audit events.

## Accessibility

- All interactive controls require a visible keyboard focus state.
- Colour is never the only status indicator; include a label, icon or pattern.
- Dynamic loading and confirmation states use polite live regions; failures use alerts.
- Honour operating-system reduced motion, safe-area insets and browser zoom.

## Data trust

- Display whether data is refreshing and when cached data was last updated.
- Explain KPI period and calculation near the metric.
- Never imply live data when a value is calculated from a report or stale cache.
- Do not expose service-role credentials in frontend code. Public-schema data requires deliberate grants and RLS policies before authentication is enabled.
