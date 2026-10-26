import { describe, expect, it } from "vitest";
import { syncLinkedAudioTracks, syncLinkedVideoLayer } from "../../src/model/linked-media";
import { createAudioTrack, createLayer } from "../../src/model/types";

const settings = { name: "Link", width: 320, height: 180, fps: 24, duration: 10, background: "#000000", transparent: true };

describe("linked media domain operations", () => {
  it("copies video timing, source and fades to each linked audio track only", () => {
    const video = createLayer("video", settings, {
      id: "video",
      startTime: 2,
      endTime: 6,
      sourceIn: 1,
      sourceOut: 5,
      playbackRate: 1.5,
      reverse: true,
      loop: true,
      fadeInStart: 2,
      fadeInEnd: 2.4,
      fadeOutStart: 5.6,
      fadeOutEnd: 6,
    });
    const linked = createAudioTrack("Linked", "audio.wav", 10, { linked: true, linkedLayerId: video.id });
    const unlinked = createAudioTrack("Detached", "other.wav", 10, { startTime: 7 });

    syncLinkedAudioTracks(video, [linked, unlinked]);

    expect(linked).toMatchObject({
      startTime: 2,
      endTime: 6,
      sourceIn: 1,
      sourceOut: 5,
      playbackRate: 1.5,
      reverse: true,
      loop: true,
      fadeInStart: 2,
      fadeInEnd: 2.4,
      fadeOutStart: 5.6,
      fadeOutEnd: 6,
    });
    expect(unlinked.startTime).toBe(7);
  });

  it("copies linked audio timing and fades back to video, then re-aligns its linked tracks", () => {
    const video = createLayer("video", settings, { id: "video" });
    const linked = createAudioTrack("Linked", "audio.wav", 10, {
      linked: true,
      linkedLayerId: video.id,
      startTime: 3,
      endTime: 8,
      sourceIn: 1,
      sourceOut: 6,
      playbackRate: 2,
      reverse: true,
      loop: true,
      fadeInStart: 3,
      fadeInEnd: 3.5,
      fadeOutStart: 7.5,
      fadeOutEnd: 8,
    });
    const result = syncLinkedVideoLayer(linked, [video], [linked]);

    expect(result).toBe(video);
    expect(video).toMatchObject({
      startTime: 3,
      endTime: 8,
      sourceIn: 1,
      sourceOut: 6,
      playbackRate: 2,
      reverse: true,
      loop: true,
      fadeInStart: 3,
      fadeInEnd: 3.5,
      fadeOutStart: 7.5,
      fadeOutEnd: 8,
    });
    expect(linked.startTime).toBe(video.startTime);
    expect(syncLinkedVideoLayer({ ...linked, linked: false }, [video], [linked])).toBeUndefined();
  });
});
