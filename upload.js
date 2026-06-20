const { chromium } = require("playwright");

async function fillFirstAvailable(page, selectors, value) {
  for (const selector of selectors) {
    try {
      const field = page.locator(selector).first();
      await field.waitFor({ timeout: 4000 });
      await field.fill(value);
      console.log("Filled using:", selector);
      return true;
    } catch (e) {}
  }
  return false;
}

async function clickFirstAvailable(page, selectors) {
  for (const selector of selectors) {
    try {
      const btn = page.locator(selector).first();
      await btn.waitFor({ timeout: 4000 });
      await btn.click();
      console.log("Clicked using:", selector);
      return true;
    } catch (e) {}
  }
  return false;
}

(async () => {

  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage();

  try {

    console.log("Opening Pinterest...");

    await page.goto(
      "https://www.pinterest.com/login/",
      {
        waitUntil: "domcontentloaded",
        timeout: 60000
      }
    );

    await page.waitForTimeout(5000);

    console.log("Filling email...");

    const emailFound = await fillFirstAvailable(
      page,
      [
        'input[type="email"]',
        'input[placeholder*="email" i]',
        'input[placeholder*="mail" i]',
        'input[name="id"]',
        'input[autocomplete="username"]'
      ],
      process.env.PINTEREST_EMAIL
    );

    console.log("Filling password...");

    const passwordFound = await fillFirstAvailable(
      page,
      [
        'input[type="password"]',
        'input[placeholder*="password" i]',
        'input[name="password"]',
        'input[autocomplete="current-password"]'
      ],
      process.env.PINTEREST_PASSWORD
    );

    if (!emailFound || !passwordFound) {
      throw new Error("Could not find email/password fields.");
    }

    console.log("Clicking login button...");

    const clicked = await clickFirstAvailable(
      page,
      [
        'button[type="submit"]',
        'button:has-text("Log in")',
        'button:has-text("Login")',
        '[data-test-id="registerFormSubmitButton"]'
      ]
    );

    if (!clicked) {
      throw new Error("Login button not found.");
    }

    console.log("Waiting after login...");

    await page.waitForTimeout(15000);

    await page.screenshot({
      path: "pinterest-login.png",
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
