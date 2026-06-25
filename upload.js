const { chromium } = require("playwright");
const https = require("https");
const fs = require("fs");

const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1MrwItyy6IPNLSJbz1b53TGOTS2JBLTyg46Ql9xZpI6w/gviz/tq?tqx=out:csv&sheet=PinterestQueue";

const DONE_WEBAPP =
  "https://script.google.com/macros/s/AKfycbzoGS8mMJDO_ghnUltSPIIQNhpFHn-y6zpamAATFjuMHTgTkV3ESnEtXQ7W_3D05JwJJw/exec";

function downloadFile(url, path) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(path);
    https.get(url, (res) => {
      res.pipe(file);
      file.on("finish", () => {
        file.close(resolve);
      });
    }).on("error", reject);
  });
}

// UI changes ke liye Generic Helper Function
async function trySelectors(page, selectors, timeout = 4000) {
  for (const selector of selectors) {
    try {
      const el = page.locator(selector).first();
      await el.waitFor({ state: "visible", timeout: timeout });
      return { element: el, selector: selector };
    } catch (e) {
      // Agla selector try karega
    }
  }
  return null;
}

(async () => {
  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    storageState: "state.json"
  });

  const page = await context.newPage();

  try {
    console.log("📊 Fetching Sheet Data...");
    const sheetRaw = await (await fetch(SHEET_CSV_URL)).text();

    const rows = sheetRaw
      .trim()
      .split("\n")
      .map(line =>
        line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g)
          ?.map(v => v.replace(/^"|"$/g, "").trim())
      );

    let row = null;
    for (let i = 1; i < rows.length; i++) {
      const url = (rows[i]?.[0] || "").trim();
      const caption = (rows[i]?.[1] || "").trim();
      const link = (rows[i]?.[2] || "").trim();
      const status = (rows[i]?.[3] || "")
        .replace(/\r/g, "")
        .trim()
        .toUpperCase();

      if (url && status === "PENDING") {
        row = { url, caption, link, index: i };
        break;
      }
    }

    if (!row) throw new Error("No PENDING row found in PinterestQueue sheet");

    console.log("⬇ Downloading MP4...");
    await downloadFile(row.url, "video.mp4");

    console.log("Opening Pinterest...");
    await page.goto("https://www.pinterest.com/pin-creation-tool/", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(8000);

    // Screenshot: Before Upload
    await page.screenshot({ path: "before_upload.png", fullPage: true });

    console.log("Uploading video...");
    await page.setInputFiles('input[type="file"]', "video.mp4");

    console.log("Waiting for video processing...");
    await page.waitForTimeout(25000);

    // Screenshot: After Upload
    await page.screenshot({ path: "after_upload.png", fullPage: true });

    // 1. Title Selection
    console.log("Setting title...");
    const titleSelectors = [
      'input[placeholder*="title" i]',
      'textarea[placeholder*="title" i]',
      '[aria-label*="title" i]',
      '[data-test-id*="title"]',
      '[contenteditable="true"]',
      'input[type="text"]'
    ];

    const titleResult = await trySelectors(page, titleSelectors, 6000);
    if (!titleResult) {
      throw new Error("Publish validation failed: Title field not found");
    }

    try {
      await titleResult.element.click();
      await titleResult.element.fill(row.caption);
    } catch {
      await titleResult.element.press("Control+A");
      await titleResult.element.type(row.caption);
    }
    console.log(`✅ Title added using: ${titleResult.selector}`);

    // 2. Description Selection
    console.log("Setting description...");
    const descriptionSelectors = [
      'textarea[placeholder*="description" i]',
      '[aria-label*="description" i]',
      '[data-test-id*="description"] [contenteditable="true"]',
      '[data-test-id*="description"] textarea',
      '[data-test-id="pin-draft-description"]',
      'div[contenteditable="true"]:nth-of-type(2)'
    ];
    
    const descResult = await trySelectors(page, descriptionSelectors, 4000);
    if (descResult) {
      try {
        await descResult.element.click();
        await descResult.element.fill(row.caption);
      } catch {
        await descResult.element.press("Control+A");
        await descResult.element.type(row.caption);
      }
      console.log(`✅ Description added using: ${descResult.selector}`);
    } else {
      console.log("⚠️ Description field skipped (Optional)");
    }

    // 3. Link Selection (With More Backups)
    console.log("Adding Destination link...");
    const linkSelectors = [
      'input[placeholder*="link" i]',
      'input[placeholder*="destination" i]',
      'input[placeholder*="website" i]',
      'input[id*="link" i]',
      'input[type="url"]',
      '[data-test-id*="link"] input'
    ];
    const linkResult = await trySelectors(page, linkSelectors, 4000);
    if (linkResult) {
      await linkResult.element.fill(row.link);
      console.log(`✅ Link added using: ${linkResult.selector}`);
    } else {
      console.log("⚠️ Link field skipped");
    }

    // 4. Board Selection Dropdown (Massive Selector Backup)
    console.log("Selecting board...");
    const boardDropdownSelectors = [
      'div[role="button"]:has-text("Choose a board")',
      'button:has-text("Choose a board")',
      '[data-test-id*="board-picker"]',
      '[data-test-id="board-dropdown-select"]',
      'div[role="combobox"]',
      'button[aria-haspopup="listbox"]',
      'div[role="button"] .fAL', // Pinterest specific classes fallbacks
      'div:has-text("Choose a board")[role="button"]'
    ];
    
    const dropdownResult = await trySelectors(page, boardDropdownSelectors, 6000);
    if (!dropdownResult) {
      throw new Error("Publish validation failed: Board selector dropdown not found");
    }
    
    await dropdownResult.element.click();
    console.log(`✅ Board dropdown opened using: ${dropdownResult.selector}`);
    await page.waitForTimeout(3000);

    // Board Item Selection (Multiple match variations)
    const boardItemSelectors = [
      'text=Trendy283',
      'text=Trendy zone',
      '[title="Trendy283"]',
      '[title="Trendy zone"]',
      'div[role="listitem"]:has-text("Trendy283")',
      'div[role="option"]:has-text("Trendy283")',
      'div[role="listitem"]:has-text("Trendy zone")'
    ];
    
    const boardItemResult = await trySelectors(page, boardItemSelectors, 4000);
    if (!boardItemResult) {
      throw new Error("Publish validation failed: Exact Board name item not found in dropdown");
    }
    
    await boardItemResult.element.click();
    console.log(`✅ Board selected successfully using: ${boardItemResult.selector}`);
    await page.waitForTimeout(2000);

    // Screenshot: Before Publish
    await page.screenshot({ path: "before_publish.png", fullPage: true });

    // 5. Publish Process & Validation
    console.log("Publishing...");
    const publishSelectors = [
      'button:has-text("Publish")',
      '[data-test-id*="publish"]',
      'button[type="submit"]',
      'div[role="button"]:has-text("Publish")'
    ];

    const publishBtnResult = await trySelectors(page, publishSelectors, 5000);
    if (!publishBtnResult) {
      throw new Error("Publish validation failed: Publish button not found");
    }

    await publishBtnResult.element.click();
    console.log(`👉 Publish clicked using: ${publishBtnResult.selector}. Waiting for validation...`);

    // Strict success checking
    const successIndicators = [
      'text="You created a Pin!"',
      'text="See your Pin"',
      'a[href*="/pin/"]',
      '[data-test-id="toast-message"]',
      'text="Your Pin has been published"'
    ];
    
    const successResult = await trySelectors(page, successIndicators, 15000);
    
    if (!successResult) {
      await page.screenshot({ path: "publish_failed.png", fullPage: true });
      throw new Error("Publish validation failed: Clicked publish but confirmation indicator not found!");
    }

    console.log(`🎉 Confirmation detected via: ${successResult.selector}`);

    // Screenshot: After Publish Success
    await page.screenshot({ path: "after_publish.png", fullPage: true });

    // Status Update
    console.log("Updating sheet status...");
    await fetch(DONE_WEBAPP + "?row=" + (row.index + 1));
    console.log("✅ Sheet status updated to DONE");

    console.log("✅ UPLOAD COMPLETE");

  } catch (e) {
    console.error("❌ ERROR EXECUTING WORKFLOW:", e.message);
    
    await page.screenshot({
      path: "error.png",
      fullPage: true
    });
  } finally {
    await browser.close();
  }
})();
