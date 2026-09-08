// Official UEM Jaipur fee structures for Academic Year 2026-27, transcribed
// from the university's published per-program fee sheets. Each program has a
// flat recurring per-semester cost (tuition, hostel, exam) plus one-time
// charges collected with Semester 1. Hostel is optional; Transport is billed
// separately per the bus route chart. See docs/API.md for the /fees/programs
// endpoint that serves this data.

const ONE_TIME_CHARGES = {
  applicationFee: 5000, // non-refundable
  uniformFee: 6000,
  cambridgeAssessment: 3000 // mandatory Cambridge English Certification
};
const ONE_TIME_TOTAL = ONE_TIME_CHARGES.applicationFee + ONE_TIME_CHARGES.uniformFee + ONE_TIME_CHARGES.cambridgeAssessment;

const NOTES = {
  eligibility: "Minimum 60% in Class 10th and 12th",
  paymentSchedule: "Semester 1 is payable at the time of admission and Semester 2 is payable in January.",
  hostel: "Hostel Charges include both Hostel Stay and Mess/Dining charges. A hostel facility is optional.",
  loans: "Education loans and installment facilities are available from all the leading banks.",
  dueDates: "Tuition & other fees per semester are due by 7th July and 7th January of every year. A fine of Rs. 50/- per day applies after the due date.",
  transport: "As per the bus route chart"
};

function buildProgram({ id, program, category, startSemester = 1, endSemester, tuitionFee, hostelFee = 65000, examFee = 2000, includeOneTime = true }) {
  const semesters = [];
  for (let semester = startSemester; semester <= endSemester; semester++) {
    const isFirst = semester === startSemester;
    const oneTime = isFirst && includeOneTime ? ONE_TIME_TOTAL : 0;
    semesters.push({
      semester,
      tuitionFee,
      hostelFee,
      examFee,
      oneTimeCharges: oneTime,
      total: tuitionFee + hostelFee + examFee + oneTime
    });
  }
  const totalFee = semesters.reduce((sum, item) => sum + item.total, 0);
  return { id, program, category, academicYear: "2026-27", semesters, oneTime: includeOneTime ? ONE_TIME_CHARGES : null, transportFee: NOTES.transport, eligibility: NOTES.eligibility, dueDatePolicy: NOTES.dueDates, totalFee };
}

export const feeStructures2026 = [
  buildProgram({ id: "fs-btech-core", program: "B.Tech in Electrical / Mechanical / Civil / Electronics & Communication Engineering", category: "UG", endSemester: 8, tuitionFee: 60000 }),
  buildProgram({ id: "fs-mba-hhm", program: "MBA in Hospital & Healthcare Management", category: "PG", endSemester: 4, tuitionFee: 90000 }),
  buildProgram({ id: "fs-btech-le-cse", program: "B.Tech Lateral Entry in CSE / CSE AI+ML", category: "UG-Lateral", startSemester: 3, endSemester: 8, tuitionFee: 70000 }),
  buildProgram({ id: "fs-bca-ai-sas", program: "BCA in Artificial Intelligence (in association with SAS)", category: "UG", endSemester: 6, tuitionFee: 60000 }),
  buildProgram({ id: "fs-mca", program: "MCA", category: "PG", endSemester: 4, tuitionFee: 40000 }),
  buildProgram({ id: "fs-btech-le-core", program: "B.Tech Lateral Entry in Electrical / Mechanical / Civil / Electronics & Communication Engineering", category: "UG-Lateral", startSemester: 3, endSemester: 8, tuitionFee: 60000 }),
  buildProgram({ id: "fs-btech-cse", program: "B.Tech in CSE / CSE AI+ML", category: "UG", endSemester: 8, tuitionFee: 70000 }),
  buildProgram({ id: "fs-btech-cse-ds-sas", program: "B.Tech in CSE (Data Science, in association with SAS)", category: "UG", endSemester: 8, tuitionFee: 100000 }),
  buildProgram({ id: "fs-mba", program: "MBA", category: "PG", endSemester: 4, tuitionFee: 60000 }),
  buildProgram({ id: "fs-mpt", program: "Master of Physiotherapy (MPT)", category: "PG", endSemester: 4, tuitionFee: 50000 }),
  buildProgram({ id: "fs-bba", program: "BBA", category: "UG", endSemester: 6, tuitionFee: 45000 }),
  buildProgram({ id: "fs-mtech", program: "M.Tech in CSE / EE / ME / CE / ECE", category: "PG", endSemester: 4, tuitionFee: 40000 }),
  buildProgram({ id: "fs-bba-digital-iide", program: "BBA in Digital Business (in association with IIDE)", category: "UG", endSemester: 6, tuitionFee: 60000 }),
  buildProgram({ id: "fs-bca", program: "BCA", category: "UG", endSemester: 6, tuitionFee: 45000 })
];

export const feeStructures2026Notes = NOTES;
