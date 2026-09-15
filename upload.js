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

// Quick check: Agar 10-12 second me status aaye toh thik, warna proceed
async function checkMediaStatus(uploadId, headers) {
  for (let i = 1; i <= 4; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const payload = new URLSearchParams({
        source_url: "/pin-creation-tool/",
        data: JSON.stringify({
          options: { upload_id: String(uploadId) },
          context: {}
        })
      });
      const res = await axios.post(
        `${BASE_HOST}/resource/MediaUploadStatusResource/get/`,
        payload.toString(),
        { headers, validateStatus: () => true }
      );
      const data = res.data?.resource_response?.data;
      if (data?.video_signature) return data.video_signature;
      if (data?.status === "succeeded" && data?.media_id) return data.media_id;
    } catch (e) {}
  }
  return null;
}

// Method 1: StoryPin POST
async function createStoryPin(row, uploadData, videoSig, boardId, headers) {
  const s3Key = uploadData.upload_parameters?.key || "";
  const sig = videoSig || s3Key.split("/").pop()?.replace(/\.[^/.]+$/, "") || String(uploadData.upload_id);

  const storyPinStructure = {
    metadata: {
      pin_title: row.caption,
      canvas_aspect_ratio: 0.75
    },
    pages: [
      {
        blocks: [
          {
            block_style: { height: 100, width: 100, x_coord: 0, y_coord: 0 },
            tracking_id: uploadData.upload_id,
            type: 3,
            video_signature: sig
          }
        ],
        clips: [
          {
            clip_type: 1,
            end_time_ms: -1,
            is_converted_from_image: false,
            source_media_width: 720,
            source_media_height: 1280,
            start_time_ms: -1
          }
        ],
        layout: 0,
        style: { background_color: "#FFFFFF" }
      }
    ]
  };

  const payload = new URLSearchParams({
    source_url: "/pin-creation-tool/",
    data: JSON.stringify({
      options: {
        url: "/v3/storypins/",
        data: {
          alt_text: "",
          allow_shopping_rec: true,
          board_id: String(boardId),
          description: row.caption,
          fields: ["pin.id"],
          is_comments_allowed: true,
          is_unified_builder: true,
          link: row.link,
          method: "uploaded",
          story_pin: JSON.stringify(storyPinStructure),
          user_mention_tags: "[]"
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

  return res.data;
}

// Method 2: Standard Direct Video Pin POST (Fail-safe)
async function createDirectVideoPin(row, uploadId, boardId, headers) {
  const payload = new URLSearchParams({
    source_url: "/pin-creation-tool/",
    data: JSON.stringify({
      options: {
        board_id: String(boardId),
        title: row.caption,
        description: row.caption,
        link: row.link,
        media_upload_id: String(uploadId),
        publish_as_story_pin: true
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

    console.log("🔍 Fetching boards...");
    const availableBoards = await fetchUserBoards(headers);

    console.log("📊 Reading Google Sheet...");
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
          console.log(`⚠️ Row ${i + 1} skip: ${e.message}`);
        }
      }
    }

    if (!chosenRow) {
      console.log("ℹ️ No pending tasks with downloadable videos.");
      return;
    }

    console.log(`🎯 Active Task: "${chosenRow.caption}"`);

    console.log("📡 Registering upload...");
    const uploadData = await registerMediaUpload(headers);
    console.log(`✅ Upload ID: ${uploadData.upload_id}`);

    console.log("☁️ Uploading to S3...");
    await uploadVideoToS3(uploadData, "video.mp4");
    console.log("✅ Uploaded to S3!");

    console.log("⏳ Waiting 12 seconds for transcode initialization...");
    const videoSig = await checkMediaStatus(uploadData.upload_id, headers);

    console.log("🚀 Publishing pin...");
    let published = false;

    // Prioritize trendy board
    const trendyIdx = availableBoards.findIndex((b) =>
      b.name.toLowerCase().includes("trendy")
    );
    if (trendyIdx > -1) {
      const [trendy] = availableBoards.splice(trendyIdx, 1);
      availableBoards.unshift(trendy);
    }

    for (const board of availableBoards) {
      console.log(`➡️ Attempting Board: "${board.name}"...`);

      // Try Method 1: StoryPin
      let res = await createStoryPin(
        chosenRow,
        uploadData,
        videoSig,
        board.id,
        headers
      );

      if (res?.resource_response?.data) {
        console.log("🎉 SUCCESS via StoryPin API on:", board.name);
        published = true;
        break;
      }

      console.log(`⚠️ StoryPin attempt error: ${res?.resource_response?.error?.message || "fallback to Direct Video Pin"}`);

      // Try Method 2: Direct Video Pin
      res = await createDirectVideoPin(
        chosenRow,
        uploadData.upload_id,
        board.id,
        headers
      );

      if (res?.resource_response?.data) {
        console.log("🎉 SUCCESS via Direct Pin API on:", board.name);
        published = true;
        break;
      }

      console.log(`⚠️ Direct Pin attempt error: ${res?.resource_response?.error?.message || "trying next board"}`);
    }

    if (!published) {
      throw new Error("Dono methods se pin publish nahi ho paya.");
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
