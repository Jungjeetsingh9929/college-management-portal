import bcrypt from "bcryptjs";
import { teacherLegend, departmentNames } from "./teacherLegend.js";
import { part2aSchedule } from "./schedule_part2a.js";
import { part2bSchedule } from "./schedule_part2b.js";

const demoAdminEmail = process.env.SEED_ADMIN_EMAIL || "admin@example.edu";
const demoAdminName = process.env.SEED_ADMIN_NAME || "Admin";
function seedSecret(name, fallback) {
  const value = process.env[name];
  if (process.env.NODE_ENV === "production" && !value) {
    throw new Error(`${name} must be set in production.`);
  }
  return value || fallback;
}

const demoAdminPassword = seedSecret("SEED_ADMIN_PASSWORD", "change-this-admin-password");
const demoStudentPassword = seedSecret("SEED_STUDENT_PASSWORD", "change-this-student-password");
// Note: teacher accounts do NOT use a single shared SEED_TEACHER_PASSWORD.
// Each teacher gets its own predictable demo password ("<CODE>@Uem2026"),
// or a real one via FACULTY_<CODE>_EMAIL/FACULTY_<CODE>_PASSWORD — see the
// teacher-account generation below.
const passwordHash = bcrypt.hashSync(demoStudentPassword, 10);
const adminHash = bcrypt.hashSync(demoAdminPassword, 10);

