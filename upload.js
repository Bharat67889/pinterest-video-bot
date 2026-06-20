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

    await page.fill('input[type="email"]', process.env.PINTEREST_EMAIL);
    await page.fill('input[type="password"]', process.env.PINTEREST_PASSWORD);

    await page.click('button[type="submit"]');

    await page.waitForTimeout(10000);

    await page.screenshot({
      path: "pinterest-login.png",
      fullPage: true
    });

    console.log("Login test completed.");
  } catch (e) {
    console.log(e);
  }

  await browser.close();
})();
