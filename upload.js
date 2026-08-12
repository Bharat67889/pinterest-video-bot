const { chromium } = require("playwright");
const https = require("https");
const fs = require("fs");
const { execSync } = require("child_process"); // Codec conversion ke liye

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
      .map(line => line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g)?.map(v => v.replace(/^"|"$/g, "").trim()));
    
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
    await downloadFile(row.url, "input.mp4");
    
    // Video ko Pinterest compatible H.264 format me convert karna
    console.log("🔄 Re-encoding video to H.264 format...");
    execSync("ffmpeg -y -i input.mp4 -c:v libx264 -pix_fmt yuv420p -c:a aac converted.mp4");
    
    console.log("Opening Pinterest...");
    await page.goto("https://www.pinterest.com/pin-creation-tool/", { waitUntil: "domcontentloaded", timeout: 60000 });
    
    console.log("⏳ Page loaded. Waiting 10 seconds...");
    await page.waitForTimeout(10000);
    
    // Screenshot: Before Upload
    await page.screenshot({ path: "before_upload.png", fullPage: true });
    
    console.log("Uploading converted video...");
    await page.setInputFiles('input[type="file"]', "converted.mp4");
    
    console.log("Waiting for video processing (25 seconds)...");
    await page.waitForTimeout(25000);
    
    console.log("⏳ Extra padding. Waiting 10 seconds...");
    await page.waitForTimeout(10000);
    
    // Screenshot: After Upload
    await page.screenshot({ path: "after_upload.png", fullPage: true });
    
    // 1. Title Selection (Optimized Selectors)
    console.log("Setting title...");
    const titleSelectors = [
      'input[id="storyboard-selector-title"]',
      'input[placeholder*="title" i]',
      'textarea[placeholder*="title" i]',
      '[data-test-id="pin-draft-title"] input',
      '[data-test-id*="title"]',
      'input[type="text"]'
    ];
    
    const titleResult = await trySelectors(page, titleSelectors, 10000);
    if (!titleResult) {
      throw new Error("Publish validation failed: Title field not found or video format error");
    }
    
    // Check if title input is enabled
    if (await titleResult.element.isDisabled()) {
      throw new Error("Title input is disabled! Video upload rejected by Pinterest.");
    }
    
    await titleResult.element.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(500);
    
    await titleResult.element.fill(row.caption);
    
    console.log(`✅ Title added using: ${titleResult.selector}`);
    console.log("⏳ Title set. Waiting 10 seconds...");
    await page.waitForTimeout(10000);
    
    // 2. Description Selection
    console.log("Setting description...");
    const descriptionSelectors = [
      'textarea[placeholder*="description" i]',
      '[data-test-id="pin-draft-description"] textarea',
      '[aria-label*="description" i]',
      '[data-test-id*="description"] [contenteditable="true"]',
      'div[contenteditable="true"]:nth-of-type(2)'
    ];
    
    const descResult = await trySelectors(page, descriptionSelectors, 4000);
    if (descResult) {
      await descResult.element.click();
      await page.keyboard.press("Control+A");
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(500);
      
      await descResult.element.fill(row.caption);
      console.log(`✅ Description added using: ${descResult.selector}`);
    } else {
      console.log("⚠️ Description field skipped (Optional)");
    }
    
    console.log("⏳ Description set. Waiting 10 seconds...");
    await page.waitForTimeout(10000);
    
    // 3. Link Selection
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
      await linkResult.element.click();
      await page.keyboard.press("Control+A");
      await page.keyboard.press("Backspace");
      await linkResult.element.fill(row.link);
      console.log(`✅ Link added using: ${linkResult.selector}`);
    } else {
      console.log("⚠️ Link field skipped");
    }
    
    console.log("⏳ Link set. Waiting 10 seconds...");
    await page.waitForTimeout(10000);
    
    // 4. Board Selection Dropdown
    console.log("Selecting board...");
    const boardDropdownSelectors = [
      'div[role="button"]:has-text("Choose a board")',
      'button:has-text("Choose a board")',
      '[data-test-id*="board-picker"]',
      '[data-test-id="board-dropdown-select"]',
      'div[role="combobox"]',
      'button[aria-haspopup="listbox"]',
      'div[role="button"] .fAL',
      'div:has-text("Choose a board")[role="button"]'
    ];
    
    const dropdownResult = await trySelectors(page, boardDropdownSelectors, 6000);
    if (!dropdownResult) {
      throw new Error("Publish validation failed: Board selector dropdown not found");
    }
    await dropdownResult.element.click();
    console.log(`✅ Board dropdown opened using: ${dropdownResult.selector}`);
    
    console.log("⏳ Dropdown opened. Waiting 10 seconds...");
    await page.waitForTimeout(10000);
    
    // Board Item Selection
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
    
    console.log("⏳ Board selected. Waiting 10 seconds...");
    await page.waitForTimeout(10000);
    
    // Screenshot: Before Publish
    await page.screenshot({ path: "before_publish.png", fullPage: true });
    
    // 5. Publish Process
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
    console.log(`👉 Publish clicked using: ${publishBtnResult.selector}.`);
    
    console.log("⏳ Waiting 10 seconds for backend processing...");
    await page.waitForTimeout(10000);
    
    // Screenshot: After Publish Success
    await page.screenshot({ path: "after_publish.png", fullPage: true });
    
    // Status Update
    console.log("Updating sheet status...");
    await fetch(DONE_WEBAPP + "?row=" + (row.index + 1));
    console.log("✅ Sheet status updated to DONE");
    console.log("✅ UPLOAD COMPLETE");
    
  } catch (e) {
    console.error("❌ ERROR EXECUTING WORKFLOW:", e.message);
    await page.screenshot({ path: "error.png", fullPage: true });
  } finally {
    await browser.close();
  }
})();
