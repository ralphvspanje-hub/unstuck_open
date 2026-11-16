// The model providers the setup page offers (ADR 0009). No imports, so the setup page can load it
// without the model code.

export type PresetApi = "gemini" | "openai" | "anthropic";

export type Preset = {
  id: string;
  /** In sentences: "Your OpenAI key doesn't work". */
  short: string;
  name: string;
  api: PresetApi;
  baseUrl: string;
  /** Where to get a key. */
  keyUrl?: string;
  /** Runs on this computer and needs no key. */
  local?: boolean;
  /** One line for the setup page. */
  note?: string;
};

export const PRESETS: Preset[] = [
  { id: "gemini", short: "Gemini", name: "Google Gemini (free)", api: "gemini", baseUrl: "", keyUrl: "https://aistudio.google.com/apikey", note: "The default: everything works, and a key is free." },
  { id: "openai", short: "OpenAI", name: "OpenAI", api: "openai", baseUrl: "https://api.openai.com/v1", keyUrl: "https://platform.openai.com/api-keys" },
  { id: "anthropic", short: "Anthropic", name: "Anthropic (Claude)", api: "anthropic", baseUrl: "https://api.anthropic.com", keyUrl: "https://console.anthropic.com/settings/keys" },
  { id: "mistral", short: "Mistral", name: "Mistral", api: "openai", baseUrl: "https://api.mistral.ai/v1", keyUrl: "https://console.mistral.ai/api-keys" },
  { id: "xai", short: "xAI", name: "xAI (Grok)", api: "openai", baseUrl: "https://api.x.ai/v1", keyUrl: "https://console.x.ai" },
  { id: "openrouter", short: "OpenRouter", name: "OpenRouter (many models, one key)", api: "openai", baseUrl: "https://openrouter.ai/api/v1", keyUrl: "https://openrouter.ai/keys", note: "Also reaches Claude, Llama, Qwen, DeepSeek and more." },
  { id: "ollama", short: "Ollama", name: "Ollama (on this computer)", api: "openai", baseUrl: "http://localhost:11434/v1", local: true, note: "Free and private; pick a model that can see images. Start Ollama with OLLAMA_ORIGINS=chrome-extension://* if it refuses Unstuck." },
  { id: "lmstudio", short: "LM Studio", name: "LM Studio (on this computer)", api: "openai", baseUrl: "http://localhost:1234/v1", local: true, note: "Free and private; pick a model that can see images." },
  { id: "custom", short: "API", name: "Another OpenAI-compatible API", api: "openai", baseUrl: "", note: "Any server with /chat/completions: Groq, Together, DeepSeek, your own..." },
];

export const presetOf = (id: string | undefined) => PRESETS.find((p) => p.id === id) ?? PRESETS[0];

/** The host pattern Chrome must allow before Unstuck can call this address. */
export function originPattern(baseUrl: string): string | null {
  try {
    const u = new URL(baseUrl);
    return /^https?:$/.test(u.protocol) ? `${u.protocol}//${u.hostname}/*` : null;
  } catch {
    return null;
  }
}
