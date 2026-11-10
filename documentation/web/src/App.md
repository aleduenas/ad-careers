# `web/src/App.tsx`

Authority: this component implements the browser shell against the read-only API client. It provides
stable hash routes for Overview, Jobs, Discover, Tasks and Providers; separate health,
database-readiness and session states; retry controls; an accessible connection dialog; and a
light/dark theme action. The connection details use the browser's native modal dialog, including
Escape dismissal, focus containment and return to the invoking control. The skip link focuses main
content without changing the active route. Only the cosmetic theme preference is stored in guarded
local storage.
The session response stays in component memory and its nonce is never rendered. Routes describe
current availability without displaying unavailable job data or implying active workflow actions.
Endpoint reads run independently and are aborted when a newer refresh supersedes them.
On narrow screens, keyboard focus in the horizontally scrollable navigation adjusts that nav's
scroll position so the focused link and its focus ring remain visible without moving page content.
