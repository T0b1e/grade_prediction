const puppeteer = require('puppeteer');

(async () => {
    // Launch the browser
    // headless: false to allow seeing the browser window as requested
    const browser = await puppeteer.launch({
        headless: true,
        defaultViewport: null,
        args: ['--start-maximized'] // Open maximized
    });

    try {
        const page = await browser.newPage();

        // 1. Navigate to the Sign In page
        console.log('Navigating to login page...');
        await page.goto('https://intranet.rsu.ac.th/suWeb/SignIn.aspx');

        // 2. Input Username and Password
        console.log('Entering credentials...');
        await page.type('#txtUserName', 'u6505065');
        
        // TODO: Replace with the actual password
        // 'assume correct password' as per instructions
        const password = '.Na592600'; 
        await page.type('#txtPassword', password);

        // 3. Handle Login and Popup
        console.log('Clicking login...');
        
        // Listen for the new target (popup window)
        const newTargetPromise = browser.waitForTarget(target => target.opener() === page.target());

        await page.click('#btnLogIn');

        const newTarget = await newTargetPromise;
        const popupPage = await newTarget.page();

        if (!popupPage) {
            throw new Error('Failed to get the popup page object.');
        }

        console.log(`Popup opened: ${popupPage.url()}`);

        // Wait for the Agreement page to load its content
        // verify url contains RegisterAgreement
        await popupPage.waitForSelector('#Button1');

        // 4. Click the "Agree" (ตกลง) button
        console.log('Clicking Agreement button...');
        
        // The button click triggers a redirect (window.location='../Main.aspx')
        await Promise.all([
            popupPage.waitForNavigation(), // Wait for the redirect to complete
            popupPage.click('#Button1')
        ]);

        console.log(`Redirected to: ${popupPage.url()}`);

        // 5. Verify landing on Main.aspx
        if (popupPage.url().includes('Main.aspx')) {
            console.log('Successfully reached Main.aspx in the popup window.');

            // Wait for frames to load
            console.log('Waiting for frames to populate...');
            await new Promise(r => setTimeout(r, 3000)); 

            const frames = popupPage.frames();
            console.log(`Total frames found: ${frames.length}`);
            
            let menuFrame = null;
            
            for (const frame of frames) {
                const name = frame.name();
                const url = frame.url();
                console.log(`Checking frame: Name="${name}" URL="${url}"`);
                
                try {
                    // Check if this frame contains the specific text
                    // We use evaluate to check innerText which is safer than raw HTML content for text matching
                    const hasText = await frame.evaluate(() => {
                        return document.body && (
                            document.body.innerText.includes('Grade Information') || 
                            document.body.innerText.includes('ข้อมูลผลการเรียน')
                        );
                    });

                    if (hasText) {
                        console.log(`-> Found target text in frame: "${name}"`);
                        menuFrame = frame;
                        break; 
                    }
                } catch (e) {
                    console.log(`-> Error checking frame "${name}": ${e.message}`);
                }
            }

            if (!menuFrame) {
                 console.warn("Target text not found via iteration.");
                 // Fallback: try finding by common name
                 console.log("Attempting fallback to 'leftFrame' or 'fraMenu'...");
                 menuFrame = popupPage.frames().find(f => f.name() === 'fraMenu' || f.name() === 'leftFrame');
            }

            if (!menuFrame) {
                // Last resort debug: print titles or structure?
                throw new Error("Menu frame not found after exhaustive search.");
            }
            console.log(`Selected menu frame: ${menuFrame.name()}`);

            // Try to find the specific TD element first, then click it?
            // User provided: <td align="left" bgcolor="#9999ff" colspan="2">ข้อมูลผลการเรียน / Grade Information</td>
            // This TD likely contains the click event or wraps the link/text.
            
            console.log("Searching for the 'radish' colored TD or text...");
            
            // Fix: frame.$x might not be exposed directly in some Puppeteer versions or contexts 
            // We'll use evaluate to find the element and click it
            const clicked = await menuFrame.evaluate(() => {
                // Find all TDs
                const tds = Array.from(document.querySelectorAll('td'));
                // Find the one with the text
                const targetTd = tds.find(td => td.innerText.includes('Grade Information') || td.innerText.includes('ข้อมูลผลการเรียน'));
                
                if (targetTd) {
                    targetTd.click();
                    return true;
                }
                return false;
            });

            if (clicked) {
                console.log("Click action executed via evaluate.");
            } else {
                 console.warn("Could not find element via DOM traversal. Dumping body text...");
                 const bodyText = await menuFrame.evaluate(() => document.body.innerText);
                 console.log(bodyText.substring(0, 500) + "...");
                 throw new Error("Could not find clickable 'Grade Information' element.");
            }

            // Wait for the expansion (if any)
            // await new Promise(r => setTimeout(r, 500));

            // Find the link
            console.log("Searching for 'Grade Point Average' link...");
            
            // Selector for <a> beginning with "2." or containing href "NewRSGD0410.aspx"
            // We use evaluate again to be safe given the frame context issues
            const linkClicked = await menuFrame.evaluate(() => {
                 const anchors = Array.from(document.querySelectorAll('a'));
                 const targetLink = anchors.find(a => a.href.includes('NewRSGD0410.aspx'));
                 if (targetLink) {
                     targetLink.click();
                     return true;
                 }
                 return false;
            });

            if (linkClicked) {
                console.log("Link found and clicked.");
            } else {
                console.error("Failed to find 'Grade Point Average' link.");
                const links = await menuFrame.evaluate(() => Array.from(document.querySelectorAll('a')).map(a => a.href));
                console.log("Available links in menu frame:", links);
                throw new Error("Link not found");
            }

            // Wait for the target frame "fraRightFrame" to load the grade content
            console.log("Waiting for grade content to load in right frame...");
            const targetFrameName = 'fraRightFrame';
            
            // Wait a bit for the frame navigation to start
            await new Promise(r => setTimeout(r, 2000));

            // Locate the frame
            const rightFrame = popupPage.frames().find(f => f.name() === targetFrameName);
            if (!rightFrame) {
                 throw new Error(`Frame ${targetFrameName} not found`);
            }

            // Wait for the table to appear in the right frame
            try {
                await rightFrame.waitForSelector('#grdShowYear', { timeout: 30000 });
                console.log("Grade table found. Extracting data...");
            } catch (e) {
                console.error("Timeout waiting for #grdShowYear. Dumping frame content...");
                // console.log(await rightFrame.content()); // Debug if needed
                throw e;
            }

            // Extract Data
            const grades = await rightFrame.evaluate(() => {
                const results = [];
                // Find all semester headers via the Term Label
                const termLabels = Array.from(document.querySelectorAll('span[id*="_lblTerm"]'));
                
                termLabels.forEach(termLbl => {
                    const blockObj = {};
                    
                    // Navigate up to find the semester container table
                    const semesterTableHeaderRow = termLbl.closest('tr');
                    const semesterTable = semesterTableHeaderRow.closest('table'); 
                    
                    // Get Semester Info
                    const term = termLbl.innerText.trim();
                    const yearE = semesterTable.querySelector('span[id*="_lblYearE"]')?.innerText.trim() || "";
                    const semesterText = semesterTable.querySelector('span[id*="_lblSemester"]')?.innerText.trim() || "";
                    const yearT = semesterTable.querySelector('span[id*="_lblYearT"]')?.innerText.trim() || "";
                    
                    blockObj.semester = `${term} ${yearE} (Sem ${semesterText}/${yearT})`;
                    
                    // Get Grades
                    const gradeTable = semesterTable.querySelector('table[id*="_grdShowGrade2"]');
                    blockObj.courses = [];
                    if (gradeTable) {
                        const rows = Array.from(gradeTable.querySelectorAll('tr'));
                        // Skip header row (index 0)
                        for (let i = 1; i < rows.length; i++) {
                            const cells = rows[i].querySelectorAll('td');
                            if (cells.length >= 4) {
                                blockObj.courses.push({
                                    code: cells[0].innerText.trim(),
                                    name: cells[1].innerText.trim(),
                                    credit: cells[2].innerText.trim(),
                                    grade: cells[3].innerText.trim(),
                                });
                            }
                        }
                    }
                    
                    // Get Summary (GPA)
                    const summaryTable = semesterTable.querySelector('table[id*="_tblRegister"]');
                    if (summaryTable) {
                         const semGPA = summaryTable.querySelector('span[id*="_lblGPA3"]')?.innerText.trim().replace('GPA :', '').trim();
                         const cumGPA = summaryTable.querySelector('span[id*="_lblGPA4"]')?.innerText.trim().replace('GPA :', '').trim();
                         
                         blockObj.gpa = semGPA;
                         blockObj.cumulative_gpa = cumGPA;
                    }
                    
                    results.push(blockObj);
                });
                
                return results;
            });
            
            console.log("Scraping Completed. Data:");
            console.log(JSON.stringify(grades, null, 2));

        } else {
            console.warn('Current URL does not match Main.aspx');
        }

    } catch (error) {
        console.error('An error occurred:', error);
    } finally {
        // Keeping the browser open for verification as per "just finish this process at first"
        // Uncomment the line below to close automatically
        // await browser.close();
    }
})();
