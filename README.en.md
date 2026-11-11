# OneDragon Studio · AI漫剧一条龙

[简体中文](README.md) | **English** | [日本語](README.ja.md) | [한국어](README.ko.md) | [Français](README.fr.md) | [Español](README.es.md) | [العربية](README.ar.md)

> **Note:** The web interface is currently available in Simplified Chinese only.

An AI comic-drama pipeline from script to finished video, with a web interface, deployed locally.

```
Script → AI storyboard → Character/scene assets → Shot first frames → Image-to-video → Voice-over & subtitles → Final video
```

- **Step-by-step workflow**: every step's output is saved and editable in the browser; change one step and re-run from there, no need to start over.
- **Background task queue**: long-running jobs are queued, failures are retried automatically, and work resumes even if you close the page or restart the server. No Redis / Docker required.
- **Pluggable models**: text LLMs come with built-in presets for DeepSeek, OpenAI, Google Gemini, Anthropic Claude, Azure OpenAI, OpenRouter, Alibaba Cloud Model Studio, Volcano Engine Ark, Ollama, plus any OpenAI-compatible endpoint, with an optional proxy for overseas APIs; image and video generation can use cloud platforms (Alibaba Cloud Model Studio (阿里云百炼), Volcano Engine Ark (火山方舟), no GPU needed) or ComfyUI (on your own machine or a remote GPU server).
- **Vertical first**: 9:16 by default, aimed at short dramas and comic dramas for Kuaishou / Douyin.

## Development Progress

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Project / episode management, script import, AI storyboard (editable), task queue, settings | ✅ |
| 2 | Character/scene reference images, shot first frames, image-to-video (ComfyUI + demo provider), uploading your own images | ✅ |
| 3 | Dialogue voice-over, subtitles, final video composition (AI label), MP4 / SRT download | ✅ |
| 4 | Story/novel import with chapter splitting, props, cross-project asset library, prompt configuration, AI logs | ✅ |
| 5 | Cloud image/video generation (Alibaba Cloud Model Studio / Volcano Engine Ark), one-click episode, sidebar UI and welcome page | ✅ |

## Quick Start (Windows)

Requires Python 3.10+ and Node.js 18+.

Double-click `start.bat`. On first run it installs dependencies and builds the frontend automatically, then opens http://127.0.0.1:8100 .

Then:

1. Open **Settings** (「设置」), enter the text LLM's endpoint URL, model name and your own API Key, then click **Save and Test Connection** (「保存并测试连接」).
2. Go back to **Projects** (「项目」) and create a new drama. Click **Import Story or Novel** (「导入故事或小说」) (TXT / EPUB / paste) to split it into episodes by chapter heading, by plot (AI) or by word count; in the preview you can rename, merge and select episodes. You can also create an episode and paste a script into it.
3. Click **AI Storyboard** (「AI 拆分镜」); within tens of seconds you get a storyboard table: scene, shot size, camera movement, visuals, dialogue, first-frame prompt and video prompt, all directly editable.
4. Back on the project page, **Generate Missing Reference Images** (「一键生成缺少的参考图」) creates reference images for characters, scenes and props (you can also upload your own).
5. In the storyboard table, use **Batch Generate First Frames** (「批量生成首帧」) → **Batch Generate Videos** (「批量生成视频」), or regenerate shots one by one.
6. Or just click **One-Click Episode** (「一键成片」) on the episode page: it runs storyboard → reference images → first frames → videos → voice-over → composition automatically, skipping anything that already exists; if a step fails it stops and explains why, and once you've fixed it, click again to continue.
7. Click **Compose Final Video** (「合成成片」): it fills in any missing dialogue voice-over, burns in subtitles and the **AI-generated** (「AI生成」) label, joins everything into a single MP4, and lets you preview and download it (with SRT subtitles) at the bottom of the page.

Voice-over uses Edge online text-to-speech by default (free, no key required, unofficial API); you can also switch to an OpenAI-compatible `/audio/speech` endpoint (e.g. a self-hosted CosyVoice). Each character can be assigned a voice; characters without one get a voice chosen automatically based on the gender in their appearance description.

Other pages:

- **Asset Library**: click **Save to Asset Library** (「存入素材库」) on a character, scene or prop in a project, then **Import from Asset Library** (「从素材库导入」) in another project; the same character keeps the same look and voice in your second drama.
- **Prompts**: the AI storyboard, AI episode-splitting and reference-image templates can all be edited in the browser, with one-click restore to defaults if you break something.
- **AI Logs**: what was sent to the LLM on each call, what came back and how many tokens were used; check here first when storyboard results look wrong.

