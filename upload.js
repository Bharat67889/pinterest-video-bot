```js
// LINK ADD
console.log("Adding Telegram link...");

try {

  const linkSelectors = [
    'input[placeholder*="link" i]',
    'input[placeholder*="destination" i]',
    'input[placeholder*="website" i]',
    'input[type="url"]'
  ];

  let linkAdded = false;

  for (const selector of linkSelectors) {

    try {

      const box = page.locator(selector).first();

      await box.waitFor({ timeout: 3000 });

      await box.fill(row.link);

      console.log("Link added using:", selector);

      linkAdded = true;

      break;

    } catch (e) {}

  }

  if (!linkAdded) {
    console.log("Link field skipped");
  }

} catch (e) {
  console.log("Link field skipped");
}


// BOARD
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


// PUBLISH
console.log("Publishing...");

await page.getByText("Publish").click();

await page.waitForTimeout(20000);


// MARK DONE IN SHEET
await fetch(
  "https://script.google.com/macros/s/AKfycbzoGS8mMJDO_ghnUltSPIIQNhpFHn-y6zpamAATFjuMHTgTkV3ESnEtXQ7W_3D05JwJJw/exec?row=" +
  (row.index + 1)
);

console.log("✅ Sheet status updated to DONE");


// SCREENSHOT
await page.screenshot({
  path: "success.png",
  fullPage: true
});

console.log("✅ UPLOAD COMPLETE");
```