export const seedData = {
  admins: [
    {
      id: "admin-001",
      name: demoAdminName,
      email: demoAdminEmail,
      password: adminHash,
      role: "admin"
    }
  ],
  pendingStudents: [],
  assignments: [],
  quizzes: [],
  // Sourced from UEM Jaipur's official 2026 Academic Calendar (Even + Odd
  // semester) and the 2026 Academic Holidays List. Multi-day events (exam
  // windows, breaks) are recorded on their start date, with the full range
  // spelled out in the title.
  holidays: [
    // Even Semester 2026 (Jan-Jun) milestones
    { id: "hol-e01", title: "Winter Internship Period begins (for Students)", date: "2025-12-03" },
    { id: "hol-e02", title: "Inter-Semester Break begins (for Faculty)", date: "2025-12-20" },
    { id: "hol-e03", title: "Commencement of classes, Even Semester 2026", date: "2026-01-05" },
    { id: "hol-e04", title: "Term-I Examinations begin (Feb 9-17, 2026)", date: "2026-02-09" },
    { id: "hol-e05", title: "NPTEL Examination Dates (Mar 21-22, 2026)", date: "2026-03-21" },
    { id: "hol-e06", title: "Term-II Examinations begin (Mar 23-31, 2026)", date: "2026-03-23" },
    { id: "hol-e07", title: "End Semester Practical/Sessional Exams & Viva-Voce begin (Apr 1-10, 2026)", date: "2026-04-01" },
    { id: "hol-e08", title: "End Semester Theoretical Exams begin (Apr 13 - May 9, 2026)", date: "2026-04-13" },
    { id: "hol-e09", title: "NPTEL Examination Dates (Apr 17-18, Apr 25-26 & May 2-3, 2026)", date: "2026-04-17" },
    { id: "hol-e10", title: "Summer Internship Period begins (for Students)", date: "2026-05-11" },
    { id: "hol-e11", title: "Inter-Semester Break begins (for Faculty)", date: "2026-05-18" },
    { id: "hol-e12", title: "Summer Semester begins", date: "2026-06-08" },
    { id: "hol-e13", title: "Publication of Results, Even Semester (by July 2026)", date: "2026-07-31" },
    // Academic Holidays List 2026
    { id: "hol-001", title: "Makar Sankranti", date: "2026-01-14" },
    { id: "hol-002", title: "Republic Day", date: "2026-01-26" },
    { id: "hol-003", title: "Maha-Shivaratri", date: "2026-02-15" },
    { id: "hol-004", title: "Holika Dahan", date: "2026-03-02" },
    { id: "hol-005", title: "Dhulandi", date: "2026-03-03" },
    { id: "hol-006", title: "Eid-Ul-Fitr*", date: "2026-03-21" },
    { id: "hol-007", title: "Mahavir Jayanti", date: "2026-03-31" },
    { id: "hol-008", title: "Good Friday", date: "2026-04-03" },
    { id: "hol-009", title: "Labour Day", date: "2026-05-01" },
    { id: "hol-010", title: "Id-Ud-Zoha (Bakri-Id)*", date: "2026-05-27" },
    { id: "hol-011", title: "Muharram*", date: "2026-06-26" },
    { id: "hol-012", title: "Independence Day", date: "2026-08-15" },
    { id: "hol-013", title: "Barawafat", date: "2026-08-26" },
    { id: "hol-014", title: "Raksha Bandhan", date: "2026-08-28" },
    { id: "hol-015", title: "Shri Krishna Janmashtami", date: "2026-09-04" },
    { id: "hol-016", title: "Mahatma Gandhi Jayanti", date: "2026-10-02" },
    { id: "hol-017", title: "Navratra Sthapana", date: "2026-10-11" },
    { id: "hol-018", title: "First day of Durga Pooja Festivities", date: "2026-10-16" },
    { id: "hol-019", title: "Durga Saptmi", date: "2026-10-18" },
    { id: "hol-020", title: "Durga Ashtami", date: "2026-10-19" },
    { id: "hol-021", title: "Maha Navami", date: "2026-10-20" },
    { id: "hol-022", title: "Vijay Dashmi", date: "2026-10-21" },
    { id: "hol-023", title: "Dhanteras", date: "2026-11-06" },
    { id: "hol-024", title: "Deepawali", date: "2026-11-08" },
    { id: "hol-025", title: "Govardhan Pooja", date: "2026-11-09" },
    { id: "hol-026", title: "Bhai Dooj", date: "2026-11-11" },
    { id: "hol-027", title: "GuruNanak Jayanti", date: "2026-11-24" },
    { id: "hol-028", title: "Christmas Day", date: "2026-12-25" },
    // Odd Semester 2026 (Jul-Dec) milestones
    { id: "hol-o01", title: "Commencement of classes, Odd Semester (for new batch)", date: "2026-07-01" },
    { id: "hol-o02", title: "Commencement of classes, Odd Semester (for existing batches)", date: "2026-07-06" },
    { id: "hol-o03", title: "Term-I Examinations begin (Aug 10-18, 2026)", date: "2026-08-10" },
    { id: "hol-o04", title: "Term-II Examinations begin (Oct 6-13, 2026)", date: "2026-10-06" },
    { id: "hol-o05", title: "NPTEL Examination Dates (Oct 24-25 & Oct 31-Nov 1, 2026)", date: "2026-10-24" },
    { id: "hol-o06", title: "End Semester Practical/Sessional Exams & Viva-Voce begin (Nov 2-11, 2026)", date: "2026-11-02" },
    { id: "hol-o07", title: "End Semester Theoretical Exams begin (Nov 17 - Dec 4, 2026)", date: "2026-11-17" },
    { id: "hol-o08", title: "Winter Internship Period begins (for Students)", date: "2026-12-05" },
    { id: "hol-o09", title: "Inter-Semester Break begins (for Faculty)", date: "2026-12-21" },
    { id: "hol-o10", title: "Commencement of classes, Even Semester 2027", date: "2027-01-04" },
    { id: "hol-o11", title: "Publication of Results, Odd Semester (by Feb 2027)", date: "2027-02-28" }
  ],
  students: [
    {
      id: "stu-001",
      name: "Aditya Sharma",
      rollNumber: "CSE-2026-001",
      className: "CSE 3A",
      department: "Computer Science",
      email: "student001@example.edu",
      password: passwordHash,
      cardUid: "",
      fingerprintId: "",
      faceImageUrl: "",
      faceDescriptor: [],
      faceEnrolled: false,
      phone: "",
      guardian: "Rajesh Sharma",
      graduationYear: "2028",
      approvalStatus: "approved"
    },
    {
      id: "stu-002",
      name: "Priya Singh",
      rollNumber: "CSE-2026-002",
      className: "CSE 3A",
      department: "Computer Science",
      email: "student002@example.edu",
      password: passwordHash,
      cardUid: "",
      fingerprintId: "",
      faceImageUrl: "",
      faceDescriptor: [],
      faceEnrolled: false,
      phone: "",
      guardian: "Manoj Singh",
      graduationYear: "2028",
      approvalStatus: "approved"
    },
    {
      id: "stu-003",
      name: "Rohit Verma",
      rollNumber: "CSE-2026-004",
      className: "CSE 3A",
      department: "Computer Science",
      email: "student003@example.edu",
      password: passwordHash,
      cardUid: "",
      fingerprintId: "",
      faceImageUrl: "",
      faceDescriptor: [],
      faceEnrolled: false,
      phone: "",
      guardian: "Suresh Verma",
      graduationYear: "2028",
      approvalStatus: "approved"
    },
    {
      id: "stu-004",
      name: "Ananya Gupta",
      rollNumber: "CSE-2026-005",
      className: "CSE 3A",
      department: "Computer Science",
      email: "student004@example.edu",
      password: passwordHash,
      cardUid: "",
      fingerprintId: "",
      faceImageUrl: "",
      faceDescriptor: [],
      faceEnrolled: false,
      phone: "",
      guardian: "Vinod Gupta",
      graduationYear: "2028",
      approvalStatus: "approved"
    },
    {
      id: "stu-005",
      name: "Karan Malhotra",
      rollNumber: "CSE-2026-006",
      className: "CSE 3A",
      department: "Computer Science",
      email: "student005@example.edu",
      password: passwordHash,
      cardUid: "",
      fingerprintId: "",
      faceImageUrl: "",
      faceDescriptor: [],
      faceEnrolled: false,
      phone: "",
      guardian: "Deepak Malhotra",
      graduationYear: "2028",
      approvalStatus: "approved"
    },
    {
      id: "stu-006",
      name: "Neha Kapoor",
      rollNumber: "CSE-2026-007",
      className: "CSE 3A",
      department: "Computer Science",
      email: "student006@example.edu",
      password: passwordHash,
      cardUid: "",
      fingerprintId: "",
      faceImageUrl: "",
      faceDescriptor: [],
      faceEnrolled: false,
      phone: "",
      guardian: "Ashok Kapoor",
      graduationYear: "2028",
      approvalStatus: "approved"
    },
    {
      id: "stu-007",
      name: "Vikram Rathore",
      rollNumber: "CSE-2026-021",
      className: "CSE 2B",
      department: "Computer Science",
      email: "student007@example.edu",
      password: passwordHash,
      cardUid: "",
      fingerprintId: "",
      faceImageUrl: "",
      faceDescriptor: [],
      faceEnrolled: false,
      phone: "",
      guardian: "Mahendra Rathore",
      graduationYear: "2028",
      approvalStatus: "approved"
    },
    {
      id: "stu-008",
      name: "Ishita Nair",
      rollNumber: "CSE-2026-022",
      className: "CSE 2B",
      department: "Computer Science",
      email: "student008@example.edu",
      password: passwordHash,
      cardUid: "",
      fingerprintId: "",
      faceImageUrl: "",
      faceDescriptor: [],
      faceEnrolled: false,
      phone: "",
      guardian: "Ravi Nair",
      graduationYear: "2028",
      approvalStatus: "approved"
    },
    {
      id: "stu-009",
      name: "Aman Chauhan",
      rollNumber: "CSE-2026-023",
      className: "CSE 2B",
      department: "Computer Science",
      email: "student009@example.edu",
      password: passwordHash,
      cardUid: "",
      fingerprintId: "",
      faceImageUrl: "",
      faceDescriptor: [],
      faceEnrolled: false,
      phone: "",
      guardian: "Naresh Chauhan",
      graduationYear: "2028",
      approvalStatus: "approved"
    },
    {
      id: "stu-010",
      name: "Simran Kaur",
      rollNumber: "CSE-2026-024",
      className: "CSE 2B",
      department: "Computer Science",
      email: "student010@example.edu",
      password: passwordHash,
      cardUid: "",
      fingerprintId: "",
      faceImageUrl: "",
      faceDescriptor: [],
      faceEnrolled: false,
      phone: "",
      guardian: "Gurpreet Kaur",
      graduationYear: "2028",
      approvalStatus: "approved"
    },
    {
      id: "stu-011",
      name: "Yash Tiwari",
      rollNumber: "ECE-2026-011",
      className: "ECE 3B",
      department: "Electronics",
      email: "student011@example.edu",
      password: passwordHash,
      cardUid: "",
      fingerprintId: "",
      faceImageUrl: "",
      faceDescriptor: [],
      faceEnrolled: false,
      phone: "",
      guardian: "Prakash Tiwari",
      graduationYear: "2028",
      approvalStatus: "approved"
    },
    {
      id: "stu-012",
      name: "Divya Mishra",
      rollNumber: "ECE-2026-012",
      className: "ECE 3B",
      department: "Electronics",
      email: "student012@example.edu",
      password: passwordHash,
      cardUid: "",
      fingerprintId: "",
      faceImageUrl: "",
      faceDescriptor: [],
      faceEnrolled: false,
      phone: "",
      guardian: "Ramesh Mishra",
      graduationYear: "2028",
      approvalStatus: "approved"
    },
    {
      id: "stu-013",
      name: "Harsh Bhatt",
      rollNumber: "ECE-2026-013",
      className: "ECE 3B",
      department: "Electronics",
      email: "student013@example.edu",
      password: passwordHash,
      cardUid: "",
      fingerprintId: "",
      faceImageUrl: "",
      faceDescriptor: [],
      faceEnrolled: false,
      phone: "",
      guardian: "Dinesh Bhatt",
      graduationYear: "2028",
      approvalStatus: "approved"
    },
    {
      id: "stu-014",
      name: "Pooja Reddy",
      rollNumber: "IT-2026-021",
      className: "IT 3A",
      department: "Information Technology",
      email: "student014@example.edu",
      password: passwordHash,
      cardUid: "",
      fingerprintId: "",
      faceImageUrl: "",
      faceDescriptor: [],
      faceEnrolled: false,
      phone: "",
      guardian: "Srinivas Reddy",
      graduationYear: "2028",
      approvalStatus: "approved"
    },
    {
      id: "stu-015",
      name: "Arjun Menon",
      rollNumber: "IT-2026-022",
      className: "IT 3A",
      department: "Information Technology",
      email: "student015@example.edu",
      password: passwordHash,
      cardUid: "",
      fingerprintId: "",
      faceImageUrl: "",
      faceDescriptor: [],
      faceEnrolled: false,
      phone: "",
      guardian: "Suresh Menon",
      graduationYear: "2028",
      approvalStatus: "approved"
    },
    {
      id: "stu-016",
      name: "Tanvi Joshi",
      rollNumber: "IT-2026-023",
      className: "IT 3A",
      department: "Information Technology",
      email: "student016@example.edu",
      password: passwordHash,
      cardUid: "",
      fingerprintId: "",
      faceImageUrl: "",
      faceDescriptor: [],
      faceEnrolled: false,
      phone: "",
      guardian: "Anil Joshi",
      graduationYear: "2028",
      approvalStatus: "approved"
    },
    {
      id: "stu-017",
      name: "Devansh Pandey",
      rollNumber: "ME-2026-031",
      className: "ME 3A",
      department: "Mechanical",
      email: "student017@example.edu",
      password: passwordHash,
      cardUid: "",
      fingerprintId: "",
      faceImageUrl: "",
      faceDescriptor: [],
      faceEnrolled: false,
      phone: "",
      guardian: "Ram Pandey",
      graduationYear: "2028",
      approvalStatus: "approved"
    },
    {
      id: "stu-018",
      name: "Riya Chatterjee",
      rollNumber: "ME-2026-032",
      className: "ME 3A",
      department: "Mechanical",
      email: "student018@example.edu",
      password: passwordHash,
      cardUid: "",
      fingerprintId: "",
      faceImageUrl: "",
      faceDescriptor: [],
      faceEnrolled: false,
      phone: "",
      guardian: "Subrata Chatterjee",
      graduationYear: "2028",
      approvalStatus: "approved"
    }
  ],
  subjects: [
    {
      id: "sub-cs101",
      subjectName: "Data Structures",
      code: "CS101",
      teacher: "Prof. Arjun Rao",
      className: "CSE 3A",
      schedule: "Mon, Wed 09:00",
      room: "Lab 2"
    },
    {
      id: "sub-cs205",
      subjectName: "Database Systems",
      code: "CS205",
      teacher: "Prof. Kavita Iyer",
      className: "CSE 3A",
      schedule: "Tue, Thu 10:00",
      room: "Room 304"
    },
    {
      id: "sub-ec110",
      subjectName: "Digital Electronics",
      code: "EC110",
      teacher: "Prof. Farhan Ali",
      className: "ECE 3B",
      schedule: "Mon, Fri 11:00",
      room: "Room 210"
    }
  ],
  classes: [
    {
      id: "cls-001",
      subjectId: "sub-cs101",
      className: "CSE 3A",
      day: "Monday",
      startTime: "09:00",
      endTime: "10:00",
      room: "Lab 2"
    },
    {
      id: "cls-002",
      subjectId: "sub-cs205",
      className: "CSE 3A",
      day: "Tuesday",
      startTime: "10:00",
      endTime: "11:00",
      room: "Room 304"
    },
    {
      id: "cls-003",
      subjectId: "sub-ec110",
      className: "ECE 3B",
      day: "Friday",
      startTime: "11:00",
      endTime: "12:00",
      room: "Room 210"
    }
  ],
  attendance: [
    {
      id: "att-001",
      studentId: "stu-001",
      subjectId: "sub-cs101",
      date: "2026-07-27",
      status: "present",
      time: "09:03",
      method: "manual"
    },
    {
      id: "att-002",
      studentId: "stu-002",
      subjectId: "sub-cs101",
      date: "2026-07-27",
      status: "absent",
      time: "09:05",
      method: "manual"
    },
    {
      id: "att-003",
      studentId: "stu-001",
      subjectId: "sub-cs205",
      date: "2026-07-28",
      status: "present",
      time: "10:02",
      method: "scan"
    },
    {
      id: "att-004",
      studentId: "stu-002",
      subjectId: "sub-cs205",
      date: "2026-07-28",
      status: "present",
      time: "10:01",
      method: "scan"
    },
    {
      id: "att-005",
      studentId: "stu-003",
      subjectId: "sub-ec110",
      date: "2026-07-24",
      status: "present",
      time: "11:00",
      method: "manual"
    }
  ],
  complaints: [
    {
      id: "cmp-001",
      studentId: "stu-001",
      title: "Projector not working",
      category: "Classroom",
      location: "Room 304",
      priority: "medium",
      status: "in-progress",
      description: "Projector display is flickering during database class.",
      response: "Technician assigned.",
      createdAt: "2026-08-18T09:30:00.000Z",
      updatedAt: "2026-08-18T11:00:00.000Z"
    },
    {
      id: "cmp-002",
      studentId: "stu-002",
      title: "Library Wi-Fi issue",
      category: "Network",
      location: "Central Library",
      priority: "low",
      status: "pending",
      description: "Wi-Fi speed is slow near the reading hall.",
      response: "",
      createdAt: "2026-08-18T12:15:00.000Z",
      updatedAt: "2026-08-18T12:15:00.000Z"
    }
  ]
};

const timetableDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const timetablePeriods = [
  [1, "09:30", "10:20"],
  [2, "10:20", "11:10"],
  [3, "11:10", "12:00"],
  [4, "13:00", "13:50"],
  [5, "13:50", "14:40"],
  [6, "14:40", "15:30"],
  [7, "15:30", "16:20"],
  [8, "16:20", "17:00"]
];

const sectionTimetable = {
  "CSE 3A": {
    room: "S302",
    teachers: ["AGA", "UKD", "DCE", "KJT", "AYV, LRG", "SBK", "UDI", "SBK, AGA"],
    subjects: {
      Monday: ["PCCCS302", "HSMC301", "ESC302", "BSC301", "ESC391 LAB", "PCCCS391 LAB", "Speech by Students", "Mentoring"],
      Tuesday: ["ESC301", "HSMC301", "HSMC302", "HSMC382", "ESC392 LAB", "PCCCS392 LAB", "PROJCS301", "Mentoring"],
      Wednesday: ["HSMC302", "PCCCS301", "ESC301", "BSC301", "ESC302", "HSMC301", "IFC/MAR/MOOCS", "Mentoring"],
      Thursday: ["BSC301", "PCCCS301", "HSMC382", "ESC302", "ESC392 LAB", "PCCCS392 LAB", "IFC/MAR/MOOCS", "Mentoring"],
      Friday: ["PCCCS301", "ESC301", "ESC302", "HSMC301", "UKD", "SBK", "Coding Competition", "Mentoring"]
    }
  },
  "CSE 2B": {
    room: "S303",
    teachers: ["SBK", "AYV, LRG :: SBK(ZONE-2)", "AYV, LRG :: SBK(ZONE-2)", "UDI", "VDI", "UKD", "AGA", "DCE, AGA"],
    subjects: {
      Monday: ["PCCCS301", "ESC391 LAB", "PCCCS391 LAB", "Speech by Students", "HSMC302", "HSMC301", "PCCCS302", "Mentoring"],
      Tuesday: ["BSC301", "ESC392 LAB", "PCCCS392 LAB", "ESC301", "HSMC382", "HSMC302", "PROJCS301", "Mentoring"],
      Wednesday: ["PCCCS301", "ESC392 LAB", "PCCCS392 LAB", "HSMC301", "ESC302", "BSC301", "IFC/MAR/MOOCS", "Mentoring"],
      Thursday: ["ESC301", "ESC302", "HSMC301", "HSMC382", "ESC391 LAB", "PCCCS391 LAB", "IFC/MAR/MOOCS", "Mentoring"],
      Friday: ["ESC301", "BSC301", "PCCCS301", "ESC302", "NPTEL", "Coding Competition", "Coding Competition", "Mentoring"]
    },
    dayTeachers: {
      Tuesday: ["KJT", "DCE :: AGA(LAB-2)", "DCE :: AGA(LAB-2)", "AYV", "KVK", "VDI", "All Faculty", "DCE, AGA"],
      Wednesday: ["SBK", "DCE :: AGA(LAB-2)", "DCE :: AGA(LAB-2)", "UKD", "DCE", "KJT", "DCE, AGA", "DCE, AGA"],
      Thursday: ["AYV", "DCE", "UKD", "RKJ", "AYV, LRG :: SBK(ZONE-2)", "AYV, LRG :: SBK(ZONE-2)", "SSK, SYN", "SSK, SYN"],
      Friday: ["AYV", "KJT", "SBK", "DCE", "SYN", "DCE/SSR/SYN", "DCE/SSR/SYN", "DCE, AGA"]
    }
  },
};

