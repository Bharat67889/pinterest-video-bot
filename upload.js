const { chromium } = require("playwright");

(async () => {

  const browser = await chromium.launch({
    headless: true
  });

  // saved session use karo
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

    await page.waitForTimeout(5000);

    console.log("Uploading video...");

    await page.setInputFiles(
      'input[type="file"]',
      "test.mp4"
    );

    await page.waitForTimeout(15000);

    console.log("Adding title...");

    await page.locator('input[placeholder*="title" i]').first()
      .fill("Test Upload");

    console.log("Adding description...");

    try {
      await page.locator('textarea').first()
        .fill("Uploaded automatically.");
    } catch (e) {}

    console.log("Selecting board...");

    try {

      await page.locator('div[role="button"]').filter({
        hasText: "Choose a board"
      }).first().click();

      await page.waitForTimeout(3000);

      await page.locator('text=Trendy283').first().click();

    } catch (e) {
      console.log("Board selection skipped");
    }

    await page.waitForTimeout(5000);

    console.log("Publishing...");

    await page.getByText("Publish").click();

    await page.waitForTimeout(20000);

    await page.screenshot({
      path: "success.png",
      fullPage: true
    });

    console.log("UPLOAD COMPLETE");

  } catch (e) {

    console.error(e);

    await page.screenshot({
      path: "error.png",
      fullPage: true
    });

  }

  await browser.close();

})();
