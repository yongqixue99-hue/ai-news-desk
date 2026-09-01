import assert from "node:assert/strict";
import test from "node:test";
import type { StoryView } from "./product-types.js";
import { searchLicensedEditorialImages } from "./online-image-search.js";

const story = {
  id: "story-hinton",
  title: "诺贝尔奖得主 Geoffrey Hinton 警告 AI 风险",
  originalTitle: "Nobel laureate Geoffrey Hinton warns about AI risks",
  summary: "Geoffrey Hinton discussed the risks of artificial intelligence.",
  signals: [],
} as unknown as StoryView;

test("online image search keeps real identity, license and trademark restrictions auditable", async () => {
  const queries: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    queries.push(url.searchParams.get("gsrsearch") || "");
    return Response.json({
      query: {
        pages: [
          {
            pageid: 101,
            title: "File:Geoffrey Hinton at UCL.jpg",
            imageinfo: [{
              width: 1800,
              height: 2400,
              thumburl: "https://upload.wikimedia.org/geoffrey-hinton.jpg",
              thumbwidth: 1200,
              thumbheight: 1600,
              descriptionurl: "https://commons.wikimedia.org/wiki/File:Geoffrey_Hinton_at_UCL.jpg",
              mime: "image/jpeg",
              extmetadata: {
                Artist: { value: "<a href='https://example.com'>Jane Example</a>" },
                ImageDescription: { value: "Geoffrey Hinton speaking at UCL" },
                LicenseShortName: { value: "CC BY 4.0" },
                LicenseUrl: { value: "https://creativecommons.org/licenses/by/4.0/" },
                Restrictions: { value: "" },
              },
            }],
          },
          {
            pageid: 102,
            title: "File:Geoffrey Hinton company logo.svg",
            imageinfo: [{
              width: 300,
              height: 80,
              thumburl: "https://upload.wikimedia.org/hinton-logo.png",
              thumbwidth: 1200,
              thumbheight: 320,
              descriptionurl: "https://commons.wikimedia.org/wiki/File:Hinton_company_logo.svg",
              mime: "image/svg+xml",
              extmetadata: {
                Artist: { value: "Example company" },
                ImageDescription: { value: "Company logo" },
                LicenseShortName: { value: "Public domain" },
                Restrictions: { value: "" },
              },
            }],
          },
          {
            pageid: 103,
            title: "File:Geoffrey Hinton copyrighted portrait.jpg",
            imageinfo: [{
              width: 1200,
              height: 1600,
              url: "https://upload.wikimedia.org/copyrighted.jpg",
              descriptionurl: "https://commons.wikimedia.org/wiki/File:Copyrighted.jpg",
              mime: "image/jpeg",
              extmetadata: {
                Artist: { value: "Unknown" },
                LicenseShortName: { value: "All rights reserved" },
              },
            }],
          },
          {
            pageid: 104,
            title: "File:Generic artificial intelligence circuit.jpg",
            imageinfo: [{
              width: 1600,
              height: 900,
              url: "https://upload.wikimedia.org/generic-ai.jpg",
              descriptionurl: "https://commons.wikimedia.org/wiki/File:Generic_AI.jpg",
              mime: "image/jpeg",
              extmetadata: {
                Artist: { value: "Generic Artist" },
                ImageDescription: { value: "Generic artificial intelligence circuit" },
                LicenseShortName: { value: "CC BY 4.0" },
                LicenseUrl: { value: "https://creativecommons.org/licenses/by/4.0/" },
              },
            }],
          },
        ],
      },
    });
  };

  const images = await searchLicensedEditorialImages(story, 3, { fetcher });

  assert.match(queries[0] || "", /Geoffrey Hinton/u);
  assert.equal(images.length, 2, "unlicensed search results are excluded");
  assert.deepEqual(images.map((image) => ({
    caption: image.caption,
    priority: image.editorialPriority,
    rights: image.rights,
    licenseId: image.licenseId,
    attribution: image.attribution,
  })), [
    {
      caption: "Geoffrey Hinton speaking at UCL",
      priority: 3,
      rights: "licensed",
      licenseId: "CC-BY-4.0",
      attribution: "Jane Example / Wikimedia Commons",
    },
    {
      caption: "Company logo",
      priority: 3,
      rights: "check-required",
      licenseId: "PUBLIC-DOMAIN",
      attribution: "Example company / Wikimedia Commons",
    },
  ]);
  assert.deepEqual(images[0]?.allowedPlatforms, ["wechat", "xiaoheihe"]);
  assert.deepEqual(images[1]?.allowedPlatforms, []);
  assert.match(images[1]?.evidenceNote || "", /商标/u);
});

test("hybrid Chinese company names become a specific identity query", async () => {
  const queries: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    queries.push(new URL(String(input)).searchParams.get("gsrsearch") || "");
    return Response.json({ query: { pages: [] } });
  };

  await searchLicensedEditorialImages({
    id: "story-sony-music",
    title: "索尼 Music 起诉 AI 公司侵权",
    originalTitle: "索尼 Music 起诉 AI 公司侵权",
    summary: "索尼音乐对相关公司提起诉讼。",
  }, 2, { fetcher });

  assert.match(queries[0] || "", /^Sony Music\b/u);
});

test("product names do not become identity searches when a known company is present", async () => {
  const queries: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    queries.push(new URL(String(input)).searchParams.get("gsrsearch") || "");
    return Response.json({ query: { pages: [] } });
  };

  await searchLicensedEditorialImages({
    id: "story-apple-mac",
    title: "Apple 发布新款 Mac mini 和 Mac Studio",
    originalTitle: "Apple ships new Mac mini and Mac Studio",
    summary: "Apple updated its desktop Mac lineup.",
  }, 2, { fetcher, priority: 3 });

  assert.match(queries[0] || "", /^Apple Inc\. filetype:bitmap/u);
  assert.equal(queries.some((query) => /Mac Studio/u.test(query)), false);
});
