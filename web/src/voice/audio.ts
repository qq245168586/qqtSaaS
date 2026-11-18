export async function normalizeAudio(blob: Blob): Promise<Blob> {
  if (blob.size > 20 * 1024 * 1024) throw new Error("音频不能超过20MB");
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (decoded.duration > 120 || decoded.duration < 0.2)
      throw new Error("请选择0.2秒至2分钟的录音");
    const offline = new OfflineAudioContext(
      1,
      Math.ceil(decoded.duration * 16000),
      16000,
    );
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const pcm = (await offline.startRendering()).getChannelData(0);
    const data = new ArrayBuffer(44 + pcm.length * 2);
    const view = new DataView(data);
    const text = (offset: number, value: string) =>
      [...value].forEach((char, i) =>
        view.setUint8(offset + i, char.charCodeAt(0)),
      );
    text(0, "RIFF");
    view.setUint32(4, data.byteLength - 8, true);
    text(8, "WAVE");
    text(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true);
    view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, "data");
    view.setUint32(40, pcm.length * 2, true);
    pcm.forEach((value, index) => {
      const sample = Math.max(-1, Math.min(1, value));
      view.setInt16(
        44 + index * 2,
        sample * (sample < 0 ? 32768 : 32767),
        true,
      );
    });
    return new Blob([data], { type: "audio/wav" });
  } finally {
    await context.close();
  }
}
export function microphoneError(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (["NotAllowedError", "SecurityError"].includes(name))
    return "麦克风权限未开启。请允许应用或本站使用麦克风，并检查系统隐私设置。";
  if (name === "NotFoundError") return "没有找到麦克风，请连接麦克风后重试。";
  if (name === "NotReadableError")
    return "麦克风被占用或设备不可用，请检查其他应用和设备连接。";
  return error instanceof Error ? error.message : "录音失败，请重试";
}
