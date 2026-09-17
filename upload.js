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

function timeSince(start) {
  return `${((Date.now() - start) / 1000).toFixed(2)}s`;
}

// Memory-safe Buffer Download with precise logs
async function downloadFileWithLogs(url, destPath) {
  const start = Date.now();
  console.log(`📡 [HTTP GET] Initiating request to: ${url}`);

  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 15000,
    maxRedirects: 5,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    },
    validateStatus: () => true
  });

  const duration = timeSince(start);
  console.log(
    `📥 [HTTP GET Response] Status: ${response.status} (${response.statusText}) | Duration: ${duration} | Bytes: ${response.data ? response.data.length : 0}`
  );

  if (response.status !== 200) {
    throw new Error(`Download HTTP Error: ${response.status} ${response.statusText}`);
  }

  fs.writeFileSync(destPath, Buffer.from(response.data));
  console.log(`💾 [Disk Write] Saved locally to ${destPath} (${(response.data.length / (1024 * 1024)).toFixed(2)} MB)`);
}

async function fetchUserBoards(headers) {
  const t0 = Date.now();
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
    { headers, timeout: 10000, validateStatus: () => true }
  );

  console.log(`📋 [Boards Fetched] Duration: ${timeSince(t0)} | Status: ${res.status}`);

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
    { headers, timeout: 10000, validateStatus: () => true }
  );

  const boards2 = res2.data?.resource_response?.data;
  if (Array.isArray(boards2) && boards2.length > 0) {
    return boards2.map((b) => ({ id: b.id, name: b.name }));
  }

  throw new Error("No boards found for account.");
}

async function registerMediaUpload(headers) {
  const t0 = Date.now();
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
    { headers, timeout: 15000, validateStatus: () => true }
  );

  console.log(`📡 [Pinterest Register] Duration: ${timeSince(t0)} | Status: ${res.status}`);

  if (res.data?.resource_response?.error) {
    console.error("❌ Register Raw Error:", JSON.stringify(res.data.resource_response.error));
    throw new Error(JSON.stringify(res.data.resource_response.error));
  }

  const dataMap = res.data?.resource_response?.data;
  if (!dataMap || !dataMap[clientUUID]) {
    console.error("❌ Register Raw Body:", JSON.stringify(res.data));
    throw new Error("Failed to register media upload ID.");
  }

  return dataMap[clientUUID];
}

async function uploadVideoToS3(uploadData, filePath) {
  const t0 = Date.now();
  const form = new FormData();
  const params = uploadData.upload_parameters;

  for (const [key, value] of Object.entries(params)) {
    form.append(key, value);
  }

  const fileData = fs.readFileSync(filePath);
  form.append("file", fileData, {
    filename: "video.mp4",
    contentType: "video/mp4",
    knownLength: fileData.length
  });

  console.log(`☁️ [S3 Upload] Starting stream of ${fileData.length} bytes to ${uploadData.upload_url}`);

  const s3Res = await axios.post(uploadData.upload_url, form, {
    headers: { ...form.getHeaders() },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 60000,
    validateStatus: () => true
  });

  console.log(`☁️ [S3 Upload Finished] Duration: ${timeSince(t0)} | Status: ${s3Res.status} ${s3Res.statusText}`);

  if (s3Res.status >= 400) {
    console.error("❌ S3 Raw Error Body:", s3Res.data);
    throw new Error(`S3 Upload failed with status ${s3Res.status}`);
  }
}

async function getWorkingCoverUrl(videoUrl) {
  const t0 = Date.now();
  let candidate = videoUrl.replace(/\.mp4(\?.*)?$/i, ".jpg");

  console.log(`🖼️ [Cover Check] Validating: ${candidate}`);
  try {
    const res = await axios.head(candidate, { timeout: 5000, validateStatus: () => true });
    console.log(`🖼️ [Cover Status] Code: ${res.status} | Duration: ${timeSince(t0)}`);
    if (res.status === 200) return candidate;
  } catch (e) {
    console.log(`⚠️ [Cover Head Request Failed]: ${e.message}`);
  }

  console.log("ℹ️ Using reliable default fallback cover image.");
  return "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=720&q=80";
}

async function createPinWithCover(row, uploadId, boardId, coverUrl, headers) {
  const t0 = Date.now();
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

  console.log(`🚀 [Pin POST] Sending PinResource request to Board ID: ${boardId}...`);

  const res = await axios.post(
    `${BASE_HOST}/resource/PinResource/create/`,
    payload.toString(),
    { headers, timeout: 25000, validateStatus: () => true }
  );

  console.log(`🚀 [Pin POST Result] Duration: ${timeSince(t0)} | Status: ${res.status}`);
  console.log("📦 [Pin Raw Body]:", JSON.stringify(res.data));

  return res.data;
}