## Real Visuals Without a GPU: Cloud Platforms

In **System Settings** (「系统设置」), set the image / video provider to **Alibaba Cloud Model Studio (阿里云百炼)** (Tongyi Wanxiang wan2.6) or **Volcano Engine Ark (火山方舟)** (Doubao Seedream / Seedance), enter your own API Key and you'll get real visuals, billed per image / per second at the platform's prices.

- Shot first frames automatically include reference images of the characters, props and scene in the shot (up to 4), keeping characters more consistent across shots.
- Videos are generated as visuals only (the platform's built-in audio is turned off); voice-over, subtitles and the AI label are handled by this tool.
- Model names can be changed in settings, so when a platform releases a new model, just switch the name. **Save and Test API Key** (「保存并测试 API Key」) only validates the key; it generates nothing and costs nothing.

The default is the **Demo** (「演示」) provider: it calls no models and produces placeholder images with text and slow zoom-in placeholder videos, so you can get the whole workflow running first.

## Using ComfyUI

Image and video generation aren't tied to any specific model; they use workflows you've tuned yourself in ComfyUI:

1. Build a workflow in ComfyUI and run it successfully by hand, then choose **Export (API)** (「导出 (API)」) from the menu to get the JSON.
2. Replace the input values that change on each run with placeholders, e.g. `"text": "{{prompt}}"` for the positive prompt and `"width": "{{width}}"` for the empty Latent.
3. In **Settings** (「设置」), point the address at ComfyUI (your own machine or a rented GPU server), paste the three workflows, and select ComfyUI as the image / video provider.

| Workflow | Purpose | Required placeholders |
| --- | --- | --- |
| Text-to-image | Character/scene reference images; shot first frames when no reference images exist | `{{prompt}}` |
| Reference-to-image (optional) | Shot first frames that include reference images of the characters, props and scene in the shot (up to 3) | `{{prompt}}` `{{ref_image_1}}` |
| Image-to-video | First frame + video prompt → the video for this shot | `{{image}}` `{{prompt}}` |

Other available placeholders: `{{negative}}` `{{seed}}` `{{width}}` `{{height}}` `{{ref_image_2}}` `{{ref_image_3}}` `{{frames}}` `{{fps}}` `{{duration}}` `{{filename_prefix}}`. When a placeholder is the entire value, it's replaced with the original type (numbers stay numbers); when it's embedded in text, it's substituted as text. Images are uploaded to ComfyUI automatically and results are downloaded back automatically.

Prompts are in Chinese by default, so models that understand Chinese (such as Qwen-Image, the Wan series or Hunyuan) work best.

## Development Mode

```bash
# Backend (port 8100)
cd backend
python -m venv venv
venv\Scripts\pip install -r requirements.txt
venv\Scripts\python -m uvicorn app.main:app --port 8100 --reload --reload-dir app

# Frontend (port 5174, API requests are proxied to 8100 automatically)
cd frontend
npm install
npm run dev
```

API docs: http://127.0.0.1:8100/docs

## Directory Structure

```
backend/
  app/
    main.py            Entry point: routes, static files, starts the task queue
    models.py          Data models: projects, episodes, shots, characters, scenes, props, asset library, AI logs, tasks, settings
    prompts.py         Prompt templates editable in the browser
    routers/           HTTP endpoints
    services/          Business logic (storyboarding, task queue...)
    providers/         Model providers (LLM, ComfyUI...)
  data/                Runtime data (database, generated images and videos), not committed to git
frontend/              React + Vite web app
```

## Data & Privacy

API Keys, scripts and generated assets are stored only on your machine in `backend/data/` and are never uploaded anywhere (except for calls to the model APIs you configure). This directory is excluded in `.gitignore`.

## Buy Me a Milk Tea

If this project saved you some time, feel free to buy me a milk tea 🧋 (there's also a link at the bottom of the web sidebar).

<table>
  <tr>
    <td align="center"><img src="frontend/public/donate/wechat.jpg" width="200" alt="WeChat Pay QR code"><br>WeChat Pay</td>
    <td align="center"><img src="frontend/public/donate/alipay.jpg" width="200" alt="Alipay QR code"><br>Alipay</td>
  </tr>
</table>

### Contact the Author

- Email: [bajiebujiese@126.com](mailto:bajiebujiese@126.com)
- WeChat Official Account: **IT架构师修炼** (search for it in WeChat and follow)

Bug reports, collaboration and general discussion are all welcome.

## License

[MIT](LICENSE)
