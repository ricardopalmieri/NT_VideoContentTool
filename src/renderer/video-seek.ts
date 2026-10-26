const SEEK_EPSILON_SECONDS = 0.001;

export function shouldSeekVideo(currentTime: number, targetTime: number) {
  return Math.abs(currentTime - targetTime) > SEEK_EPSILON_SECONDS;
}