seedData.schedules = Object.entries(sectionTimetable).flatMap(([section, config]) =>
  timetableDays.flatMap((day) =>
    timetablePeriods.map(([period, startTime, endTime], index) => {
      const subject = config.subjects[day][index];
      const isLab = subject.includes("LAB");
      return {
        id: `sch-${section.toLowerCase().replaceAll(" ", "-")}-${day.toLowerCase()}-${period}`,
        day,
        section,
        room: isLab ? "Lab 2" : config.room,
        period,
        startTime,
        endTime,
        subject,
        teacher: config.dayTeachers?.[day]?.[index] || config.teachers[index],
        activity: isLab ? "Lab" : subject === "Mentoring" ? "Mentoring" : subject.includes("Competition") ? "Competition" : subject.includes("PROJ") ? "Project" : subject.includes("Speech") ? "Activity" : "Lecture",
        notes: isLab ? "Batch-wise lab slot" : ""
      };
    })
  )
);

// Part 2a of the real timetable import: B.Tech 1st Year (A-D) + full CSE
// department. See server/db/schedule_part2a.js for the transcription notes.
seedData.schedules.push(...part2aSchedule);

// Part 2b of the real timetable import: AIML, ECE and EE departments
// (2nd/3rd/4th Year undergraduate sections). See server/db/schedule_part2b.js
// for the transcription notes. This replaces the old placeholder AIML-B
// block (built from a photo with no teacher/room data, transcribed under
// section "AIML-B") -- that placeholder has been removed now that the real
// data lands here under section "AIML2-B".
seedData.schedules.push(...part2bSchedule);

