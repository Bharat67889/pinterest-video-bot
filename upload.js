const fs = require("fs");
const https = require("https");
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

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https
      .get(url, (res) => {
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
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

  // AWS S3 standard multipart key-order: sabse pehle parameters aate hain, fir file
  for (const [key, value] of Object.entries(params)) {
    form.append(key, value);
  }

  const fileBuffer = fs.readFileSync(filePath);
  form.append("file", fileBuffer, {
    filename: "video.mp4",
    contentType: "video/mp4"
  });

  const s3Res = await axios.post(uploadData.upload_url, form, {
    headers: { ...form.getHeaders() },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: () => true
  });

  if (s3Res.status >= 400) {
    throw new Error(`S3 Upload failed with status ${s3Res.status}: ${s3Res.data}`);
  }
}

async function waitForVideoSignature(uploadId, headers) {
  const maxAttempts = 15;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const payload = new URLSearchParams({
      source_url: "/pin-creation-tool/",
      data: JSON.stringify({
        options: {
          url: `/v3/media/uploads/${uploadId}/`
        },
        context: {}
      })
    });

    const res = await axios.post(
      `${BASE_HOST}/resource/ApiResource/create/`,
      payload.toString(),
      { headers, validateStatus: () => true }
    );

    const raw = res.data?.resource_response?.data;
    console.log(`⏳ Transcode Poll #${attempt} Raw Data:`, JSON.stringify(raw));

    if (raw) {
      const sig =
        raw.video_signature ||
        raw.media_signature ||
        raw.signature ||
        raw.video_id;
      const status = raw.status || raw.upload_status;

      if (sig) return sig;
      if (status === "succeeded" && raw.id) return raw.id;
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  console.log("⚠️ Transcode signature auto-detect nahi hua, direct container payload try karenge...");
  return null;
}

async function createStoryPin(row, uploadId, videoSignature, boardId, headers) {
  const clipObj = {
    clip_type: 1,
    end_time_ms: -1,
    is_converted_from_image: false,
    source_media_width: 720,
    source_media_height: 1280,
    start_time_ms: -1
  };

  const blockObj = {
    block_style: {
      height: 100,
      width: 100,
      x_coord: 0,
      y_coord: 0
    },
    tracking_id: uploadId,
    type: 3
  };

  if (videoSignature) {
    blockObj.video_signature = String(videoSignature);
  }

  const storyPinStructure = {
    metadata: {
      pin_title: row.caption,
      canvas_aspect_ratio: 0.75
    },
    pages: [
      {
        blocks: [blockObj],
        clips: [clipObj],
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
          fields: [
            "pin.id",
            "pin.image_signature",
            "pin.image_square_url",
            "pin.story_pin_data_id"
          ],
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

    console.log("🔍 Fetching account boards directly from Pinterest...");
    const availableBoards = await fetchUserBoards(headers);
    console.log(`📋 Found ${availableBoards.length} boards.`);

    console.log("📊 Fetching Google Sheet Data...");
    const sheetRaw = await (await fetch(SHEET_CSV_URL)).text();
    const rows = sheetRaw
      .trim()
      .split("\n")
      .map((line) =>
        line
          .match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g)
          ?.map((v) => v.replace(/^"|"$/g, "").trim())
      );

    let row = null;
    for (let i = 1; i < rows.length; i++) {
      const url = (rows[i]?.[0] || "").trim();
      const caption = (rows[i]?.[1] || "").trim();
      const link = (rows[i]?.[2] || "").trim();
      const status = (rows[i]?.[3] || "")
        .replace(/\r/g, "")
        .trim()
        .toUpperCase();

      if (url && status === "PENDING") {
        row = { url, caption, link, index: i };
        break;
      }
    }

    if (!row) {
      console.log("ℹ️ No PENDING row found. Exiting.");
      return;
    }

    console.log(`🎯 Found Pending Task (Row ${row.index + 1}): "${row.caption}"`);
    console.log("⬇️ Downloading MP4...");
    await downloadFile(row.url, "video.mp4");

    const stat = fs.statSync("video.mp4");
    console.log(`📦 Video file downloaded successfully: ${(stat.size / (1024 * 1024)).toFixed(2)} MB`);

    console.log("📡 Step 1: Registering media with Pinterest...");
    const uploadData = await registerMediaUpload(headers);
    console.log(`✅ Upload registered! Upload ID: ${uploadData.upload_id}`);

    console.log("☁️ Step 2: Uploading complete video Buffer to AWS S3...");
    await uploadVideoToS3(uploadData, "video.mp4");
    console.log("✅ File written to S3 successfully!");

    console.log("⏳ Step 2.5: Waiting for transcode completion & real video signature...");
    const videoSig = await waitForVideoSignature(uploadData.upload_id, headers);

    console.log("🚀 Step 3: Publishing Pin to Board...");
    let published = false;

    for (const board of availableBoards) {
      console.log(`➡️ Trying board "${board.name}" (ID: ${board.id})...`);
      const publishRes = await createStoryPin(
        row,
        uploadData.upload_id,
        videoSig,
        board.id,
        headers
      );

      if (publishRes?.resource_response?.error) {
        console.log(
          "⚠️ Board Error:",
          JSON.stringify(publishRes.resource_response.error)
        );
        continue;
      }

      if (publishRes?.resource_response?.data) {
        console.log("🎉 Pin published successfully to board:", board.name);
        console.log("Data:", JSON.stringify(publishRes.resource_response.data));
        published = true;
        break;
      } else {
        console.log("⚠️ Unexpected response:", JSON.stringify(publishRes));
      }
    }

    if (!published) {
      throw new Error("Pin kisi bhi board par publish nahi ho paya.");
    }

    console.log("📝 Updating sheet status...");
    await fetch(DONE_WEBAPP + "?row=" + (row.index + 1));
    console.log("✅ Sheet status updated to DONE!");

    if (fs.existsSync("video.mp4")) fs.unlinkSync("video.mp4");
  } catch (err) {
    console.error("❌ Process Failed:", err.message);
    if (fs.existsSync("video.mp4")) fs.unlinkSync("video.mp4");
    process.exit(1);
  }
})();
