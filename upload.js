const { chromium } = require("playwright");
const https = require("https");
const fs = require("fs");

const SHEET_CSV_URL =
"https://docs.google.com/spreadsheets/d/1MrwItyy6IPNLSJbz1b53TGOTS2JBLTyg46Ql9xZpI6w/gviz/tq?tqx=out:csv&sheet=PinterestQueue";

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

  const browser = await chromium.launch({ headless: true });

  const context = await browser.newContext({
    storageState: "state.json"
  });

  const page = await context.newPage();

  try {

    console.log("📊 Fetching Sheet Data...");

    const sheetRaw = await (await fetch(SHEET_CSV_URL)).text();

    console.log(sheetRaw);

    const rows = sheetRaw
      .trim()
      .split("\n")
      .map(line =>
        line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g)
          ?.map(v => v.replace(/^"|"$/g, "").trim())
      );

    console.log(rows);

    let row = null;

    for (let i = 1; i < rows.length; i++) {

      const url = (rows[i]?.[0] || "").trim();
      const caption = (rows[i]?.[1] || "").trim();
      const link = (rows[i]?.[2] || "").trim();
      const status = (rows[i]?.[3] || "")
        .replace(/\r/g, "")
        .trim()
        .toUpperCase();

      console.log("STATUS =", status);

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

    const videoPath = "video.mp4";
    await downloadFile(row.url, videoPath);

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

    await page.setInputFiles('input[type="file"]', videoPath);

    await page.waitForTimeout(15000);

    console.log("Setting title...");

    await page.locator('input[placeholder*="title" i]')
      .first()
      .fill(row.caption);

    console.log("Adding Telegram link...");

    try {
      const inputs = page.locator("input");
      await inputs.last().fill(row.link);
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

    await page.getByText("Publish").click();

    await page.waitForTimeout(20000);

    await page.screenshot({
      path: "success.png",
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
