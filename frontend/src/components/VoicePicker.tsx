import { useEffect, useId, useState } from "react";
import { api } from "../api";

let voiceCache: Promise<Record<string, string>> | null = null;
const loadVoices = () => (voiceCache ??= api.voices().catch(() => ({})));

/** 音色输入框：下拉提示常用的 Edge 中文音色，也可以手填别的（比如 OpenAI 兼容接口的音色名），带试听。 */
export default function VoicePicker({
  value,
  onChange,
  placeholder,
  commitOnBlur = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** true：失焦/回车才回调（用于直接保存到数据库的场景） */
  commitOnBlur?: boolean;
}) {
  const id = useId();
  const [voices, setVoices] = useState<Record<string, string>>({});
  const [v, setV] = useState(value);
  const [state, setState] = useState<"" | "loading" | "error">("");
  const [err, setErr] = useState("");
  useEffect(() => {
    loadVoices().then(setVoices);
  }, []);
  useEffect(() => setV(value), [value]);

  const commit = () => {
    if (v !== value) onChange(v);
  };

  async function preview() {
    const voice = v.trim();
    if (!voice) return;
    setState("loading");
    setErr("");
    try {
      const { url } = await api.previewVoice(voice);
      await new Audio(url).play();
      setState("");
    } catch (e: any) {
      setState("error");
      setErr(e.message);
    }
  }

  return (
    <span className="voice-picker">
      <input list={id} value={v} placeholder={placeholder}
        onChange={(e) => {
          setV(e.target.value);
          if (!commitOnBlur) onChange(e.target.value);
        }}
        onBlur={commitOnBlur ? commit : undefined}
        onKeyDown={(e) => commitOnBlur && e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      <datalist id={id}>
        {Object.entries(voices).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </datalist>
      <button type="button" className="small-btn" onClick={preview} disabled={state === "loading" || !v.trim()} title={err || "用当前配音设置念一句试听"}>
        {state === "loading" ? "…" : state === "error" ? "试听失败" : "试听"}
      </button>
    </span>
  );
}
