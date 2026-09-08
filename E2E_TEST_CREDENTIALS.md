# E2E Test Credentials

The local/staging seed includes this faculty account for end-to-end testing:

| Role | Email | Password | Expected seeded timetable |
|---|---|---|---|
| Faculty | `faculty-demo@example.edu` | `E2E_FACULTY_PASSWORD` | CSE 3A, Data Structures and Operating Systems |
| Admin | `admin-demo@example.edu` | `E2E_ADMIN_PASSWORD` | Subjects, timetable, complaints, and reports |

Set the password variables in the local or staging environment. Do not commit their values or paste them into test reports.

Failed login attempts return the API error message in the visible login error panel.

## Student-record search scope

Student accounts are intentionally not given a **Students** or **Student Records** navigation item. The access model exposes student rosters to faculty for their assigned classes; students can view their own profile and academic features, but cannot search or browse other student records. An automated test expecting student-to-student record search should therefore be removed or rewritten as a faculty roster-search test.
