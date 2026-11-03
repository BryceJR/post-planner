import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { kindOf, mediaList, normalizeImage, publicHttpUrl } from "./media";

describe("media", () => {
  it("knows pictures from videos", () => {
    expect(kindOf("image/png")).toBe("image");
    expect(kindOf("video/mp4; codecs=avc1")).toBe("video");
    expect(kindOf("application/pdf")).toBeNull();
  });
  it("only public web addresses", () => {
    expect(publicHttpUrl("https://images.example.com/a.png")?.host).toBe("images.example.com");
    for (const bad of ["ftp://example.com/a", "http://localhost:3000/a", "http://127.0.0.1/a", "http://10.0.0.5/a", "http://192.168.1.1/a", "http://169.254.169.254/latest", "http://[::1]/a", "https://u:p@example.com/a", "file:///etc/passwd", "nope"]) {
      expect(publicHttpUrl(bad), bad).toBeNull();
    }
  });
  it("makes a big PNG into a JPEG under 1 MB and 2048 px", async () => {
    const width = 3000;
    const height = 2000;
    const raw = Buffer.alloc(width * height * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
    const png = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
    const out = await normalizeImage(png);
    expect(out.bytes.byteLength).toBeLessThanOrEqual(1_000_000);
    expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(2048);
    expect((await sharp(out.bytes).metadata()).format).toBe("jpeg");
  }, 30_000);
  it("refuses what isn't a picture", async () => {
    await expect(normalizeImage(new TextEncoder().encode("not a picture"))).rejects.toThrow();
  });
  it("reads stored items, with their kind", () => {
    expect(mediaList([{ url: "https://a/b.mp4", mime: "video/mp4", duration: 5 }, { url: "https://a/c.jpg" }, { url: "data:x" }, null])).toEqual([
      { url: "https://a/b.mp4", path: null, kind: "video", mime: "video/mp4", size: null, width: null, height: null, duration: 5, alt: null },
      { url: "https://a/c.jpg", path: null, kind: "image", mime: "image/jpeg", size: null, width: null, height: null, duration: null, alt: null },
    ]);
  });
});
