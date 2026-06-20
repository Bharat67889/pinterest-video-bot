const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage();

  try {
    console.log("Opening Pinterest...");

    await page.goto("https://www.pinterest.com/login/", {
      waitUntil: "networkidle"
    });

    // Fill email and password
    await page.locator('input[placeholder="Email"]').fill(process.env.PINTEREST_EMAIL);
    await page.locator('input[placeholder="Password"]').fill(process.env.PINTEREST_PASSWORD);

    // Login button
    await page.click('button[type="submit"]');

    // Wait for login to complete
    await page.waitForTimeout(15000);

    // Success screenshot
    await page.screenshot({
      path: "pinterest-login.png",
      fullPage: true
    });

    console.log("Login test completed.");

  } catch (e) {
    console.error("ERROR:", e);

    // Error screenshot
    await page.screenshot({
      path: "error.png",
      fullPage: true
    });
  }

  await browser.close();
})();