const subjectKey = (subject) => `${subject.className}::${subject.code}`.toLowerCase();
const existingSubjectKeys = new Set(seedData.subjects.map(subjectKey));
const scheduleSubjects = seedData.schedules
  .filter((item) => item.subject && item.subject !== "All Faculty")
  .reduce((items, item) => {
    const code = item.subject;
    const key = `${item.section}::${code}`.toLowerCase();
    if (items.has(key) || existingSubjectKeys.has(key)) return items;
    const scheduleText = `${item.day} ${item.startTime}-${item.endTime}`;
    items.set(key, {
      id: `sub-${item.section.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${code.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`.replace(/-+$/g, ""),
      subjectName: code,
      code,
      teacher: item.teacher,
      className: item.section,
      schedule: scheduleText,
      room: item.room || ""
    });
    return items;
  }, new Map());

seedData.subjects.push(...scheduleSubjects.values());

// The Part 2a/2b timetable import brought in real schedules (and, via the
// block above, real subjects) for these sections, but no students -- so
// "my students" views, attendance, and per-student schedules for every one
// of them were empty. This adds exactly 2 enrolled students per section,
// on top of (not replacing) the original 18 demo students (stu-001..018).
const sectionRoster = [
  { section: "BTECH1-A", department: "B.Tech 1st Year (Common)" },
  { section: "BTECH1-B", department: "B.Tech 1st Year (Common)" },
  { section: "BTECH1-C", department: "B.Tech 1st Year (Common)" },
  { section: "BTECH1-D", department: "B.Tech 1st Year (Common)" },
  { section: "CSE2-A", department: "Computer Science & Engineering" },
  { section: "CSE2-B", department: "Computer Science & Engineering" },
  { section: "CSE3-A", department: "Computer Science & Engineering" },
  { section: "CSE3-B", department: "Computer Science & Engineering" },
  { section: "CSE4-A", department: "Computer Science & Engineering" },
  { section: "CSE4-B", department: "Computer Science & Engineering" },
  { section: "CSE4-C", department: "Computer Science & Engineering" },
  { section: "AIML2-A", department: "Artificial Intelligence & Machine Learning" },
  { section: "AIML2-B", department: "Artificial Intelligence & Machine Learning" },
  { section: "AIML3-A", department: "Artificial Intelligence & Machine Learning" },
  { section: "AIML3-B", department: "Artificial Intelligence & Machine Learning" },
  { section: "AIML4-A", department: "Artificial Intelligence & Machine Learning" },
  { section: "ECE2", department: "Electronics & Communication Engineering" },
  { section: "ECE3", department: "Electronics & Communication Engineering" },
  { section: "ECE4", department: "Electronics & Communication Engineering" },
  { section: "EE2", department: "Electrical Engineering" },
  { section: "EE3", department: "Electrical Engineering" },
  { section: "EE4", department: "Electrical Engineering" },
  { section: "CSE-MTECH1", department: "M.Tech Computer Science & Engineering" },
  { section: "CSE-MTECH2", department: "M.Tech Computer Science & Engineering" }
];

