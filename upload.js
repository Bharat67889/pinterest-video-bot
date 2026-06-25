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

        row = {
          url,
          caption,
          link,
          index: i
        };

        break;
      }
    }

    if (!row)
      throw new Error("No PENDING row found in PinterestQueue sheet");

    console.log("⬇ Downloading MP4...");

    await downloadFile(row.url, "video.mp4");

    console.log("Opening Pinterest...");

    await page.goto(
      "https://www.pinterest.com/pin-creation-tool/",
      {
        waitUntil: "domcontentloaded",
        timeout: 60000
      }
    );

    await page.waitForTimeout(8000);

    console.log("Uploading video...");

    await page.setInputFiles(
      'input[type="file"]',
      "video.mp4"
    );

    await page.waitForTimeout(25000);

console.log("Setting title...");

const titleSelectors = [
  'input[placeholder*="title" i]',
  'textarea[placeholder*="title" i]',
  '[aria-label*="title" i]',
  '[data-test-id*="title"]',
  '[contenteditable="true"]',
  'input[type="text"]'
];

let titleFilled = false;

for (const selector of titleSelectors) {
  try {
    const box = page.locator(selector).first();

    await box.waitFor({
      state: "visible",
      timeout: 5000
    });

    await box.click();

    try {
      await box.fill(row.caption);
    } catch {
      await box.press("Control+A");
      await box.type(row.caption);
    }

    console.log("✅ Title added using:", selector);

    titleFilled = true;
    break;

  } catch (e) {
    console.log("❌ Failed selector:", selector);
  }
}

if (!titleFilled) {

  await page.screenshot({
    path: "title_debug.png",
    fullPage: true
  });

  throw new Error("Could not find Pinterest title field");
}

    console.log("Adding Telegram link...");

    try {

      const selectors = [
        'input[placeholder*="link" i]',
        'input[placeholder*="destination" i]',
        'input[placeholder*="website" i]',
        'input[type="url"]'
      ];

      let success = false;

      for (const selector of selectors) {

        try {

          const box = page.locator(selector).first();

          await box.waitFor({ timeout: 3000 });

          await box.fill(row.link);

          console.log("Link added using:", selector);

          success = true;

          break;

        } catch (e) {}

      }

      if (!success) {
        console.log("Link field skipped");
      }

    } catch (e) {
      console.log("Link field skipped");
    }

    console.log("Selecting board...");

    try {

      await page.locator('div[role="button"]')
        .filter({ hasText: "Choose a board" })
        .click();

      await page.waitForTimeout(3000);

      await page.locator("text=Trendy283").click();

    } catch (e) {

      console.log("Board selection skipped");

    }

    console.log("Publishing...");

  const publishSelectors = [
  'button:has-text("Publish")',
  '[data-test-id*="publish"]',
  'button[type="submit"]'
];

let published = false;

for (const selector of publishSelectors) {
  try {

    const btn = page.locator(selector).first();

    await btn.waitFor({
      state: "visible",
      timeout: 5000
    });

    await btn.click();

    console.log("✅ Published using:", selector);

    published = true;
    break;

  } catch (e) {}
}

if (!published) {
  throw new Error("Publish button not found");
}

    await page.waitForTimeout(20000);

    console.log("Updating sheet status...");

    await fetch(
      DONE_WEBAPP + "?row=" + (row.index + 1)
    );

    console.log("✅ Sheet status updated");

    await page.screenshot({
      path: "success.png",
      fullPage: true
    });

    console.log("✅ UPLOAD COMPLETE");

  }
  catch (e) {

    console.error("❌ ERROR:", e);

    await page.screenshot({
      path: "error.png",
      fullPage: true
    });

  }

  await browser.close();

})();
