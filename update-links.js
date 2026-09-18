const fs = require("fs");
const axios = require("axios");

// 👇 Naya target link
const NEW_TARGET_LINK = "https://t.me/+F4xykxGxaDRhYTE1";

const BASE_HOST = "https://in.pinterest.com";

function getAuthFromState() {
  const stateRaw = fs.readFileSync("state.json", "utf-8");
  const state = JSON.parse(stateRaw);
  return {
    cookieStr: state.cookieStr,
    csrfToken: state.csrfToken
  };
}

async function getMyUsername(headers) {
  const payload = new URLSearchParams({
    source_url: "/",
    data: JSON.stringify({
      options: {},
      context: {}
    })
  });

  const res = await axios.post(
    `${BASE_HOST}/resource/UserSettingsResource/get/`,
    payload.toString(),
    { headers, validateStatus: () => true }
  );

  const username = res.data?.resource_response?.data?.username;
  if (!username) {
    throw new Error("Username fetch nahi ho paya, state.json check karo.");
  }
  return username;
}

// Saare pins fetch karega via Pinterest pagination
async function getAllUserPins(username, headers) {
  let allPins = [];
  let bookmark = null;
  let page = 1;

  console.log("🔍 Scanning all published pins from profile...");

  while (true) {
    const options = {
      username: username,
      page_size: 25
    };

    if (bookmark && bookmark !== "-end-") {
      options.bookmarks = [bookmark];
    }

    const payload = new URLSearchParams({
      source_url: `/${username}/pins/`,
      data: JSON.stringify({
        options: options,
        context: {}
      })
    });

    const res = await axios.post(
      `${BASE_HOST}/resource/UserPinsResource/get/`,
      payload.toString(),
      { headers, validateStatus: () => true }
    );

    const pins = res.data?.resource_response?.data || [];
    bookmark = res.data?.resource_response?.bookmark;

    if (Array.isArray(pins) && pins.length > 0) {
      for (const p of pins) {
        allPins.push({
          id: p.id,
          title: p.title || p.grid_title || "No Title",
          currentLink: p.link || "No Link"
        });
      }
      console.log(`📦 Page ${page}: ${pins.length} pins fetched (Total abhi tak: ${allPins.length})`);
    }

    // Agar bookmark nahi bacha ya "-end-" aa gaya, matlab saare pins complete
    if (!bookmark || bookmark === "-end-" || pins.length === 0) {
      break;
    }

    page++;
    await new Promise((r) => setTimeout(r, 1000));
  }

  return allPins;
}

async function updatePinLink(pinId, newLink, headers) {
  const payload = new URLSearchParams({
    source_url: `/pin/${pinId}/edit/`,
    data: JSON.stringify({
      options: {
        id: String(pinId),
        link: newLink
      },
      context: {}
    })
  });

  const res = await axios.post(
    `${BASE_HOST}/resource/PinResource/update/`,
    payload.toString(),
    { headers, timeout: 15000, validateStatus: () => true }
  );

  if (res.data?.resource_response?.error) {
    throw new Error(JSON.stringify(res.data.resource_response.error));
  }

  return res.data?.resource_response?.data;
}

(async () => {
  try {
    console.log("🔑 Reading session credentials from state.json...");
    const { cookieStr, csrfToken } = getAuthFromState();

    const headers = {
      "accept": "application/json, text/javascript, */*, q=0.01",
      "accept-language": "en-US,en;q=0.9",
      "content-type": "application/x-www-form-urlencoded",
      "cookie": cookieStr,
      "origin": "https://in.pinterest.com",
      "referer": "https://in.pinterest.com/",
      "sec-ch-ua": '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
      "x-app-version": "a73904a",
      "x-csrftoken": csrfToken,
      "x-pinterest-appstate": "active",
      "x-requested-with": "XMLHttpRequest"
    };

    console.log("👤 Fetching current Pinterest account username...");
    const username = await getMyUsername(headers);
    console.log(`✅ Logged in as: @${username}`);

    const pins = await getAllUserPins(username, headers);
    console.log(`\n📋 Found TOTAL ${pins.length} pins on account.`);
    console.log(`🎯 Setting new link to: ${NEW_TARGET_LINK}\n`);

    let successCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < pins.length; i++) {
      const pin = pins[i];

      // Agar link pehle se updated hai toh call skip karke time bachao
      if (pin.currentLink === NEW_TARGET_LINK) {
        console.log(`[${i + 1}/${pins.length}] Pin ID: ${pin.id} — Already up to date. Skipping.`);
        skippedCount++;
        continue;
      }

      console.log(`[${i + 1}/${pins.length}] Updating Pin ID: ${pin.id}`);
      console.log(`   Title: "${pin.title.substring(0, 35)}..."`);
      console.log(`   Old Link: ${pin.currentLink}`);

      try {
        await updatePinLink(pin.id, NEW_TARGET_LINK, headers);
        console.log(`   ✅ Link Updated -> ${NEW_TARGET_LINK}`);
        successCount++;
      } catch (err) {
        console.log(`   ⚠️ Failed to update: ${err.message}`);
      }

      // Pinterest rate limit se bachne ke liye safe delay
      if (i < pins.length - 1) {
        await new Promise((r) => setTimeout(r, 2500));
      }
      console.log("--------------------------------------------------");
    }

    console.log(`\n🎉 Task Complete!`);
    console.log(`✅ Successfully Updated: ${successCount}`);
    console.log(`⏭️ Already Matching / Skipped: ${skippedCount}`);
    console.log(`📊 Total Processed: ${pins.length}`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Process Failed:", err.message);
    process.exit(1);
  }
})();
