import assert from "node:assert/strict";
import test from "node:test";
import { completeDraftImageLibrary } from "./draft-image-library.js";
import type { SourceImage } from "./types.js";

test("all frozen source figures reach the draft library while only the planned figures enter the body", async () => {
  const images: SourceImage[] = Array.from({ length: 7 }, (_, index) => ({
    id: `image-${index}`, url: `https://cdn.example/figure-${index}.png`, sourceUrl: "https://example.com/model",
    caption: `Model evaluation chart ${index + 1}`, attribution: "Example", selected: true, rights: "check-required",
    fingerprint: String(index + 1).repeat(64),
  }));
  const result = await completeDraftImageLibrary({ sources: images,
    placements: images.slice(0, 2).map((image, index) => ({ id: `placement-${index}`, image, caption: image.caption, afterParagraph: index })),
    imageLimit: 2, plannedCount: 2, paragraphCount: 5, frozenPackage: true,
    copy: async (image) => ({ ...image, publicPath: `/media/draft/${image.id}.png` }), onCopyError: async () => assert.fail("copy failed"),
  });
  assert.equal(result.length, 7);
  assert.equal(result.filter((entry) => entry.afterParagraph >= 0).length, 2);
  assert.ok(result.slice(2).every((entry) => entry.afterParagraph === -1 && entry.image.publicPath));
  assert.ok(result.every((entry) => entry.image.sourceUrl === images[0]?.sourceUrl && entry.image.rights === "check-required"));
});
