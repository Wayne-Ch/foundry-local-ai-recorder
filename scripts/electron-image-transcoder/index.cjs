const { readFile } = require("node:fs/promises");
const { app, nativeImage } = require("electron");

app.disableHardwareAcceleration();

void run();

async function run() {
  let exitCode = 0;
  try {
    await app.whenReady();
    const [sourcePath, widthText, heightText] = process.argv.slice(2);
    const targetWidth = Number(widthText);
    const targetHeight = Number(heightText);
    if (
      sourcePath === undefined ||
      !Number.isSafeInteger(targetWidth) ||
      !Number.isSafeInteger(targetHeight) ||
      targetWidth <= 0 ||
      targetHeight <= 0
    ) {
      throw new Error("Invalid image transcoder arguments.");
    }

    const source = await readFile(sourcePath);
    try {
      const decoded = nativeImage.createFromBuffer(source);
      if (decoded.isEmpty()) {
        throw new Error("The image could not be decoded.");
      }
      const decodedSize = decoded.getSize();
      const output =
        decodedSize.width === targetWidth && decodedSize.height === targetHeight
          ? decoded
          : decoded.resize({ width: targetWidth, height: targetHeight, quality: "good" });
      const outputSize = output.getSize();
      const png = output.toPNG();
      try {
        process.stdout.write(
          `IMAGE_TRANSCODE_OK ${JSON.stringify({
            decodedWidth: decodedSize.width,
            decodedHeight: decodedSize.height,
            width: outputSize.width,
            height: outputSize.height,
            pngBase64: png.toString("base64"),
          })}\n`,
        );
      } finally {
        png.fill(0);
      }
    } finally {
      source.fill(0);
    }
  } catch (error) {
    exitCode = 1;
    console.error("IMAGE_TRANSCODE_FAILED", error);
  } finally {
    app.exit(exitCode);
  }
}
