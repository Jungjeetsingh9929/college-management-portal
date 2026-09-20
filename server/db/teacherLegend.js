// Full teacher-code -> {name, department} legend, transcribed from the
// "Teacher Code -> Name Legend" table at the end of the UEM Jaipur
// Consolidated Timetable (Jul-Dec 2026 PDF). This is the single source of
// truth for teacher identity used when seeding faculty accounts.
//
// A few extra rows are added at the bottom for non-code roles that recur
// throughout the timetable (project guides, mentors, the M.Tech VLSI "HOD"
// slot, NPTEL-coordinated sessions) so every cell in the schedule can be
// resolved to *some* named account instead of falling back to a generic
// "Professor <CODE>" placeholder.

export const teacherLegend = {
  AGA: ["Dr. Abheek Gupta", "CSE"],
  AHN: ["Dr. Anurag Hamiltan", "ME"],
  AKJ: ["Mr. Ashutosh Kumar Jha", "HU"],
  AKL: ["Dr. Anamika Khaskel", "CHEM"],
  AKN: ["Dr. Angshuman Khan", "ECE"],
  AKS: ["Dr. Ankit Kumar Sharma", "EE"],
  AKT: ["Mr. Ankesh Kumawat", "CSE"],
  AML: ["Mr. Avishek Mondal", "BCA"],
  ANP: ["Dr. Arnab Palui", "PHY"],
  ARK: ["Dr. Aasifa Reshid Khan", "BPT"],
  ASA: ["Dr. Arushi Saxena", "BPT"],
  ASH: ["Dr. Ashutosh Singh", "BPT"],
  AVJ: ["Mr. Avinash Kumar Jha", "HU"],
  AYV: ["Dr. Anjali", "ECE"],
  BCE: ["Dr. Biswajoy Chatterjee", "CSE"],
  BLS: ["Mr. Bhanwar Lal Saini", "ME"],
  BSY: ["Dr. Bhairu Singh Yadav", "Admin"],
  CVY: ["Dr. Chhavi Vijay", "BPT"],
  DCE: ["Prof. Debajyoti Chaterjee", "CSE"],
  DDS: ["Prof. Debadatta Samal", "EE"],
  DME: ["Prof. Dipta Mukherjee", "CSE"],
  DMJ: ["Mr. Debasish Majhi", "BCA"],
  GGL: ["Prof. Gaurav Ganguly", "BCA"],
  GRG: ["Dr. Govind Rai Goyal", "EE"],
  GSA: ["Dr. Gaurav Shrivastava", "BPT"],
  GSH: ["Dr. Gaurang Singh", "BPT"],
  HBE: ["Prof. Hriday Banerjee", "CSE"],
  HUS: ["Prof. Himanshu Sharma", "EE"],
  IAD: ["Prof. Md. Iqbal Ahmed", "ME"],
  IKN: ["Dr. Imran Khan", "BPT"],
  JAD: ["Prof. Jyoti Anand", "CSE"],
  JNS: ["Dr. J.N. Singh", "MBA"],
  KJT: ["Dr. Kavita Jat", "MATHS"],
  KKA: ["Prof. Krishna Kumar Sharma", "HU"],
  KKK: ["Mr. Kamal Kishore Kumawat", "CHEM"],
  KKS: ["Mr. Krishan Kumar Sharma", "HU"],
  KLB: ["Prof. Kanhaiya Lal Bunkar", "ECE"],
  KVK: ["Prof. K.V. Kuriakose", "HU"],
  LRG: ["Mr. Ladu Ram Gujar", "ECE"],
  MKJ: ["Mr. Manish Kumar Jangir", "PHY"],
  MSA: ["Dr. Manisha Singh", "MBA"],
  MSH: ["Prof. Mandeep Singh", "ME"],
  MYV: ["Dr. Mukesh Yadav", "HU"],
  NKM: ["Mr. Nabin Kumar Mahato", "BCA"],
  NSA: ["Ms. Nabanita Saha", "HU"],
  NVS: ["Dr. Neha Vyas", "BPT"],
  PCA: ["Dr. Praphulla Chhabra", "MATH"],
  PJR: ["Dr. Poonam Jakhar", "BPT"],
  PKB: ["Prof. Pravesh Kumar Bansal", "CSE"],
  PKS: ["Dr. Pradeep Kr. Sharma", "PHY"],
  PMK: ["Prof. Pallavi Malik", "MATH"],
  PML: ["Mr. Prabitra Mondal", "BCA"],
  PPA: ["Dr. Poonam Poonia", "BCA"],
  PRN: ["Dr. Prashant Ranjan", "ECE"],
  PSA: ["Dr. Preeti Sharma", "MBA"],
  PSH: ["Dr. Pawan Sharma", "MBA"],
  RDS: ["Ms. Rishita Das", "MBA"],
  RHS: ["Dr. Rahul Sharma", "MBA"],
  RJN: ["Ms. Rajni", "HU"],
  RKG: ["Dr. Rakesh Kumar Garg", "CSE"],
  RKJ: ["Prof. Rakesh Kumar Jangid", "CE"],
  RKL: ["Dr. Riya Khandelwal", "BPT"],
  RME: ["Ms. Rhythm Mukherjee", "MBA"],
  RMU: ["Mr. Ravindra Maanju", "ME"],
  RRR: ["Dr. Ruma Rajbhar", "BPT"],
  RSA: ["Ms. Risha Sharma", "MBA"],
  RSY: ["Dr. Rakesh Sondliya", "BPT"],
  SAB: ["Ms. Sanchari Basak", "HU"],
  SAE: ["Mr. Sayak Acharjee", "MBA"],
  SAP: ["Prof. Sayak Pramanik", "BCA"],
  SBE: ["Mr. Sougata Banerjee", "CE"],
  SBK: ["Prof. Santanu Basak", "CSE"],
  SCH: ["Prof. Sasthi Charan Hens", "ME"],
  SCY: ["Prof. Subhro Chakraborty", "CE"],
  SDA: ["Dr. Snehalata Dhaka", "HU"],
  SGH: ["Prof. Sagarika Ghosh", "CSE"],
  SKR: ["Mr. Sudheer Kumar", "CSE"],
  SMC: ["Prof. Shivam Chauhan", "CE"],
  SMD: ["Ms. Sikta Mandal", "ECE"],
  SML: ["Dr. Sapna Malla", "BPT"],
  SPK: ["Prof. Sweta Pareek", "MBA"],
  SPL: ["Prof. Shubhajit Pal", "EE"],
  SPR: ["Mr. Sandeep Patidar", "BCA"],
  SRI: ["Prof. Sudha Rani", "BPT"],
  SSA: ["Prof. Samrat Saha", "EE"],
  SSI: ["Prof. Shivani Saini", "HU"],
  SSK: ["Mr. Soumen Sarkar", "CSE"],
  SSR: ["Prof. Surajit Sur", "ECE"],
  SUB: ["Ms. Subhra Banerjee", "BPT"],
  SVB: ["Mr. Sourrav Banerjee", "MBA"],
  SVC: ["Mr. Sourav Chakraborty", "CSE"],
  SYN: ["Mr. Soumya Sen", "CSE"],
  TRY: ["Mr. Turjo Roy", "BCA"],
  TSA: ["Dr. Tarun Sharma", "MATH"],
  TSI: ["Dr. Tapas Si", "CSE"],
  UDI: ["Dr. G. Uma Devi", "CSE"],
  UGI: ["Prof. Umesh Gurnani", "ME"],
  UKD: ["Dr. Umesh Kumar Das", "CE"],
  UNT: ["Prof. Uttam Narendra Thakur", "ECE"],
  VDI: ["Mr. Vishal Dabhi", "HU"],
  VJD: ["Prof. Varun Jangid", "CE"],
  VJK: ["Dr. Vishwajeet Khan", "CE"],
  VKY: ["Prof. Vinod Kumar Yadav", "ME"],
  VPS: ["Mr. Ved Prakash Sharma", "ME"],
  YKJ: ["Dr. Yogesh Kumar Jakhar", "BCA"],

  // Not individually coded in the legend, but used repeatedly in the
  // schedule as a named person rather than a code:
  DRAKESH: ["Dr. Rakesh", "BPT"],

  // These two codes are used repeatedly in the schedule tables (e.g. CSE
  // 3rd Year PCCCS504/PCCCS594, and as one of the "Speech by Students"
  // facilitators) but were missing from the PDF's own legend table — kept
  // as placeholder names until the university confirms the real ones.
  SRK: ["Professor SRK (name pending confirmation)", "CSE"],
  MKY: ["Professor MKY (name pending confirmation)", "HU"],

  // Recurring non-subject-teacher roles that appear as the "teacher" cell
  // for whole categories of periods (M.Tech projects/dissertations, NPTEL
  // slots, the shared M.Tech VLSI faculty slot). Kept as placeholder
  // accounts so the schedule importer in Part 2 has somewhere to point.
  HOD: ["Head of Department (VLSI)", "ECE"],
  GUIDE: ["Project Guide (assigned per student)", "General"],
  MENTOR: ["Mentor (assigned per section)", "General"],
  NPTEL: ["NPTEL Coordinator", "Online Learning"]
};

// Full department-code -> display-name mapping, for nicer UI labels.
export const departmentNames = {
  CSE: "Computer Science & Engineering",
  ECE: "Electronics & Communication Engineering",
  EE: "Electrical Engineering",
  ME: "Mechanical Engineering",
  CE: "Civil Engineering",
  BCA: "Computer Applications",
  MBA: "Business Administration",
  BPT: "Physiotherapy",
  MATH: "Mathematics",
  MATHS: "Mathematics",
  PHY: "Physics",
  CHEM: "Chemistry",
  HU: "Humanities",
  Admin: "Administration",
  "Online Learning": "Online Learning",
  General: "General"
};