const rosterFirstNames = [
  "Aarav", "Vivaan", "Aditya", "Ishaan", "Krishna", "Arjun", "Sai", "Reyansh", "Ayaan", "Kabir",
  "Ananya", "Diya", "Saanvi", "Myra", "Aadhya", "Pari", "Anika", "Navya", "Kiara", "Riya"
];
const rosterLastNames = [
  "Sharma", "Verma", "Gupta", "Iyer", "Nair", "Reddy", "Patel", "Mehta", "Chauhan", "Bose",
  "Rao", "Das", "Joshi", "Kulkarni", "Menon", "Pillai", "Chatterjee", "Bhatt", "Trivedi", "Saxena"
];

function graduationYearForSection(section) {
  if (section.includes("MTECH2")) return "2027";
  if (section.includes("MTECH1")) return "2028";
  if (section.startsWith("BTECH1")) return "2030";
  if (/2/.test(section)) return "2029";
  if (/3/.test(section)) return "2028";
  if (/4/.test(section)) return "2027";
  return "2028";
}

let rosterCounter = seedData.students.length; // continues after stu-018 / student018@
sectionRoster.forEach(({ section, department }) => {
  for (let seat = 1; seat <= 2; seat += 1) {
    rosterCounter += 1;
    const first = rosterFirstNames[(rosterCounter - 1) % rosterFirstNames.length];
    const last = rosterLastNames[(rosterCounter * 3 - 1) % rosterLastNames.length];
    const emailNumber = String(rosterCounter).padStart(3, "0");
    seedData.students.push({
      id: `stu-${emailNumber}`,
      name: `${first} ${last}`,
      rollNumber: `${section}-${String(seat).padStart(2, "0")}`,
      className: section,
      department,
      email: `student${emailNumber}@example.edu`,
      password: passwordHash,
      cardUid: "",
      fingerprintId: "",
      faceImageUrl: "",
      faceDescriptor: [],
      faceEnrolled: false,
      phone: "",
      guardian: `${last} Family`,
      graduationYear: graduationYearForSection(section),
      approvalStatus: "approved"
    });
  }
});

