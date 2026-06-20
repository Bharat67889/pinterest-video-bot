const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage();

  try {
    console.log("Opening Pinterest...");

    await page.goto("https://www.pinterest.com/login/", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(5000);

    console.log("Filling credentials...");

    await page.locator('input[placeholder="Enter your email"]').fill(
      process.env.PINTEREST_EMAIL
    );

    await page.locator('input[placeholder="Enter your password"]').fill(
      process.env.PINTEREST_PASSWORD
    );

    console.log("Clicking login...");

    await page.click('button[type="submit"]');

    await page.waitForTimeout(15000);

    await page.screenshot({
      path: "pinterest-login.png",
      fullPage: true
    });

    console.log("Done.");

  } catch (e) {

    console.error("ERROR:", e);

    await page.screenshot({
      path: "error.png",
      fullPage: true
    });

  }

  await browser.close();
})();
