# GitHub Portfolio Checklist

Use this checklist before making the repository public.

- Keep `.env` private and commit only `.env.example`.
- Do not commit `node_modules`, `dist`, `.DS_Store`, logs, zip files, or local database files.
- Use synthetic demo data only. Do not store real student biometric, phone, attendance, guardian, or contact data.
- Run `npm test` before pushing.
- Run `npm run build` before pushing.
- Confirm `npm start` serves the built React app in production mode before sharing a public deployment.
- Add screenshots to a `screenshots/` folder if you want a stronger portfolio presentation.
- Mention in the README that JSON storage is for demo use and can be migrated to MongoDB or PostgreSQL.
- If deploying publicly, set `CLIENT_ORIGIN`, `JWT_SECRET`, and the seed passwords in the hosting dashboard. Do not hard-code them.
- Keep implementation-specific API examples out of the public README.
- Use a clear repository description:

```text
Full-stack college management portal with role-based dashboards, attendance workflows, timetable management, complaints, and reports.
```

Suggested repository names:

```text
college-management-portal
smart-college-attendance-complaint-system
```
