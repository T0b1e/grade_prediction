const GRADE_VALUES = {
  A: 4.0,
  "B+": 3.5,
  B: 3.0,
  "C+": 2.5,
  C: 2.0,
  "D+": 1.5,
  D: 1.0,
  F: 0.0,
};

// Grades that provide credit but no point value (often don't affect GPA like S) or are pending (I)
// Note: S usually counts for 'Collected Credit' but not 'GPA Credit'
// Grades that provide credit but no point value (often don't affect GPA like S) or are pending (I)
// Note: S usually counts for 'Collected Credit' but not 'GPA Credit'
const EXCLUDED_GRADES = ["S", "U", "I", "W", "-", ""];

// Target Subjects for Prediction (User Defined)
const TARGET_SUBJECTS = [
  { code: "CPE 101", name: "", credit: 3 },
  { code: "CPE 231", name: "", credit: 3 },
  { code: "CPE 241", name: "", credit: 3 },
  { code: "CPE 263", name: "", credit: 3 },
  { code: "CPE 270", name: "", credit: 3 },
  { code: "CPE 308", name: "", credit: 3 },
  { code: "CPE 326", name: "", credit: 3 },
  { code: "CPE 327", name: "", credit: 1 },
  { code: "CPE 332", name: "", credit: 3 },
  { code: "CPE 338", name: "", credit: 3 },
  { code: "CPE 360", name: "", credit: 3 },
  { code: "CPE 361", name: "", credit: 3 },
  { code: "CPE 363", name: "", credit: 3 },
  { code: "CPE 419", name: "", credit: 3 },
  { code: "CPE 426", name: "", credit: 3 },
  { code: "CPE 427", name: "", credit: 1 },
  { code: "CPE 432", name: "", credit: 3 },
  { code: "CPE 441", name: "", credit: 3 },
  { code: "CPE 490", name: "", credit: 1 },
  { code: "CPE 491", name: "", credit: 1 },
  { code: "CPE 492", name: "", credit: 2 },
  { code: "GEN 494", name: "(สหกิจ)", credit: 1 },
  { code: "CPE 495", name: "(สหกิจ)", credit: 3 },
];

// References
const loginSection = document.getElementById("login-section");
const mainContent = document.getElementById("main-content");
const btnGo = document.getElementById("btn-go");
const btnReset = document.getElementById("btn-reset");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const errorMessage = document.getElementById("error-message");
const tableBody = document.querySelector("#grade-table tbody");
const currentGpaxEl = document.getElementById("current-gpax");
const predictedGpaxEl = document.getElementById("predicted-gpax");
const predictedCreditsEl = document.getElementById("predicted-credits");
const currentCreditsEl = document.getElementById("current-credits");

// GLOBAL VARS
let currentScrapedData = []; // Will hold the array of semester objects
let courseHistory = {};
let totalPoints = 0;
let totalCredits = 0;

// Event Listeners
btnGo.addEventListener("click", handleLogin);
btnReset.addEventListener("click", clearData);
window.addEventListener("DOMContentLoaded", loadFromStorage);

function loadFromStorage() {
  // 1. Load User Credentials (last used username)
  const savedUser = localStorage.getItem("rsu_username");
  if (savedUser) {
    usernameInput.value = savedUser;
  }

  // 2. Load Scraped Data
  const savedData = localStorage.getItem("rsu_scraped_data");
  if (savedData) {
    try {
      currentScrapedData = JSON.parse(savedData);
      if (currentScrapedData && currentScrapedData.length > 0) {
        // Show dashboard immediately
        loginSection.classList.add("hidden");
        mainContent.classList.remove("hidden");
        btnReset.classList.remove("hidden"); // Show reset button
        processData(currentScrapedData);
      }
    } catch (e) {
      console.error("Error loading saved data", e);
      localStorage.removeItem("rsu_scraped_data");
    }
  }
}

function clearData() {
  localStorage.removeItem("rsu_scraped_data");
  location.reload();
}

async function handleLogin() {
  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();
  const loadingContainer = document.getElementById("loading-container");
  const processLog = document.getElementById("process-log");

  // Reset UI
  errorMessage.classList.add("hidden");
  errorMessage.textContent = "";
  processLog.innerHTML = ""; // Clear previous logs

  if (!username || !password) {
    showError("กรุณากรอกรหัสนักศึกษาและรหัสผ่าน");
    return;
  }

  // UI Loading State
  btnGo.disabled = true;
  loadingContainer.classList.remove("hidden");

  try {
    const response = await fetch("http://localhost:3000/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      // Keep the last chunk if it's incomplete
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);

          if (msg.type === "log") {
            // Append log
            const logItem = document.createElement("div");
            logItem.textContent = `> ${msg.message}`;
            processLog.appendChild(logItem);
            processLog.scrollTop = processLog.scrollHeight; // Auto scroll
          } else if (msg.type === "result") {
            // Success
            currentScrapedData = msg.data;

            // SAVE TO STORAGE
            localStorage.setItem("rsu_username", username);
            localStorage.setItem(
              "rsu_scraped_data",
              JSON.stringify(currentScrapedData)
            );

            processData(currentScrapedData);

            // Switch View
            loginSection.classList.add("hidden");
            mainContent.classList.remove("hidden");
            btnReset.classList.remove("hidden"); // Show reset btn
          } else if (msg.type === "error") {
            throw new Error(msg.message);
          }
        } catch (e) {
          console.error("Error parsing stream chunk", e);
        }
      }
    }
  } catch (err) {
    showError(`เกิดข้อผิดพลาด: ${err.message}`);
  } finally {
    btnGo.disabled = false;
    if (mainContent.classList.contains("hidden")) {
      // If we didn't switch to main content, keep spinner or show error as needed
    } else {
      loadingContainer.classList.add("hidden");
    }
  }
}

