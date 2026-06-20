const { chromium } = require("playwright");
const https = require("https");
const fs = require("fs");

const SHEET_URL = "https://docs.google.com/spreadsheets/d/1MrwItyy6IPNLSJbz1b53TGOTS2JBLTyg46Ql9xZpI6w/edit?usp=sharing";

async function downloadFile(url, path) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(path);
    https.get(url, (response) => {
      response.pipe(file);
      file.on("finish", () => {
        file.close(resolve);
      });
    }).on("error", reject);
  });
}

(async () => {

  const browser = await chromium.launch({ headless: true });

  const context = await browser.newContext({
    storageState: "state.json"
  });

  const page = await context.newPage();

  try {

    console.log("📊 Opening Google Sheet...");

    const sheetPage = await context.newPage();
    await sheetPage.goto(SHEET_URL);

    await sheetPage.waitForTimeout(5000);

    // NOTE: simplest approach -> assume sheet already visible
    const data = await sheetPage.evaluate(() => {

      let rows = Array.from(document.querySelectorAll("tr"));
      let result = [];

      for (let r of rows) {
        let cols = r.querySelectorAll("td");
        if (cols.length >= 3) {
          result.push({
            url: cols[0]?.innerText,
            caption: cols[1]?.innerText,
            link: cols[2]?.innerText
          });
        }
      }

      return result;
    });

    let row = data.find(r => r.url && r.url.includes("http"));

    if (!row) throw new Error("No valid row found in sheet");

    console.log("⬇ Downloading MP4...");

    const videoPath = "video.mp4";
    await downloadFile(row.url, videoPath);

    console.log("Opening Pinterest...");

    await page.goto("https://www.pinterest.com/pin-creation-tool/", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(7000);

    console.log("Uploading video...");

    await page.setInputFiles('input[type="file"]', videoPath);

    await page.waitForTimeout(15000);

    console.log("Filling title (caption)...");

    await page.locator('input[placeholder*="title" i]').first()
      .fill(row.caption || "Untitled");

    console.log("Adding link...");

    try {
      await page.locator('input').fill(row.link || "");
    } catch {}

    console.log("Selecting board...");

    try {
      await page.locator('div[role="button"]').filter({
        hasText: "Choose a board"
      }).first().click();

      await page.waitForTimeout(2000);

      await page.locator('text=Trendy283').first().click();

    } catch {}

    await page.waitForTimeout(3000);

    console.log("Publishing...");

    await page.getByText("Publish").click();

    await page.waitForTimeout(20000);

    await page.screenshot({
      path: "final-success.png",
      fullPage: true
    });

    console.log("✅ UPLOAD COMPLETE");

  } catch (e) {

    console.error("❌ ERROR:", e);

    await page.screenshot({
      path: "error.png",
      fullPage: true
    });

  }

  await browser.close();

})();
