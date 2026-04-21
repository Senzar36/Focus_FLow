# ⚡ FocusFlow — Intelligent Study Tracker

> A browser-based study tracker that uses your webcam and AI to keep you focused, manage your time, and help you study smarter.

---

## 📸 Features

| Feature | Description |
|---|---|
| 👁️ Face Detection | Webcam-based focus tracking using TensorFlow.js + BlazeFace |
| ⏱️ Smart Timer | Tracks elapsed time and pure focus time separately |
| ☕ Auto Breaks | Forces a 10-minute break after every 60 minutes of focus |
| 📚 AI Study Assistant | Chat with a local Ollama LLM using your uploaded notes as context |
| 📊 Session Analytics | Post-session charts: timeline, distribution, milestones |

---

## 🚀 Getting Started

### Requirements

- A modern browser (Chrome or Edge recommended for best webcam support)
- [Ollama](https://ollama.com) installed locally (for the AI Study Assistant)
- A webcam

### Running the App

FocusFlow is a single self-contained HTML file — no build step, no server, no dependencies to install.

```bash
# Just open the file in your browser
open FocusFlow.html
# or on Linux
xdg-open FocusFlow.html
```

> ⚠️ **Grant camera permission** when the browser asks — face detection won't work without it.

---

## 🤖 Setting Up Ollama (AI Study Assistant)

The Study tab connects to a locally running Ollama instance. The app sends requests to `http://localhost:11434`.

### 1. Install Ollama

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows
# Download the installer from https://ollama.com/download
```

### 2. Pull a Model

```bash
ollama pull llama3.2       # recommended — fast and capable
ollama pull mistral        # great alternative
ollama pull gemma3         # Google's model
```

### 3. Start Ollama with CORS Enabled

The browser needs CORS headers to talk to the local API. Start Ollama like this:

```bash
OLLAMA_ORIGINS=* ollama serve
```

> On Windows (PowerShell):
> ```powershell
> $env:OLLAMA_ORIGINS="*"; ollama serve
> ```

### 4. Select Your Model in the App

In the **Study** tab, type your model name in the **Ollama Model** field (e.g., `llama3.2`, `mistral`).

---

## 🎯 How to Use

### Focus Tab

1. Set your **target session duration** in minutes (e.g., `90` for 90 minutes).
2. Click **▶ START SESSION**.
3. Position yourself in front of the webcam so your face is clearly visible.
4. The timer tracks two values:
   - **Elapsed** — total time since session start
   - **Focus** — time your face was detected and pointing at the screen
5. If you look away for more than **2 seconds**, the focus timer pauses automatically.
6. Use **⏸ PAUSE** to manually pause, or **⏹ STOP** to end the session.

#### Break System

- After every **60 minutes of accumulated focus time**, a full-screen break overlay appears.
- The break lasts **10 minutes** with a live countdown.
- Suggested activities: drink water, rest your eyes (20-20-20 rule), stretch, walk around.
- You can skip the break if needed, but it's not recommended!

---

### Study Tab

1. **Upload your notes** — drag and drop or click the upload zone. Supports `.txt` and `.md` files.
2. A preview of your notes appears below the upload zone.
3. **Type a question** in the chat box and press `Enter` (or click ➤).
4. The AI will answer using your notes as context.

**Example prompts:**
- *"Summarize the key concepts from my notes."*
- *"Quiz me on Chapter 3."*
- *"Explain the difference between X and Y in simple terms."*
- *"What are the most important things I should remember?"*
- *"Create 5 practice questions based on my notes."*

---

### Analytics Tab

Available after you stop a session. Shows:

- **Summary Cards** — total time, focus time, focus rate %, distraction count
- **Focus Timeline** — minute-by-minute bar chart showing focused / distracted / break segments
- **Time Distribution** — donut chart of how your session time was split
- **Session Milestones** — bar chart comparing focus vs. distracted vs. break minutes

---

## ⚙️ Configuration

All configuration is done directly in the UI — no config files needed.

| Setting | Where | Default |
|---|---|---|
| Session duration | Focus tab → duration input | 60 min |
| Ollama model | Study tab → model field | `llama3.2` |
| Break interval | Hardcoded | 60 min of focus |
| Break duration | Hardcoded | 10 min |
| Face-loss grace period | Hardcoded | 2 seconds |

---

## 🧰 Tech Stack

| Technology | Purpose |
|---|---|
| Vanilla HTML / CSS / JS | UI and app logic — zero frameworks |
| [TensorFlow.js](https://www.tensorflow.org/js) `v3.21` | ML runtime in the browser |
| [BlazeFace](https://github.com/tensorflow/tfjs-models/tree/master/blazeface) `v0.1` | Lightweight real-time face detection model |
| [Chart.js](https://www.chartjs.org/) `v4.4` | Session analytics charts |
| [Ollama](https://ollama.com) API | Local LLM inference for the study assistant |
| Google Fonts | Orbitron, Syne, DM Mono |

---

## 🛠️ Troubleshooting

**Camera not working**
- Make sure you've granted camera permissions in the browser.
- Chrome/Edge work best. Safari may have restrictions.
- Check that no other app is using the camera.

**Face detection not triggering**
- Ensure your face is well-lit and clearly visible.
- Avoid strong backlighting (don't sit with a window behind you).
- The model loads from a CDN — wait a few seconds after the page loads.

**Ollama connection failed**
- Confirm Ollama is running: `curl http://localhost:11434` should return a response.
- Make sure you started it with `OLLAMA_ORIGINS=* ollama serve`, not just `ollama serve`.
- Confirm the model name in the app matches what you pulled (e.g., `llama3.2` not `llama3`).

**Timer was jumping (old bug)**
- This was a double-accumulation bug in the `tick()` function — fixed in the current version. Re-download the file if you have an older copy.

---

## 📁 File Structure

```
FocusFlow.html        ← The entire app (single file, no dependencies)
README.md             ← This file
```

---

## 🔭 Potential Future Improvements

- [ ] Persistent session history saved to `localStorage`
- [ ] Export analytics as PNG or PDF
- [ ] Support for PDF note uploads
- [ ] Pomodoro mode (customizable work/break intervals)
- [ ] Ambient sound / white noise integration
- [ ] Multi-session comparison charts
- [ ] Eye gaze estimation (not just face presence)
