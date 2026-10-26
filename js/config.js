// ─────────────────────────────────────────────────────────────
//  Chitkara Memories — configuration
//  This is the ONLY file you need to edit to go live.
//  Leave FIREBASE_CONFIG.apiKey empty to run in demo mode.
// ─────────────────────────────────────────────────────────────

export const SITE = {
  title: "Chitkara Memories",
  subtitle: "BBA · Digital Science & Business Management",
  coreLabel: "BBA · DS & BM",
};

// The "chapters" of your course. Change labels freely.
// If you change an `id`, update the list in firestore.rules too.
export const YEARS = [
  { id: "y1", label: "1st Year", sub: "The beginning" },
  { id: "y2", label: "2nd Year", sub: "Finding our people" },
  { id: "y3", label: "3rd Year", sub: "The last lap" },
  { id: "fw", label: "Farewell", sub: "Until next time" },
];

export const EVENTS = [
  "Classroom", "Campus", "Fest", "Trip", "Hackathon",
  "Birthday", "Canteen", "Sports", "Farewell", "Random",
];

// 1) Firebase console → Project settings → Your apps → Web app → config
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDT1rhmtkaYqYIXHgg88jANcJJikLRMnh8",
  authDomain: "chitkara-memories.firebaseapp.com",
  projectId: "chitkara-memories",
  storageBucket: "chitkara-memories.firebasestorage.app",
  messagingSenderId: "347708935062",
  appId: "1:347708935062:web:e96dd1dcb3470ae3ad2bb7",
  measurementId: "G-MYRWHWGCQK",
};

// 2) Only Google accounts from this domain can enter the site at all.
export const ALLOWED_EMAIL_DOMAIN = "chitkara.edu.in";

// 3) Admins: can open the Admin panel, see all activity, delete any photo and ban users.
//    Admins may sign in even if their email is not @chitkara.edu.in.
//    Keep this list identical to ADMINS in firestore.rules.
export const ADMIN_EMAILS = [
  "kiratveersinghralhan@gmail.com",
  "kiratveer4791.bbadsbm26@chitkara.edu.in",
];

// 4) Who gets in without waiting for approval.
//    "" = EVERYONE must request access and an admin approves them (safest).
//    ".bbadsbm26@chitkara.edu.in" = your whole batch gets in automatically, everyone else requests.
//    If you set it, also set autoApproveRegex() in firestore.rules (instructions are there).
export const AUTO_APPROVE_SUFFIX = "";

// 5) OPTIONAL: approval emails via EmailJS (free: emailjs.com, ~200 emails/month).
//    Leave empty and approving opens your email app with the message already written.
//    Template variables available: {{to_name}}, {{to_email}}, {{site_url}}, {{site_name}}
export const EMAILJS = {
  publicKey: "",
  serviceId: "",
  templateId: "",
};

// 6) Time capsule letters to the batch unlock on this date (YYYY-MM-DD).
//    Keep identical to the date in firestore.rules (capsules section).
export const CAPSULE_UNLOCK = "2029-05-01";

// 7) OPTIONAL (recommended): free Cloudinary account for full-quality photos.
//    Leave empty and photos are compressed and saved inside Firestore instead.
export const CLOUDINARY = {
  cloudName: "",
  uploadPreset: "", // an *unsigned* upload preset
};

export const MAX_PHOTOS = 250;     // how many recent memories to load (keeps you inside free limits)
export const MAX_FILES_PER_UPLOAD = 10;
