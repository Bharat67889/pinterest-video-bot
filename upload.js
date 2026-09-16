const fs = require("fs");
const crypto = require("crypto");
const axios = require("axios");
const FormData = require("form-data");

const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1MrwItyy6IPNLSJbz1b53TGOTS2JBLTyg46Ql9xZpI6w/gviz/tq?tqx=out:csv&sheet=PinterestQueue";

const DONE_WEBAPP =
  "https://script.google.com/macros/s/AKfycbzoGS8mMJDO_ghnUltSPIIQNhpFHn-y6zpamAATFjuMHTgTkV3ESnEtXQ7W_3D05JwJJw/exec";

const BASE_HOST = "https://in.pinterest.com";

function getAuthFromState() {
  const stateRaw = fs.readFileSync("state.json", "utf-8");
  const state = JSON.parse(stateRaw);

  return {
    cookieStr: state.cookieStr,
    csrfToken: state.csrfToken
  };
}

async function downloadFile(url, destPath) {
  const writer = fs.createWriteStream(destPath);
  const response = await axios({
    url,
    method: "GET",
    responseType: "stream",
    maxRedirects: 10,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

async function fetchUserBoards(headers) {
  const payload = new URLSearchParams({
    source_url: "/pin-creation-tool/",
    data: JSON.stringify({
      options: { filter: "all", sort: "alphabetical" },
      context: {}
    })
  });

  const res = await axios.post(
    `${BASE_HOST}/resource/BoardPickerBoardsResource/get/`,
    payload.toString(),
    { headers, validateStatus: () => true }
  );

  const boards = res.data?.resource_response?.data?.all_boards;
  if (Array.isArray(boards) && boards.length > 0) {
    return boards.map((b) => ({ id: b.id, name: b.name }));
  }

  const fallbackPayload = new URLSearchParams({
    source_url: "/pin-creation-tool/",
    data: JSON.stringify({ options: {}, context: {} })
  });

  const res2 = await axios.post(
    `${BASE_HOST}/resource/BoardsResource/get/`,
    fallbackPayload.toString(),
    { headers, validateStatus: () => true }
  );

  const boards2 = res2.data?.resource_response?.data;
  if (Array.isArray(boards2) && boards2.length > 0) {
    return boards2.map((b) => ({ id: b.id, name: b.name }));
  }

  throw new Error("No boards found for account.");
}

async function registerMediaUpload(headers) {
  const clientUUID = crypto.randomUUID();
  const payload = new URLSearchParams({
    source_url: "/pin-creation-tool/",
    data: JSON.stringify({
      options: {
        url: "/v3/media/uploads/register/batch/",
        data: {
          media_info_list: JSON.stringify([
            { id: clientUUID, media_type: "video-story-pin" }
          ])
        }
      },
      context: {}
    })
  });

  const res = await axios.post(
    `${BASE_HOST}/resource/ApiResource/create/`,
    payload.toString(),
    { headers, validateStatus: () => true }
  );

  if (res.data?.resource_response?.error) {
    throw new Error(JSON.stringify(res.data.resource_response.error));
  }

  const dataMap = res.data?.resource_response?.data;
  if (!dataMap || !dataMap[clientUUID]) {
    throw new Error("Failed to register media: " + JSON.stringify(res.data));
  }

  return dataMap[clientUUID];
}

async function uploadVideoToS3(uploadData, filePath) {
  const form = new FormData();
  const params = uploadData.upload_parameters;

  for (const [key, value] of Object.entries(params)) {
    form.append(key, value);
  }

  const stat = fs.statSync(filePath);
  form.append("file", fs.createReadStream(filePath), {
    filename: "video.mp4",
    contentType: "video/mp4",
    knownLength: stat.size
  });

  const s3Res = await axios.post(uploadData.upload_url, form, {
    headers: { ...form.getHeaders() },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: () => true
  });

  if (s3Res.status >= 400) {
    throw new Error(`S3 Upload failed with status ${s3Res.status}`);
  }
}

// Direct video pin create with Cloudinary thumbnail cover
async function createPinWithCover(row, uploadId, boardId, headers) {
  // Cloudinary URL se auto .jpg cover derive
  const coverUrl = row.url.replace(/\.mp4(\?.*)?$/i, ".jpg");

  const payload = new URLSearchParams({
    source_url: "/pin-creation-tool/",
    data: JSON.stringify({
      options: {
        board_id: String(boardId),
        description: row.caption,
        link: row.link,
        title: row.caption.slice(0, 100).trim(),
        image_url: coverUrl,
        media_upload_id: String(uploadId),
        origin: "PIN_CREATION_TOOL"
      },
      context: {}
    })
  });

  const res = await axios.post(
    `${BASE_HOST}/resource/PinResource/create/`,
    payload.toString(),
    { headers, validateStatus: () => true }
  );

  return res.data;
}

(async () => {
  try {
    console.log("🔑 Reading credentials...");
    const { cookieStr, csrfToken } = getAuthFromState();

    const headers = {
      "accept": "application/json, text/javascript, */*, q=0.01",
      "accept-language": "en-US,en;q=0.9",
      "content-type": "application/x-www-form-urlencoded",
      "cookie": cookieStr,
      "origin": "https://in.pinterest.com",
      "referer": "https://in.pinterest.com/pin-creation-tool/",
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
      "x-pinterest-source-url": "/pin-creation-tool/",
      "x-requested-with": "XMLHttpRequest"
    };

    console.log("🔍 Fetching boards directly from Pinterest...");
    const availableBoards = await fetchUserBoards(headers);
    console.log(`📋 Found ${availableBoards.length} boards.`);

    console.log("📊 Fetching Google Sheet Data...");
    const sheetRaw = await (await fetch(SHEET_CSV_URL)).text();

    const lines = sheetRaw.trim().split("\n");
    let chosenRow = null;

    for (let i = 1; i < lines.length; i++) {
      const match = lines[i].match(/(".*?"|[^",\r\n]+)(?=\s*,|\s*$)/g);
      if (!match) continue;
      const clean = match.map((v) => v.replace(/^"|"$/g, "").trim());

      const url = clean[0] || "";
      const caption = clean[1] || "";
      const link = clean[2] || "";
      const status = (clean[3] || "").toUpperCase();

      if (url.startsWith("http") && status === "PENDING") {
        try {
          if (fs.existsSync("video.mp4")) fs.unlinkSync("video.mp4");
          console.log(`⬇️ Downloading task from Row ${i + 1}...`);
          await downloadFile(url, "video.mp4");

          const stat = fs.statSync("video.mp4");
          if (stat.size > 10000) {
            console.log(`📦 Video ready: ${(stat.size / (1024 * 1024)).toFixed(2)} MB`);
            chosenRow = { url, caption, link, index: i };
            break;
          }
        } catch (e) {
          console.log(`⚠️ Row \({i + 1} skip:\){e.message}`);
        }
      }
    }

    if (!chosenRow) {
      console.log("ℹ️ No pending tasks with downloadable videos found.");
      return;
    }

    console.log(`🎯 Active Task (Row \({chosenRow.index + 1}): "\){chosenRow.caption}"`);

    console.log("📡 Step 1: Registering media with Pinterest...");
    const uploadData = await registerMediaUpload(headers);
    console.log(`✅ Upload registered! Upload ID: ${uploadData.upload_id}`);

    console.log("☁️ Step 2: Uploading video directly to AWS S3...");
    await uploadVideoToS3(uploadData, "video.mp4");
    console.log("✅ File streamed to S3 successfully!");

    console.log("⏳ Waiting 8 seconds for S3 sync...");
    await new Promise((r) => setTimeout(r, 8000));

    console.log("🚀 Step 3: Publishing Pin with auto-generated cover...");
    let published = false;

    const trendyIdx = availableBoards.findIndex((b) =>
      b.name.toLowerCase().includes("trendy")
    );
    if (trendyIdx > -1) {
      const [trendy] = availableBoards.splice(trendyIdx, 1);
      availableBoards.unshift(trendy);
    }

    for (const board of availableBoards) {
      console.log(`➡️ Trying Board: "\({board.name}" (ID:\){board.id})...`);

      const pinRes = await createPinWithCover(
        chosenRow,
        uploadData.upload_id,
        board.id,
        headers
      );

      if (pinRes?.resource_response?.data?.id) {
        console.log("🎉 SUCCESS! Video Pin published to:", board.name);
        console.log("Pin ID:", pinRes.resource_response.data.id);
        published = true;
        break;
      }

      console.log(
        "⚠️ Pin Response:",
        JSON.stringify(pinRes?.resource_response?.error || pinRes)
      );
    }

    if (!published) {
      throw new Error("Pin publish nahi ho paya.");
    }

    console.log("📝 Updating sheet status...");
    await fetch(DONE_WEBAPP + "?row=" + (chosenRow.index + 1));
    console.log("✅ Task Marked as DONE!");

    if (fs.existsSync("video.mp4")) fs.unlinkSync("video.mp4");
  } catch (err) {
    console.error("❌ Process Failed:", err.message);
    if (fs.existsSync("video.mp4")) fs.unlinkSync("video.mp4");
    process.exit(1);
  }
})();