// Full name/department legend transcribed from the UEM Jaipur Consolidated
// Timetable (Jul-Dec 2026) "Teacher Code -> Name Legend" table. This is now
// the primary source for faculty identity — every code in the legend gets
// an account, whether or not it happens to appear in the (currently still
// partial) demo schedules below. Any additional codes found only in the
// schedules fall back to a generic "Professor <CODE>" placeholder so the
// import never breaks on an unrecognised code.
const teacherProfiles = teacherLegend;

// Teacher cells in the timetable can look like "AYV, LRG :: SBK(ZONE-2)" —
// a main group of teachers, optionally followed by "::" and a substitute
// teacher for a specific lab/zone, in parentheses. Strip the parenthetical
// annotation and split on every separator (including "::") so each code
// comes out clean, e.g. ["AYV", "LRG", "SBK"] rather than one garbled string.
function extractTeacherCodes(teacherCell) {
  return String(teacherCell)
    .replace(/\([^)]*\)/g, "")
    .split(/,|\/|&|::| and /)
    .map((code) => code.trim())
    .filter((code) => code && code !== "All Faculty" && code !== "ALL FACULTIES" && code !== "ALL FACULTY");
}

const teacherCodes = [
  ...new Set([
    // Every code in the official legend gets an account, even before its
    // periods have been transcribed into seedData.schedules (that's Part 2).
    ...Object.keys(teacherLegend),
    ...seedData.schedules.flatMap((item) => extractTeacherCodes(item.teacher))
  ])
].sort();

