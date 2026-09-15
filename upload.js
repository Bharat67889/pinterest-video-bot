const fs = require("fs");
const https = require("https");
const crypto = require("crypto");
const axios = require("axios");
const FormData = require("form-data");

const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1MrwItyy6IPNLSJbz1b53TGOTS2JBLTyg46Ql9xZpI6w/gviz/tq?tqx=out:csv&sheet=PinterestQueue";

const DONE_WEBAPP =
  "https://script.google.com/macros/s/AKfycbzoGS8mMJDO_ghnUltSPIIQNhpFHn-y6zpamAATFjuMHTgTkV3ESnEtXQ7W_3D05JwJJw/exec";

// Official account Board ID
const DEFAULT_BOARD_ID = "1112952195354492699";
const BASE_HOST = "https://in.pinterest.com";

function getAuthFromState() {
  const stateRaw = fs.readFileSync("state.json", "utf-8");
  const state = JSON.parse(stateRaw);

  const csrfCookie = state.cookies.find((c) => c.name === "csrftoken");
  const csrfToken = csrfCookie ? csrfCookie.value : "";

  if (!csrfToken) {
    throw new Error("state.json me csrftoken nahi mila!");
  }

  const cookieStr = state.cookies
    .map((c) => `\({c.name}=\){c.value}`)
    .join("; ");

  return { cookieStr, csrfToken };
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
    {
      headers,
      validateStatus: () => true
    }
  );

  if (res.data?.resource_response?.error) {
    throw new Error(JSON.stringify(res.data.resource_response.error));
  }

  const dataMap = res.data?.resource_response?.data;
  if (!dataMap || !dataMap[clientUUID]) {
    throw new Error(
      "Failed to register media: " + JSON.stringify(res.data)
    );
  }

  return dataMap[clientUUID];
}

async function uploadVideoToS3(uploadData, filePath) {
  const form = new FormData();
  const params = uploadData.upload_parameters;

  for (const [key, value] of Object.entries(params)) {
    form.append(key, value);
  }

  form.append("file", fs.createReadStream(filePath));

  await axios.post(uploadData.upload_url, form, {
    headers: {
      ...form.getHeaders()
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity
  });
}

async function createStoryPin(row, uploadId, headers) {
  const storyPinStructure = {
    metadata: {
      pin_title: row.caption,
      canvas_aspect_ratio: 0.75
    },
    pages: [
      {
        blocks: [
          {
            block_style: {
              height: 100,
              width: 100,
              x_coord: 0,
              y_coord: 0
            },
            tracking_id: uploadId,
            type: 3
          }
        ],
        clips: [
          {
            clip_type: 1,
            end_time_ms: -1,
            is_converted_from_image: false,
            start_time_ms: -1
          }
        ],
        layout: 0,
        style: {
          background_color: "#FFFFFF"
        }
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
          board_id: DEFAULT_BOARD_ID,
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
    {
      headers,
      validateStatus: () => true
    }
  );

  if (res.data?.resource_response?.error) {
    throw new Error(JSON.stringify(res.data.resource_response.error));
  }

  return res.data;
}

(async () => {
  try {
    console.log("🔑 Reading fresh session credentials from state.json...");
    const { cookieStr, csrfToken } = getAuthFromState();

    const headers = {
      "accept": "application/json, text/javascript, */*, q=0.01",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-csrftoken": csrfToken,
      "x-requested-with": "XMLHttpRequest",
      "x-pinterest-appstate": "active",
      "cookie": cookieStr,
      "origin": "https://in.pinterest.com",
      "referer": "https://in.pinterest.com/pin-creation-tool/",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    };

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

    console.log(`🎯 Found Pending Task (Row \({row.index + 1}): "\){row.caption}"`);
    console.log("⬇️ Downloading MP4...");
    await downloadFile(row.url, "video.mp4");

    console.log("📡 Step 1: Registering media with Pinterest...");
    const uploadData = await registerMediaUpload(headers);
    console.log(`✅ Upload registered! Upload ID: ${uploadData.upload_id}`);

    console.log("☁️ Step 2: Uploading video directly to AWS S3...");
    await uploadVideoToS3(uploadData, "video.mp4");
    console.log("✅ File streamed to S3 successfully!");

    console.log("⏳ Waiting 10 seconds for backend processing...");
    await new Promise((resolve) => setTimeout(resolve, 10000));

    console.log("🚀 Step 3: Publishing Pin to Board...");
    const publishRes = await createStoryPin(row, uploadData.upload_id, headers);
    console.log(
      "🎉 Pin published successfully:",
      JSON.stringify(publishRes?.resource_response?.data || "DONE")
    );

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
