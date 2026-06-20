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

    await page.waitForTimeout(15000);

    await page.screenshot({
      path: "create-pin.png",
      fullPage: true
    });

    console.log("SUCCESS");

  } catch (e) {

    console.error("ERROR:", e);

    await page.screenshot({
      path: "error.png",
      fullPage: true
    });

  }

  await browser.close();

})();