function showError(msg) {
  errorMessage.textContent = msg;
  errorMessage.classList.remove("hidden");
}

function processData(scrapedData) {
  // Reset global calcs
  courseHistory = {};
  totalPoints = 0;
  totalCredits = 0;

  scrapedData.forEach((semester) => {
    semester.courses.forEach((course) => {
      // Normalize code (remove spaces, uppercase)
      const code = course.code.replace(/\s+/g, "").toUpperCase();

      courseHistory[code] = {
        grade: course.grade,
        term: semester.semester,
        raw: course,
      };

      const gradeVal = GRADE_VALUES[course.grade];
      if (gradeVal !== undefined) {
        const cr = parseFloat(course.credit);
        totalPoints += gradeVal * cr;
        totalCredits += cr;
      }
    });
  });

  const initialGpax =
    totalCredits > 0 ? (totalPoints / totalCredits).toFixed(2) : "0.00";
  currentGpaxEl.textContent = initialGpax;
  currentCreditsEl.textContent = totalCredits;

  // Render Table
  renderPredictions();
}

// 2. Render Table Function
function renderPredictions() {
  // Clear table
  tableBody.innerHTML = "";

  // Loop through FIXED TARGET SUBJECTS
  TARGET_SUBJECTS.forEach((subject, index) => {
    // Normalize code for matching (scraper usually returns "CPE101", we have "CPE 101")
    const normalize = (s) => s.replace(/\s+/g, "").toUpperCase();
    const code = normalize(subject.code);
    const history = courseHistory[code];

    const tr = document.createElement("tr");

    // No.
    const tdNo = document.createElement("td");
    tdNo.className = "col-no";
    tdNo.textContent = index + 1;
    tr.appendChild(tdNo);

    // Subject (Code + Name)
    const tdSub = document.createElement("td");
    tdSub.className = "col-subject";
    tdSub.textContent = `${subject.code} ${subject.name}`;
    tr.appendChild(tdSub);

    // Credit
    const tdCr = document.createElement("td");
    tdCr.className = "col-credit";
    tdCr.textContent = subject.credit;
    tr.appendChild(tdCr);

    // Grade
    const tdGrade = document.createElement("td");
    tdGrade.className = "col-grade";

    if (history) {
      // Already taken -> Show Grade (Static)
      const span = document.createElement("span");
      span.textContent = history.grade;
      const safeGrade = history.grade.replace("+", "_");
      span.className = `grade-display grade-${safeGrade}`;
      tdGrade.appendChild(span);
    } else {
      // Not taken -> Show Dropdown (Prediction)
      const select = document.createElement("select");
      select.className = "grade-select";
      select.dataset.code = code;
      select.dataset.credit = subject.credit;

      // Options
      const options = ["", "A", "B+", "B", "C+", "C", "D+", "D", "F"];
      options.forEach((opt) => {
        const el = document.createElement("option");
        el.value = opt;
        el.textContent = opt === "" ? "-" : opt;
        select.appendChild(el);
      });

      // Listen for change
      select.addEventListener("change", calculatePrediction);
      tdGrade.appendChild(select);
    }

    tr.appendChild(tdGrade);

    // Term
    const tdTerm = document.createElement("td");
    tdTerm.className = "col-term";
    if (history) {
      // Show term if taken
      const badge = document.createElement("span");
      badge.className = "term-badge";
      const match = history.term.match(/\((.*?)\)/);
      badge.textContent = match ? match[1] : history.term;
      tdTerm.appendChild(badge);
    } else {
      tdTerm.textContent = "-";
    }
    tr.appendChild(tdTerm);

    tableBody.appendChild(tr);
  });

  // Update predicted to match current initially
  calculatePrediction();
}

function calculatePrediction() {
  // Start with base
  let pPoints = totalPoints;
  let pCredits = totalCredits;

  // select all dropdowns
  const selects = document.querySelectorAll(".grade-select");

  selects.forEach((sel) => {
    const val = sel.value;
    if (val && GRADE_VALUES[val] !== undefined) {
      const cr = parseFloat(sel.dataset.credit);
      pPoints += GRADE_VALUES[val] * cr;
      pCredits += cr;
    }
  });

  const pGpax = pCredits > 0 ? (pPoints / pCredits).toFixed(2) : "0.00";
  predictedGpaxEl.textContent = pGpax;
  if (predictedCreditsEl) predictedCreditsEl.textContent = pCredits;
}