// Individual faculty accounts can be given a real login instead of the
// per-teacher demo password by setting FACULTY_<CODE>_EMAIL /
// FACULTY_<CODE>_PASSWORD. Anyone not overridden gets a unique, predictable
// demo password of the form "<CODE>@Uem2026" (see credentials PDF).
seedData.teachers = teacherCodes.map((code) => {
  const [name, deptCode] = teacherProfiles[code] || [`Professor ${code}`, "General"];
  const department = departmentNames[deptCode] || deptCode;
  const subjects = [
    ...new Set(
      seedData.schedules
        .filter((item) => extractTeacherCodes(item.teacher).includes(code))
        .map((item) => item.subject)
    )
  ].sort();
  const overrideEmail = process.env[`FACULTY_${code}_EMAIL`];
  const overridePassword = process.env[`FACULTY_${code}_PASSWORD`];
  const defaultPassword = `${code}@Uem2026`;
  // Real, individually-set passwords (via FACULTY_<CODE>_PASSWORD) get a full
  // strength bcrypt cost. The public, already-documented demo default
  // ("<CODE>@Uem2026") gets a much cheaper cost — hashing it expensively buys
  // no real security since the value itself is public, and doing this for
  // every one of the ~110+ teacher accounts on every server start was
  // previously blocking the event loop for several seconds at startup.
  const hashCost = overridePassword ? 10 : 4;
  return {
    id: `tch-${code.toLowerCase()}`,
    code,
    name,
    department,
    email: overrideEmail || `${code.toLowerCase()}@example.edu`,
    password: bcrypt.hashSync(overridePassword || defaultPassword, hashCost),
    role: "teacher",
    phone: "",
    cabin: `Faculty Block ${code}`,
    subjects
  };
});

// Give one student per showcased section a fuller attendance history so
// the attendance/reports views have something realistic to display.
const highAttendanceStudent = seedData.students.find((student) => student.id === "stu-006");
const cse2bHighAttendanceStudent = seedData.students.find((student) => student.id === "stu-010");

const highAttendanceDates = ["2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-10"];
const highAttendanceRecords = highAttendanceStudent
  ? seedData.subjects.flatMap((subject, subjectIndex) =>
      highAttendanceDates.map((date, dateIndex) => ({
        id: `att-${highAttendanceStudent.id}-${subject.id}-${dateIndex + 1}`,
        studentId: highAttendanceStudent.id,
        subjectId: subject.id,
        date,
        status: dateIndex === (subjectIndex % highAttendanceDates.length) ? "absent" : "present",
        time: dateIndex < 3 ? "09:35" : "10:20",
        method: dateIndex % 2 === 0 ? "student-portal" : "manual"
      }))
    )
  : [];

const cse2bHighAttendanceRecords = cse2bHighAttendanceStudent
  ? seedData.subjects
      .filter((subject) => subject.className === cse2bHighAttendanceStudent.className)
      .flatMap((subject, subjectIndex) =>
        highAttendanceDates.map((date, dateIndex) => ({
          id: `att-${cse2bHighAttendanceStudent.id}-${subject.id}-${dateIndex + 1}`,
          studentId: cse2bHighAttendanceStudent.id,
          subjectId: subject.id,
          date,
          status: dateIndex === ((subjectIndex + 1) % highAttendanceDates.length) ? "absent" : "present",
          time: dateIndex < 3 ? "09:40" : "10:25",
          method: dateIndex % 2 === 0 ? "student-portal" : "manual"
        }))
      )
  : [];

const showcaseStudentIds = [highAttendanceStudent?.id, cse2bHighAttendanceStudent?.id].filter(Boolean);
seedData.attendance = [
  ...seedData.attendance.filter((item) => !showcaseStudentIds.includes(item.studentId)),
  ...highAttendanceRecords,
  ...cse2bHighAttendanceRecords
];
