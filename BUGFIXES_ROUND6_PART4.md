# Round 6 — Stale HOD/role metadata on client (fix #8 from Audit Round 6)

Scope: implements finding #8 from `AUDIT_ROUND_6_REPORT.md` — the server
already recomputed `isHod`/`hodDepartmentId`/`hodDepartment` fresh from the
database on every request (`requireAuth`), but the client's `user` state was
only ever populated at login or on a full page reload. The access token is
silently refreshed every ~15 minutes in the background specifically so a
session never has to interrupt the user, but that refresh response never
carried a `user` object, so `AuthContext`'s `user.isHod` stayed frozen at
whatever it was last time the page loaded - a teacher just promoted to HOD
wouldn't see the HOD Center until closing and reopening the app, and a
teacher just demoted would keep seeing (though not be able to use) HOD-only
screens.

Went with option (a) from the report: `POST /auth/refresh` now returns the
same `user` shape `/auth/login` and `/auth/me` do, and the client merges it
into state on every silent refresh.

`npm install`/`npm test` could not be run in this sandbox (no network, no
`node_modules`). The touched server file was checked with `node --check`;
the client files are JSX and were reviewed by hand (no bundler available
here to run them through).

## Server — `server/routes/auth.js`

Factored the "safe user" shape (previously duplicated between `/login` and
`/me`, and missing entirely from `/refresh`) into one shared helper,
`buildSafeUser(db, account, role)`, that all three routes now call. For a
teacher it looks up `hodDepartment` fresh from `db.departments` every time,
same as `requireAuth` already does for API authorization - so `/refresh`'s
response is never trusting a stale value, it's making the same live lookup
the rest of the app already relies on:

```js
function buildSafeUser(db, account, role) {
  if (role === "student") return { ...publicStudent(account, db.attendance), role, approvedPhotoId: approvedPhotoId(db, account.id) };
  if (role === "teacher") {
    const hodDepartment = (db.departments || []).find((item) => item.hodId === account.id);
    return { id: account.id, name: account.name, email: account.email, code: account.code, department: account.department, role, isHod: Boolean(hodDepartment), hodDepartmentId: hodDepartment?.id || null, hodDepartment: hodDepartment?.name || null };
  }
  return { id: account.id, name: account.name, email: account.email, role };
}
```

`POST /auth/refresh` now includes `user: buildSafeUser(db, account, stored.role)`
in its response alongside the rotated tokens. `/login` and `/me` were
switched to call the same helper instead of their own inline copies, so all
three can never drift apart again.

## Client — `client/src/context/api.js`, `client/src/context/AuthContext.jsx`

`api.js` exposes a small registration hook, `setOnUserRefreshed(callback)`,
that `refreshAccessToken()` calls with `data.user` whenever a refresh
response includes one:

```js
let onUserRefreshed = null;
export function setOnUserRefreshed(callback) { onUserRefreshed = callback; }
// ...inside refreshAccessToken():
if (data.user && onUserRefreshed) onUserRefreshed(data.user);
```

`AuthContext.jsx` registers itself on mount and just calls `setUser` with
whatever comes back:

```js
useEffect(() => {
  setOnUserRefreshed((freshUser) => setUser(freshUser));
  return () => setOnUserRefreshed(null);
}, []);
```

`refreshAccessToken()` already fires from both `apiFetch` and `apiDownload`
whenever any request comes back `401`, so this piggybacks on the exact same
path that was already running every ~15 minutes - no new timer, no extra
request added. Signing out still clears `attendance_refresh_token`, so a
stray refresh can't re-populate `user` after logout.

## Not touched in this round

Finding #5 (filename sanitization) is unchanged - the last item from the
audit's suggested order. Finding #6 (GPS self-report) remains a flagged
discussion item, not a code fix.