(async () => {
  const totalScriptStart = Date.now();
  try {
    console.log("🔑 Reading credentials from state.json...");
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

    console.log("🔍 Fetching user boards...");
    const availableBoards = await fetchUserBoards(headers);
    console.log(`📋 Found ${availableBoards.length} boards.`);

    console.log("📊 Fetching Google Sheet CSV...");
    const sheetT0 = Date.now();
    const sheetRaw = await (await fetch(SHEET_CSV_URL)).text();
    console.log(`📊 Google Sheet CSV fetched in ${timeSince(sheetT0)} (${sheetRaw.length} characters)`);

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
        console.log(`\n--------------------------------------------`);
        console.log(`🎯 Evaluating Row ${i + 1} | Status: ${status}`);
        console.log(`🔗 URL: ${url}`);
        
        try {
          if (fs.existsSync("video.mp4")) fs.unlinkSync("video.mp4");
          
          await downloadFileWithLogs(url, "video.mp4");

          const stat = fs.statSync("video.mp4");
          if (stat.size > 10000) {
            console.log(`✅ [Valid Task Selected] Row ${i + 1} (${(stat.size / (1024 * 1024)).toFixed(2)} MB)`);
            chosenRow = { url, caption, link, index: i };
            break;
          } else {
            console.log(`⚠️ Row ${i + 1} file size too small: ${stat.size} bytes.`);
          }
        } catch (e) {
          console.log(`⏩ Skipping Row ${i + 1}: ${e.message}`);
        }
      }
    }

    if (!chosenRow) {
      console.log("\nℹ️ No pending tasks found with valid videos. Total execution time: " + timeSince(totalScriptStart));
      process.exit(0);
    }

    console.log(`\n============================================`);
    console.log(`🚀 Executing Publishing Workflow for Row ${chosenRow.index + 1}`);
    console.log(`Caption: "${chosenRow.caption}"`);
    console.log(`Target Link: ${chosenRow.link}`);
    console.log(`============================================\n`);

    console.log("Step 1: Registering media with Pinterest...");
    const uploadData = await registerMediaUpload(headers);
    console.log(`✅ Upload Registered! Upload ID: ${uploadData.upload_id}`);

    console.log("\nStep 2: Uploading video to AWS S3...");
    await uploadVideoToS3(uploadData, "video.mp4");

    console.log("\n⏳ Waiting 5 minutes (300s) buffer for transcode readiness...");
    const waitStart = Date.now();
    await new Promise((r) => setTimeout(r, 300000));
    console.log(`⏱️ Wait buffer finished in ${timeSince(waitStart)}`);

    const coverUrl = await getWorkingCoverUrl(chosenRow.url);
    console.log(`🖼️ Final Cover URL: ${coverUrl}`);

    console.log("\nStep 3: Publishing Pin across available boards...");
    let published = false;

    const trendyIdx = availableBoards.findIndex((b) =>
      b.name.toLowerCase().includes("trendy")
    );
    if (trendyIdx > -1) {
      const [trendy] = availableBoards.splice(trendyIdx, 1);
      availableBoards.unshift(trendy);
    }

    for (const board of availableBoards) {
      console.log(`\n➡️ Attempting Board: "${board.name}" (ID: ${board.id})...`);

      const pinRes = await createPinWithCover(
        chosenRow,
        uploadData.upload_id,
        board.id,
        coverUrl,
        headers
      );

      if (pinRes?.resource_response?.data?.id) {
        console.log("\n🎉 SUCCESS! Pin Published!");
        console.log(`Board: ${board.name}`);
        console.log(`Pin ID: ${pinRes.resource_response.data.id}`);
        published = true;
        break;
      }
    }

    if (!published) {
      throw new Error("Pin publish nahi ho paya (All boards failed).");
    }

    console.log("\n📝 Updating Google Sheet status via WebApp...");
    const sheetUpdateT0 = Date.now();
    const updateRes = await fetch(DONE_WEBAPP + "?row=" + (chosenRow.index + 1));
    const updateText = await updateRes.text();
    console.log(`✅ Sheet updated in ${timeSince(sheetUpdateT0)} | Response: ${updateText}`);

    if (fs.existsSync("video.mp4")) fs.unlinkSync("video.mp4");
    console.log(`\n🏁 Total Workflow Duration: ${timeSince(totalScriptStart)}`);
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ [Fatal Error Caught]: ${err.message}`);
    if (fs.existsSync("video.mp4")) fs.unlinkSync("video.mp4");
    console.log(`Total Duration before failure: ${timeSince(totalScriptStart)}`);
    process.exit(1);
  }
})();
