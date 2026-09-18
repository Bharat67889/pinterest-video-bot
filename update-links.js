const fs = require("fs");
const axios = require("axios");

// 👇 Apna naya link yahan enter karo
const NEW_TARGET_LINK = "https://example.com/your-new-link";

// 👇 Testing ke liye limit 10 rakhi hai
const PINS_LIMIT = 10;

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

async function getLatestPins(username, count, headers) {
  const payload = new URLSearchParams({
    source_url: `/${username}/pins/`,
    data: JSON.stringify({
      options: {
        username: username,
        page_size: count
      },
      context: {}
    })
  });

  const res = await axios.post(
    `${BASE_HOST}/resource/UserPinsResource/get/`,
    payload.toString(),
    { headers, validateStatus: () => true }
  );

  const pins = res.data?.resource_response?.data;
  if (!Array.isArray(pins) || pins.length === 0) {
    throw new Error("Koi pins nahi mile.");
  }

  return pins.slice(0, count).map((p) => ({
    id: p.id,
    title: p.title || p.grid_title || "No Title",
    currentLink: p.link || "No Link"
  }));
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
    { headers, validateStatus: () => true }
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

    console.log("👤 Fetching current Pinterest user details...");
    const username = await getMyUsername(headers);
    console.log(`✅ Logged in as: @${username}`);

    console.log(`🔍 Fetching latest ${PINS_LIMIT} pins...`);
    const pins = await getLatestPins(username, PINS_LIMIT, headers);
    console.log(`📋 Found ${pins.length} pins to update.\n`);

    let successCount = 0;

    for (let i = 0; i < pins.length; i++) {
      const pin = pins[i];
      console.log(`[${i + 1}/${pins.length}] Updating Pin ID: ${pin.id}`);
      console.log(`   Title: "${pin.title.substring(0, 40)}..."`);
      console.log(`   Old Link: ${pin.currentLink}`);

      try {
        await updatePinLink(pin.id, NEW_TARGET_LINK, headers);
        console.log(`   ✅ New Link Set: ${NEW_TARGET_LINK}`);
        successCount++;
      } catch (err) {
        console.log(`   ⚠️ Failed to update: ${err.message}`);
      }

      // Safe delay between requests
      if (i < pins.length - 1) {
        console.log("   ⏳ Waiting 3 seconds...");
        await new Promise((r) => setTimeout(r, 3000));
      }
      console.log("--------------------------------------------------");
    }

    console.log(`\n🎉 Task Complete! ${successCount}/${pins.length} pins updated successfully.`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Process Failed:", err.message);
    process.exit(1);
  }
})();
