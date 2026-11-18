import { useEffect, useRef, useState } from 'react';
import { microphoneError, normalizeAudio } from './audio';
import { speechStatus, transcribe } from './services';
import './voice.css';

export function VoiceInput({
  onText,
  disabled = false,
}: {
  onText: (text: string) => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'permission' | 'recording' | 'working'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('录音结束后发送至语音服务转文字；最多2分钟。');
  const [clip, setClip] = useState<Blob | null>(null);
  const [url, setUrl] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const context = useRef<AudioContext | null>(null);
  const frame = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const discard = useRef(false);
  const busy = useRef(false);
  function release() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    void context.current?.close().catch(() => undefined);
    context.current = null;
  }
  useEffect(() => {
    mounted.current = true;
    void speechStatus()
      .then((value) => {
        if (mounted.current) setNotice(value.message);
      })
      .catch(() => {
        if (mounted.current) setNotice('语音服务状态暂时不可用，可先录音回听。');
      });
    return () => {
      mounted.current = false;
      generation.current++;
      discard.current = true;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      release();
    };
  }, []);
  useEffect(() => {
    if (!clip) {
      setUrl('');
      return;
    }
    const objectUrl = URL.createObjectURL(clip);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [clip]);
  async function recognize(blob: Blob) {
    if (busy.current) return;
    busy.current = true;
    const id = generation.current;
    setState('working');
    setError('');
    try {
      const wav = await normalizeAudio(blob);
      const result = await transcribe(wav);
      if (mounted.current && id === generation.current) onText(result.text);
    } catch (e: unknown) {
      if (mounted.current && id === generation.current) setError(microphoneError(e));
    } finally {
      busy.current = false;
      if (mounted.current && id === generation.current) setState('idle');
    }
  }
  async function start() {
    if (state !== 'idle' || busy.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('当前浏览器不支持录音，请使用HTTPS页面及新版Chrome、Edge或Safari。');
      return;
    }
    const id = ++generation.current;
    discard.current = false;
    setError('');
    setSeconds(0);
    setState('permission');
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (!mounted.current || id !== generation.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      const audio = new AudioContext();
      context.current = audio;
      await audio.resume();
      if (!mounted.current || id !== generation.current) {
        release();
        return;
      }
      const analyser = audio.createAnalyser();
      analyser.fftSize = 256;
      audio.createMediaStreamSource(media).connect(analyser);
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((value) =>
        MediaRecorder.isTypeSupported(value),
      );
      const recording = new MediaRecorder(media, mime ? { mimeType: mime } : undefined);
      recorder.current = recording;
      const chunks: Blob[] = [];
      recording.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recording.onerror = () => {
        discard.current = true;
        release();
        if (mounted.current) {
          setState('idle');
          setError('录音设备中断，请重新录音');
        }
      };
      recording.onstop = () => {
        release();
        if (!mounted.current || id !== generation.current) return;
        setState('idle');
        if (discard.current) return;
        const blob = new Blob(chunks, { type: recording.mimeType });
        setClip(blob);
        void recognize(blob);
      };
      media.getAudioTracks().forEach((track) => {
        track.onended = () => {
          if (recording.state === 'recording') recording.stop();
        };
      });
      recording.start(1000);
      setState('recording');
      const startAt = Date.now();
      timer.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startAt) / 1000);
        setSeconds(elapsed);
        if (elapsed >= 119 && recording.state === 'recording') recording.stop();
      }, 250);
      const samples = new Uint8Array(analyser.frequencyBinCount);
      const draw = () => {
        const el = canvas.current;
        const drawing = el?.getContext('2d');
        analyser.getByteTimeDomainData(samples);
        if (el && drawing) {
          drawing.clearRect(0, 0, el.width, el.height);
          drawing.strokeStyle = '#28614f';
          drawing.lineWidth = 2;
          drawing.beginPath();
          samples.forEach((value, index) => {
            const x = (index * el.width) / (samples.length - 1),
              y = (value / 255) * el.height;
            index ? drawing.lineTo(x, y) : drawing.moveTo(x, y);
          });
          drawing.stroke();
        }
        frame.current = requestAnimationFrame(draw);
      };
      draw();
    } catch (e: unknown) {
      if (mounted.current && id === generation.current) {
        release();
        setError(microphoneError(e));
        setState('idle');
      }
    }
  }
  function cancel() {
    discard.current = true;
    generation.current++;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    release();
    setState('idle');
  }
  return (
    <section className="voice-input" aria-label="语音输入">
      <div className="voice-controls">
        {state === 'idle' && (
          <button type="button" disabled={disabled} onClick={() => void start()}>
            ◉ 语音输入
          </button>
        )}
        {state === 'permission' && (
          <>
            <span>等待麦克风授权…</span>
            <button type="button" onClick={cancel}>
              取消
            </button>
          </>
        )}
        {state === 'recording' && (
          <>
            <span role="status">
              ● 正在录音 {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
            </span>
            <canvas ref={canvas} width={220} height={36} aria-label="实时声音波形" />
            <button type="button" onClick={() => recorder.current?.stop()}>
              结束并识别
            </button>
            <button type="button" onClick={cancel}>
              取消
            </button>
          </>
        )}
        {state === 'working' && <span role="status">正在转成文字…</span>}
        {state === 'idle' && (
          <label className="voice-file">
            导入录音
            <input
              type="file"
              accept="audio/*,.m4a,.wav,.mp3"
              disabled={disabled}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) {
                  setClip(file);
                  void recognize(file);
                }
              }}
            />
          </label>
        )}
      </div>
      <small>{notice}</small>
      {error && (
        <p role="alert" className="voice-error">
          {error}{' '}
          <button type="button" onClick={() => void window.desktop.microphoneSettings()}>
            打开麦克风设置
          </button>
        </p>
      )}
      {url && (
        <div className="voice-controls">
          <audio controls src={url} aria-label="回听录音" />
          {state === 'idle' && (
            <>
              <button
                type="button"
                disabled={disabled}
                onClick={() => clip && void recognize(clip)}
              >
                重新识别
              </button>
              <button type="button" onClick={() => setClip(null)}>
                清除录音
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
