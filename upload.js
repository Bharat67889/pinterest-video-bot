const { chromium } = require("playwright");

(async () => {

  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    storageState: "state.json"
  });

  const page = await context.newPage();

  try {

    console.log("Opening Create Pin page...");

    await page.goto(
      "https://www.pinterest.com/pin-creation-tool/",
      {
        waitUntil: "domcontentloaded",
        timeout: 60000
      }
    );

    await page.waitForTimeout(8000);

    console.log("Uploading video...");

    await page.locator('input[type="file"]').setInputFiles("test.mp4");

    console.log("Waiting upload...");

    await page.waitForTimeout(20000);

    console.log("Filling title...");

    await page.locator('input[id="storyboard-selector-title"]').fill(
      "Test Upload"
    ).catch(()=>{});

    await page.locator('input[placeholder*="title" i]').fill(
      "Test Upload"
    ).catch(()=>{});

    console.log("Filling description...");

    await page.locator('textarea').first().fill(
      "Testing Pinterest automation."
    ).catch(()=>{});

    console.log("Taking screenshot...");

    await page.screenshot({
      path: "upload-test.png",
      fullPage: true
    });

    console.log("SUCCESS");

  } catch (e) {

    console.error(e);

    await page.screenshot({
      path: "error.png",
      fullPage: true
    });

  }

  await browser.close();

})();
