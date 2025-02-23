const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");
const AWS = require("aws-sdk");

const S3_BUCKET = process.env.S3_BUCKET;
const S3_REGION = process.env.S3_REGION;
const S3_METADATA_KEY = "metadata.json";
const IMAGE_DIR = "./images";
const OPTIMIZED_DIR = "./optimized";

const s3 = new AWS.S3({ region: S3_REGION });

/**
 * 이미지 파일의 해시값을 생성
 */
function getFileHash(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(fileBuffer).digest("hex");
}

/**
 * S3에서 메타데이터 가져오기
 */
async function fetchMetadataFromS3() {
  try {
    const data = await s3
      .getObject({ Bucket: S3_BUCKET, Key: S3_METADATA_KEY })
      .promise();
    return JSON.parse(data.Body.toString());
  } catch (err) {
    if (err.code === "NoSuchKey") {
      return { images: {} };
    }
    throw err;
  }
}

/**
 * 이미지 최적화 및 WebP 변환
 */
async function optimizeImage(filePath, outputPath) {
  await sharp(filePath).webp({ quality: 80 }).toFile(outputPath);
}

/**
 * S3에 업로드
 */
async function uploadToS3(filePath, key) {
  const fileContent = fs.readFileSync(filePath);
  await s3
    .upload({
      Bucket: S3_BUCKET,
      Key: key,
      Body: fileContent,
      ContentType: "image/webp",
    })
    .promise();
}

/**
 * 최적화된 이미지를 처리하고 업로드하는 메인 함수
 */
async function main() {
  const metadata = await fetchMetadataFromS3();
  fs.ensureDirSync(OPTIMIZED_DIR);

  const imageFiles = fs
    .readdirSync(IMAGE_DIR)
    .filter((file) => /\.(jpg|jpeg|png)$/i.test(file));
  const updatedMetadata = { images: { ...metadata.images } };

  for (const file of imageFiles) {
    const filePath = path.join(IMAGE_DIR, file);
    const outputFileName = file.replace(path.extname(file), ".webp");
    const outputPath = path.join(OPTIMIZED_DIR, outputFileName);
    const fileHash = getFileHash(filePath);
    const lastModified = fs.statSync(filePath).mtime.toISOString();

    const previousData = metadata.images[file] || {};
    if (previousData.hash === fileHash) {
      console.log(`✅ ${file} is already optimized, skipping...`);
      continue;
    }

    console.log(`⚡ Optimizing ${file}...`);
    await optimizeImage(filePath, outputPath);

    console.log(`🚀 Uploading ${outputFileName} to S3...`);
    await uploadToS3(outputPath, `optimized/${outputFileName}`);

    updatedMetadata.images[file] = {
      webp_version: `optimized/${outputFileName}`,
      last_modified: lastModified,
      size: fs.statSync(filePath).size,
      optimized_size: fs.statSync(outputPath).size,
      hash: fileHash,
    };
  }

  console.log("📡 Uploading updated metadata.json to S3...");
  fs.writeFileSync("./metadata.json", JSON.stringify(updatedMetadata, null, 2));
  await uploadToS3("./metadata.json", S3_METADATA_KEY);
  console.log("✅ Image optimization and upload complete!");
}

main().catch(console.error);
