import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Login to Zenn via Google
  console.log("Opening Zenn settings...");
  await page.goto("https://zenn.dev/settings/profile");

  // Wait for user to login if needed
  console.log("Please login if prompted. Waiting for settings page...");
  await page.waitForURL("**/settings/profile", { timeout: 120000 });

  // Clear bio field
  console.log("Clearing bio...");
  const bioSelector = 'textarea[name="bio"]';
  await page.waitForSelector(bioSelector, { timeout: 10000 });
  await page.fill(bioSelector, "AI・機械学習・LLMの技術情報を発信しています。");

  // Clear website URL if it contains freelance/ses
  const websiteSelector = 'input[name="websiteUrl"]';
  try {
    const websiteVal = await page.inputValue(websiteSelector);
    if (websiteVal.includes("freelance") || websiteVal.includes("ses") || websiteVal.includes("radineer")) {
      console.log(`Clearing website URL: ${websiteVal}`);
      await page.fill(websiteSelector, "");
    }
  } catch {
    console.log("No website URL field found");
  }

  // Click save button
  console.log("Saving profile...");
  await page.click('button:has-text("保存")');
  await page.waitForTimeout(3000);

  console.log("Done! Check https://zenn.dev/ailmarketing");
  await browser.close();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
