import { describe, expect, test } from "bun:test";

import { videoGenerationOptions } from "./video.js";

describe("videoGenerationOptions", () => {
  test("forwards parsed video generation options", () => {
    expect(
      videoGenerationOptions({
        aspectRatio: "16:9",
        resolution: "1920x1080",
        duration: "5",
      })
    ).toEqual({
      aspectRatio: "16:9",
      resolution: "1920x1080",
      duration: 5,
    });
  });

  test("rejects invalid resolutions with the video flag name", () => {
    expect(() => videoGenerationOptions({ resolution: "1080p" })).toThrow(
      "--resolution must be in WxH format"
    );
  });
});
