const puppeteer = require("puppeteer");

// Accept a log callback to stream updates to client
async function scrapeGrades(
  username,
  password,
  logCallback = (msg) => console.log(msg)
) {
  logCallback(`[Scraper] Starting process for user: ${username}`);

  // Using configuration that matches the working scrape_grade.js
  const browser = await puppeteer.launch({
    headless: "new", // Must be headless in Docker
    defaultViewport: null,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--start-maximized"],
  });

  try {
    const page = await browser.newPage();

    // ASP.NET sites often block or misbehave with HeadlessChrome User-Agent
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // 1. Navigate to SignIn
    logCallback("[Scraper] กำลังเข้าสู่หน้า Login..."); // Navigating to login page
    await page.goto("https://intranet.rsu.ac.th/suWeb/SignIn.aspx");

    // 2. Input Credentials
    logCallback("[Scraper] กำลังกรอกรหัสนักศึกษาและรหัสผ่าน..."); // Entering credentials
    // Waiting a bit for page load safety
    await new Promise((r) => setTimeout(r, 2000));
    await page.type("#txtUserName", username);
    await page.type("#txtPassword", password);

    // 3. Login
    logCallback("[Scraper] กำลังกดปุ่มเข้าสู่ระบบ..."); // Clicking login

    // Listen for the new target (popup window)
    const newTargetPromise = browser.waitForTarget(
      (target) => target.opener() === page.target()
    );

    await page.click("#btnLogIn");

    const newTarget = await newTargetPromise;
    const popupPage = await newTarget.page();

    if (!popupPage) {
      throw new Error(
        "Login failed or popup blocked. Please check your credentials."
      );
    }

    logCallback(`[Scraper] หน้าต่างใหม่เปิดขึ้น: ${popupPage.url()}`); // Popup opened

    // Wait for Agreement Button
    try {
      await popupPage.waitForSelector("#Button1", { timeout: 10000 });
    } catch (e) {
      throw new Error("Agreement button not found. Login might have failed.");
    }

    // 4. Click Agreement
    logCallback("[Scraper] ยอมรับข้อตกลง (Agreement)..."); // Clicking Agreement
    await Promise.all([
      popupPage.waitForNavigation(),
      popupPage.click("#Button1"),
    ]);

    if (!popupPage.url().includes("Main.aspx")) {
      throw new Error("Failed to reach Main.aspx");
    }

    // 5. Navigate to Grades
    logCallback("[Scraper] กำลังรอหน้าต่างหลักโหลด..."); // Waiting for frames
    await new Promise((r) => setTimeout(r, 3000));

    const frames = popupPage.frames();

    let menuFrame = null;

    for (const frame of frames) {
      const name = frame.name();
      try {
        // Check if this frame contains the specific text
        const hasText = await frame.evaluate(() => {
          return (
            document.body &&
            (document.body.innerText.includes("Grade Information") ||
              document.body.innerText.includes("ข้อมูลผลการเรียน"))
          );
        });

        if (hasText) {
          menuFrame = frame;
          break;
        }
      } catch (e) {}
    }

    if (!menuFrame) {
      // Fallback: try finding by common name
      menuFrame = popupPage
        .frames()
        .find((f) => f.name() === "fraMenu" || f.name() === "leftFrame");
    }

    if (!menuFrame) throw new Error("Menu frame not found");

    // Click Menu Item (using evaluate for reliability)
    logCallback('[Scraper] เลือกเมนู "ข้อมูลผลการเรียน"...'); // Clicking Menu Item
    await menuFrame.evaluate(() => {
      const tds = Array.from(document.querySelectorAll("td"));
      const targetTd = tds.find(
        (td) =>
          td.innerText.includes("Grade Information") ||
          td.innerText.includes("ข้อมูลผลการเรียน")
      );
      if (targetTd) targetTd.click();
    });

    await new Promise((r) => setTimeout(r, 1000));

    // Click Link
    logCallback('[Scraper] เลือกเมนูย่อย "สอบถามผลการเรียนรวม"...'); // Clicking GPA Link
    const linkClicked = await menuFrame.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a"));
      const targetLink = anchors.find((a) =>
        a.href.includes("NewRSGD0410.aspx")
      );
      if (targetLink) {
        targetLink.click();
        return true;
      }
      return false;
    });

    if (!linkClicked) throw new Error("Grade link not found");

    // Wait for Right Frame
    logCallback("[Scraper] กำลังรอตารางเกรดแสดงผล..."); // Waiting for Grade Table
    const targetFrameName = "fraRightFrame";
    await new Promise((r) => setTimeout(r, 2000));

    const rightFrame = popupPage
      .frames()
      .find((f) => f.name() === targetFrameName);
    if (!rightFrame) throw new Error(`Frame ${targetFrameName} not found`);

    await rightFrame.waitForSelector("#grdShowYear", { timeout: 30000 });

    // Capture browser console logs and send to UI
    page.on("console", (msg) => logCallback(`[Browser] ${msg.text()}`));

    // Extract Data
    logCallback("[Scraper] กำลังดึงข้อมูลเกรด..."); // Extracting Data

    // Wait extra time for the table content to fully render inside the frame
    await new Promise((r) => setTimeout(r, 2000));

    // Re-acquire the frame to ensure we have the latest context
    const latestRightFrame = popupPage
      .frames()
      .find((f) => f.name() === "fraRightFrame");
    if (!latestRightFrame)
      throw new Error("Could not find right frame for extraction");

    const grades = await latestRightFrame.evaluate(() => {
      console.log("Starting extraction...");
      const results = [];
      // Find all semester headers via the Term Label
      const termLabels = Array.from(
        document.querySelectorAll('span[id*="_lblTerm"]')
      );

      console.log(`Found ${termLabels.length} term labels.`);

      if (termLabels.length === 0) {
        // Debug: what IS in the body?
        console.log("Body length:", document.body.innerHTML.length);
        console.log(
          "First 500 chars:",
          document.body.innerText.substring(0, 500)
        );
        return {
          error: "No term labels found. Elements found: " + termLabels.length,
        };
      }

      termLabels.forEach((termLbl) => {
        const blockObj = {};

        // Navigate up to find the semester container table
        const semesterTableHeaderRow = termLbl.closest("tr");
        const semesterTable = semesterTableHeaderRow.closest("table");

        console.log("Processing term:", termLbl.innerText);

        // Get Semester Info
        const term = termLbl.innerText.trim();
        const yearE =
          semesterTable
            .querySelector('span[id*="_lblYearE"]')
            ?.innerText.trim() || "";
        const semesterText =
          semesterTable
            .querySelector('span[id*="_lblSemester"]')
            ?.innerText.trim() || "";
        const yearT =
          semesterTable
            .querySelector('span[id*="_lblYearT"]')
            ?.innerText.trim() || "";

        blockObj.semester = `${term} ${yearE} (Sem ${semesterText}/${yearT})`;

        // Get Grades
        const gradeTable = semesterTable.querySelector(
          'table[id*="_grdShowGrade2"]'
        );

        blockObj.courses = [];
        if (gradeTable) {
          const rows = Array.from(gradeTable.querySelectorAll("tr"));
          console.log(`  Found grade table with ${rows.length} rows.`);
          // Skip header row (index 0)
          for (let i = 1; i < rows.length; i++) {
            const cells = rows[i].querySelectorAll("td");
            if (cells.length >= 4) {
              blockObj.courses.push({
                code: cells[0].innerText.trim(),
                name: cells[1].innerText.trim(),
                credit: cells[2].innerText.trim(),
                grade: cells[3].innerText.trim(),
              });
            }
          }
        } else {
          console.log("  No grade table found for this term.");
        }

        results.push(blockObj);
      });

      console.log("Extraction complete. Results count:", results.length);
      return results;
    });

    if (grades && grades.error) {
      throw new Error("Extraction warning: " + grades.error);
    }

    return grades;
  } catch (error) {
    logCallback(`[Scraper Error] เกิดข้อผิดพลาด: ${error.message}`);
    throw error;
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeGrades };
