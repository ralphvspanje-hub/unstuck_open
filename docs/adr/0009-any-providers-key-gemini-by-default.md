# Any provider's key, Gemini by default

Unstuck was built on Gemini, and Gemini has things no other provider has together: Decision 1 for the judge (a calibrated 0-1 answer to "would an explanation help right now?" in about a second), models trained to put boxes on an image (Marks), audio input (a lecture's last minutes of sound, [ADR 0008](0008-lectures-send-their-last-minutes-of-sound.md)), and a free tier, so a new Viewer can try it at no cost. Once the code went public, people want to bring the key they already have: OpenAI, Anthropic, Mistral, xAI, OpenRouter, or a model running on their own computer.

So the setup page offers a provider, and the model code has a second path next to `gemini.ts`: `src/ai/chat.ts`, with the same prompts. Most providers speak OpenAI's chat-completions format (OpenAI, Mistral, xAI, OpenRouter, Ollama, LM Studio, Groq, Together, DeepSeek...), so one adapter covers them, with an editable API address; Anthropic gets its own, small one. The Viewer picks a model from the provider's own list (`/models`), so Unstuck never has to know model names, and can set a second model for Simulations. A key is tried with one tiny answer from the chosen model before it is kept, and is kept the same way as a Gemini key (ADR 0007). Chrome is asked for the address when it isn't one of the known ones.

What another provider gives up, and how it degrades:

- **The judge** is a prompt with Decision 1's question and criteria, answered as JSON `{"score": ...}`: slower, and less steady near the line.
- **Marks** need a model that can see images and give boxes; when it can't, the boxes don't match and no Marks are drawn.
- **A lecture's sound** isn't sent; the Explanation uses the captions and the Outline.
- **Thinking** is whatever the model does by itself. Parameters a model turns down (reasoning models take no `temperature` and want `max_completion_tokens`) are left out on the next try and remembered.
- **Free:** only Gemini has a free API tier; local models are free but run on the Viewer's computer.

Gemini stays the default and the path everything is tuned on. The local server stays Gemini-only: it is the development setup.
