
const BREAK_FOCUS_INTERVAL = 60 * 60; // 60 min of focus
const BREAK_DURATION       = 10 * 60; // 10 min break
const NO_FACE_MS           = 2000;    // 2s before marking distracted
const CIRC                 = 2 * Math.PI * 110; // SVG ring circumference

// ══════════════════════════════════════════════════
        //  STATE
        // ══════════════════════════════════════════════════
        let phase = 'idle'; // idle | running | paused | break | done

        // Elapsed tracking
        let accElapsed   = 0;      // seconds before pause
        let segStart     = null;   // Date.now() when current segment started
        let targetSecs   = 3600;

        // Focus tracking
        let accFocus     = 0;      // seconds before current focus streak
        let focusStart   = null;   // Date.now() when current focus streak started
        let isFocused    = false;
        let noFaceTimer  = null;

        // Break tracking
        let focusAtBreak = 0;      // accFocus when last break was triggered
        let breaksTaken  = 0;
        let breakEndTime = null;
        let breakTick    = null;

        // Stats
        let distractions = 0;

        // Clock
        let clockTick = null;

        // Timeline for analytics  [{ts, type}]
        let timeline   = [];
        let sessionEnd = null;

        // TF
        let tfModel    = null;
        let camStream  = null;
        let detRunning = false;
        let detTimer   = null;

        // Notes & chat
        let notes      = '';
        let history    = []; // chat history

        // ══════════════════════════════════════════════════
        //  INIT
        // ══════════════════════════════════════════════════
        window.addEventListener('load', () => {
        initCamera();
        const dz = document.getElementById('dropZone');
        dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag'); });
        dz.addEventListener('dragleave', ()  => dz.classList.remove('drag'));
        dz.addEventListener('drop', e => {
            e.preventDefault(); dz.classList.remove('drag');
            const f = e.dataTransfer.files[0];
            if (f) readFile(f);
        });
        });

        // ══════════════════════════════════════════════════
        //  CAMERA & FACE DETECTION
        // ══════════════════════════════════════════════════
        async function initCamera() {
        try {
            camStream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480, facingMode: 'user' }
            });
            const vid = document.getElementById('camera');
            vid.srcObject = camStream;
            await vid.play();

            const cvs = document.getElementById('faceCanvas');
            cvs.width  = vid.videoWidth  || 640;
            cvs.height = vid.videoHeight || 480;

            document.getElementById('camStatus').textContent = 'Camera ready — loading AI model…';
            document.getElementById('modelLoad').style.display = 'flex';

            tfModel = await blazeface.load();

            document.getElementById('modelLoad').style.display = 'none';
            document.getElementById('camStatus').textContent   = 'Face detection active';
            startDetect();
        } catch(err) {
            document.getElementById('modelLoad').style.display = 'none';
            document.getElementById('camWrap').innerHTML = `
            <div class="cam-no">
                <div style="font-size:44px">📷</div>
                <div>Camera unavailable or denied</div>
                <div style="font-size:10px;margin-top:4px">Timer will run without face detection</div>
            </div>`;
            showToast('Camera access denied — running in manual mode');
        }
        }

        function startDetect() {
        if (detRunning) return;
        detRunning = true;
        detect();
        }

        async function detect() {
        if (!detRunning) return;
        const vid = document.getElementById('camera');
        const cvs = document.getElementById('faceCanvas');

        if (tfModel && vid.readyState >= 2) {
            try {
            const preds = await tfModel.estimateFaces(vid, false);
            const ctx   = cvs.getContext('2d');
            ctx.clearRect(0, 0, cvs.width, cvs.height);

            const found = preds.length > 0;

            for (const p of preds) {
                const [x, y]   = p.topLeft;
                const [bx, by] = p.bottomRight;
                ctx.strokeStyle = '#10b981';
                ctx.lineWidth   = 2;
                ctx.strokeRect(x, y, bx-x, by-y);
                ctx.fillStyle = '#06b6d4';
                for (const lm of (p.landmarks || [])) {
                ctx.beginPath();
                ctx.arc(lm[0], lm[1], 2, 0, Math.PI*2);
                ctx.fill();
                }
            }

            found ? onFaceFound() : onFaceLost();
            } catch(_) {}
        }

        detTimer = setTimeout(detect, 400);
        }

        function onFaceFound() {
        if (noFaceTimer) { clearTimeout(noFaceTimer); noFaceTimer = null; }

        if (!isFocused) {
            isFocused   = true;
            if (phase === 'running') {
            focusStart = Date.now();
            logEvent('focus');
            }
            setFocusUI(true);
        }
        }

        function onFaceLost() {
        if (isFocused && !noFaceTimer) {
            noFaceTimer = setTimeout(() => {
            isFocused   = false;
            noFaceTimer = null;

            if (phase === 'running') {
                if (focusStart) { accFocus += (Date.now() - focusStart) / 1000; focusStart = null; }
                distractions++;
                logEvent('distract');
            }
            setFocusUI(false);
            }, NO_FACE_MS);
        }
        }

        function setFocusUI(on) {
        const pill   = document.getElementById('focusPill');
        const txt    = document.getElementById('pillTxt');
        const border = document.getElementById('camBorder');
        const num    = document.getElementById('timerNum');

        if (on) {
            pill.className   = 'pill focused';
            txt.textContent  = 'FOCUSED';
            if (border) border.className = 'cam-border focused';
            num.className    = 'timer-num focused';
        } else {
            pill.className   = 'pill distracted';
            txt.textContent  = 'DISTRACTED';
            if (border) border.className = 'cam-border distracted';
            num.className    = 'timer-num';
        }
        }

        // ══════════════════════════════════════════════════
        //  SESSION CONTROL
        // ══════════════════════════════════════════════════
        function startSession() {
        const mins    = Math.max(1, parseInt(document.getElementById('durInput').value) || 60);
        targetSecs    = mins * 60;

        phase         = 'running';
        accElapsed    = 0;
        segStart      = Date.now();
        accFocus      = 0;
        focusStart    = isFocused ? Date.now() : null;
        focusAtBreak  = 0;
        distractions  = 0;
        breaksTaken   = 0;
        timeline      = [];
        sessionEnd    = null;

        if (isFocused) logEvent('focus');

        document.getElementById('durRow').style.display = 'none';
        document.getElementById('ctrlBtns').innerHTML   = `
            <button class="btn btn-secondary" id="pauseBtn" onclick="togglePause()">⏸ PAUSE</button>
            <button class="btn btn-danger" onclick="stopSession()">⏹ STOP</button>
        `;

        clockTick = setInterval(tick, 1000);
        showToast('Session started — stay focused! 🚀');
        }

        function togglePause() {
        if (phase === 'running') {
            phase = 'paused';
            accElapsed += (Date.now() - segStart) / 1000;
            segStart    = null;
            if (focusStart) { accFocus += (Date.now() - focusStart) / 1000; focusStart = null; }
            clearInterval(clockTick);
            document.getElementById('pauseBtn').textContent = '▶ RESUME';
        } else if (phase === 'paused') {
            phase    = 'running';
            segStart = Date.now();
            if (isFocused) { focusStart = Date.now(); logEvent('focus'); }
            clockTick = setInterval(tick, 1000);
            document.getElementById('pauseBtn').textContent = '⏸ PAUSE';
        }
        }

        function stopSession() {
        if (phase === 'break') { clearInterval(breakTick); document.getElementById('breakBg').classList.remove('on'); }
        clearInterval(clockTick);
        phase = 'done';

        // Final accumulations
        if (segStart) { accElapsed += (Date.now() - segStart) / 1000; segStart = null; }
        if (focusStart) { accFocus += (Date.now() - focusStart) / 1000; focusStart = null; }

        sessionEnd = {
            elapsed:     Math.round(accElapsed),
            focus:       Math.round(accFocus),
            distractions,
            breaksTaken,
            timeline:    [...timeline]
        };

        document.getElementById('durRow').style.display = 'flex';
        document.getElementById('ctrlBtns').innerHTML   = `
            <button class="btn btn-primary" onclick="startSession()">▶ NEW SESSION</button>
            <button class="btn btn-secondary" onclick="switchTab('analytics', document.querySelectorAll('.nav-btn')[2])">📊 VIEW ANALYTICS</button>
        `;

        document.getElementById('focusPill').className = 'pill idle';
        document.getElementById('pillTxt').textContent = 'IDLE';

        renderAnalytics();
        showToast('Session complete! View your analytics 📊');
        }

        // ──────────────────────────────────────────────────
        function tick() {
        // Accumulate elapsed
        const now = Date.now();
        if (segStart) accElapsed = (now - segStart) / 1000 + (accElapsed - (accElapsed % 1 === 0 ? 0 : 0));
        // Recalculate from segment start for accuracy
        const realElapsed = segStart
            ? (now - segStart) / 1000 + (parseFloat(accElapsed) - (segStart ? (now - segStart)/1000 : 0))
            : accElapsed;

        const elapsed = getElapsed();
        const focus   = getFocus();

        // Target reached
        if (elapsed >= targetSecs) { stopSession(); showToast('🎉 Target time reached!'); return; }

        // Break check
        const focusSinceLast = focus - focusAtBreak;
        if (focusSinceLast >= BREAK_FOCUS_INTERVAL) { triggerBreak(); return; }

        updateDisplay(elapsed, focus);
        }

        function getElapsed() {
        let t = accElapsed;
        if (segStart) t += (Date.now() - segStart) / 1000;
        return t;
        }

        function getFocus() {
        let t = accFocus;
        if (focusStart) t += (Date.now() - focusStart) / 1000;
        return t;
        }

        function updateDisplay(elapsed, focus) {
        const pct = elapsed > 0 ? Math.round((focus / elapsed) * 100) : 0;

        document.getElementById('timerNum').textContent = fmt(elapsed);
        document.getElementById('focusNum').textContent = `FOCUS: ${fmt(focus)}`;
        document.getElementById('hdrFocus').textContent  = fmt(focus);

        // Ring
        const prog = Math.min(elapsed / targetSecs, 1);
        document.getElementById('ringTrack').style.strokeDasharray = `${prog * CIRC} ${CIRC}`;

        // Stats
        document.getElementById('sFocus').textContent    = fmt(focus);
        document.getElementById('sDistract').textContent  = distractions;
        document.getElementById('sRate').textContent      = elapsed > 5 ? `${pct}%` : '—';
        document.getElementById('sBreaks').textContent    = breaksTaken;

        const toBreak = Math.max(0, Math.ceil((BREAK_FOCUS_INTERVAL - (focus - focusAtBreak)) / 60));
        document.getElementById('sNextBreak').textContent = phase === 'running' ? `${toBreak} min` : '—';

        document.getElementById('focusBar').style.width = `${Math.min(pct, 100)}%`;
        }

        // ══════════════════════════════════════════════════
        //  BREAK
        // ══════════════════════════════════════════════════
        function triggerBreak() {
        if (phase === 'break') return;
        clearInterval(clockTick);

        // Commit focus time
        if (focusStart) { accFocus += (Date.now() - focusStart) / 1000; focusStart = null; }
        if (segStart)   { accElapsed += (Date.now() - segStart) / 1000; segStart = null; }
        isFocused = false;

        focusAtBreak = getFocus();
        breaksTaken++;
        phase        = 'break';
        breakEndTime = Date.now() + BREAK_DURATION * 1000;
        logEvent('break_start');

        document.getElementById('breakBg').classList.add('on');

        breakTick = setInterval(() => {
            const rem = Math.max(0, Math.round((breakEndTime - Date.now()) / 1000));
            document.getElementById('breakNum').textContent = fmt(rem);
            if (rem <= 0) endBreak();
        }, 1000);

        showToast('⏰ Break time! Drink some water 💧');
        }

        function endBreak() {
        clearInterval(breakTick);
        document.getElementById('breakBg').classList.remove('on');
        logEvent('break_end');

        phase    = 'running';
        segStart = Date.now();
        if (isFocused) { focusStart = Date.now(); logEvent('focus'); }
        clockTick = setInterval(tick, 1000);
        }

        function skipBreak() {
        clearInterval(breakTick);
        document.getElementById('breakBg').classList.remove('on');
        logEvent('break_end');
        phase    = 'running';
        segStart = Date.now();
        if (isFocused) { focusStart = Date.now(); }
        clockTick = setInterval(tick, 1000);
        showToast('Break skipped — remember to hydrate! 💧');
        }

        function logEvent(type) {
        timeline.push({ ts: getElapsed(), type });
        }

        // ══════════════════════════════════════════════════
        //  NOTES & CHAT
        // ══════════════════════════════════════════════════
        function loadFile(e) {
        const f = e.target.files[0];
        if (f) readFile(f);
        }

        function readFile(f) {
        const r = new FileReader();
        r.onload = ev => {
            notes = ev.target.result;
            document.getElementById('notesView').textContent = notes.slice(0, 3000) + (notes.length > 3000 ? '\n…[truncated in preview]' : '');
            addSysmsg(`Notes loaded: "${f.name}" — ${(f.size/1024).toFixed(1)} KB`);
            showToast('Notes loaded! Ask me anything 📚');
        };
        r.readAsText(f);
        }

        function clearNotes() {
        notes = '';
        document.getElementById('notesView').textContent = 'No notes uploaded yet.';
        document.getElementById('fileIn').value = '';
        }

        function chatKey(e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
        }

        async function sendChat() {
        const inp  = document.getElementById('chatIn');
        const text = inp.value.trim();
        if (!text) return;
        inp.value = '';

        addMsg('user', text);
        history.push({ role: 'user', content: text });

        const tid = addThinking();
        const model = document.getElementById('modelInput').value.trim() || 'llama3.2';

        const sys = notes
            ? `You are an expert study assistant helping a student master their notes.\n\nSTUDENT NOTES:\n---\n${notes.slice(0, 8000)}\n---\n\nHelp them understand concepts, quiz them, create summaries, and make connections. Be concise and educational.`
            : `You are a helpful study assistant. No notes have been uploaded yet. Help with study techniques, concepts the student mentions, or general academic guidance. Be concise and encouraging.`;

        try {
            const res = await fetch('http://localhost:11434/api/chat', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                model,
                messages: [{ role: 'system', content: sys }, ...history.slice(-12)],
                stream:   false
            })
            });

            killThinking(tid);

            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const d = await res.json();
            const reply = d.message?.content || 'No response.';
            addMsg('ai', reply);
            history.push({ role: 'assistant', content: reply });

        } catch(err) {
            killThinking(tid);
            addMsg('ai', `⚠️ Cannot connect to Ollama (localhost:11434).\n\nSetup steps:\n1. Install Ollama: ollama.com\n2. Run: OLLAMA_ORIGINS=* ollama serve\n3. Pull model: ollama pull ${model}\n\nError: ${err.message}`);
        }
        }

        function addMsg(role, txt) {
        const box = document.getElementById('chatMsgs');
        const d   = document.createElement('div');
        d.className = `msg ${role}`;
        const safe = escHtml(txt)
            .replace(/\n/g, '<br>')
            .replace(/`([^`]+)`/g, '<code>$1</code>');
        d.innerHTML = `<div class="msg-from">${role === 'user' ? 'YOU' : 'ASSISTANT'}</div>${safe}`;
        box.appendChild(d);
        box.scrollTop = box.scrollHeight;
        }

        function addSysmsg(txt) {
        const box = document.getElementById('chatMsgs');
        const d   = document.createElement('div');
        d.className   = 'msg sys';
        d.textContent = txt;
        box.appendChild(d);
        box.scrollTop = box.scrollHeight;
        }

        let tid = 0;
        function addThinking() {
        const id  = ++tid;
        const box = document.getElementById('chatMsgs');
        const d   = document.createElement('div');
        d.id        = `t${id}`;
        d.className = 'msg ai thinking-row';
        d.innerHTML = '<div class="spinner"></div><span>Thinking…</span>';
        box.appendChild(d);
        box.scrollTop = box.scrollHeight;
        return id;
        }
        function killThinking(id) {
        const el = document.getElementById(`t${id}`);
        if (el) el.remove();
        }
        function escHtml(s) {
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        }

        // ══════════════════════════════════════════════════
        //  ANALYTICS
        // ══════════════════════════════════════════════════
        function renderAnalytics() {
        if (!sessionEnd) return;
        const { elapsed, focus, distractions: dc, breaksTaken: bt, timeline: tl } = sessionEnd;
        const pct   = elapsed > 0 ? Math.round((focus / elapsed) * 100) : 0;
        const dist  = Math.max(0, elapsed - focus);

        document.getElementById('emptyState').style.display   = 'none';
        document.getElementById('analyticsData').style.display = 'block';

        // Summary
        document.getElementById('sumRow').innerHTML = `
            <div class="sum-card">
            <div class="sum-icon">⏱️</div>
            <div class="sum-val" style="color:var(--accent)">${fmt(elapsed)}</div>
            <div class="sum-tag">Total Session</div>
            </div>
            <div class="sum-card">
            <div class="sum-icon">🎯</div>
            <div class="sum-val" style="color:var(--green)">${fmt(focus)}</div>
            <div class="sum-tag">Focus Time</div>
            </div>
            <div class="sum-card">
            <div class="sum-icon">📈</div>
            <div class="sum-val" style="color:var(--purple)">${pct}%</div>
            <div class="sum-tag">Focus Rate</div>
            </div>
            <div class="sum-card">
            <div class="sum-icon">👀</div>
            <div class="sum-val" style="color:var(--red)">${dc}</div>
            <div class="sum-tag">Distractions</div>
            </div>
        `;

        // Build per-minute focus array
        const totalMins = Math.max(1, Math.ceil(elapsed / 60));
        const focusMins = new Array(totalMins).fill(0);
        const breakMins = new Array(totalMins).fill(0);
        const labels    = Array.from({length: totalMins}, (_, i) => `${i+1}m`);

        let curFocused = false, curBreak = false, lastTs = 0;
        for (const ev of tl) {
            const fromMin = Math.floor(lastTs / 60);
            const toMin   = Math.min(Math.floor(ev.ts / 60), totalMins - 1);
            for (let m = fromMin; m <= toMin; m++) {
            if (curFocused) focusMins[m] = 1;
            if (curBreak)   breakMins[m] = 1;
            }
            if (ev.type === 'focus')       { curFocused = true;  curBreak = false; }
            if (ev.type === 'distract')    { curFocused = false; curBreak = false; }
            if (ev.type === 'break_start') { curFocused = false; curBreak = true;  }
            if (ev.type === 'break_end')   { curFocused = false; curBreak = false; }
            lastTs = ev.ts;
        }
        // Fill remaining
        const lastMin = Math.min(Math.floor(lastTs / 60), totalMins - 1);
        for (let m = lastMin; m < totalMins; m++) {
            if (curFocused) focusMins[m] = 1;
            if (curBreak)   breakMins[m] = 1;
        }
        const distractMins = focusMins.map((v, i) => (!v && !breakMins[i]) ? 1 : 0);

        const chartDefaults = {
            responsive: true,
            plugins: { legend: { labels: { color: '#8fa3c0', font: { family: 'DM Mono', size: 11 } } } },
        };

        // Timeline chart
        const existTl = Chart.getChart('tlChart');
        if (existTl) existTl.destroy();
        new Chart(document.getElementById('tlChart'), {
            type: 'bar',
            data: {
            labels,
            datasets: [
                { label: 'Focused',    data: focusMins,    backgroundColor: 'rgba(16,185,129,.75)', borderWidth: 0 },
                { label: 'Distracted', data: distractMins, backgroundColor: 'rgba(239,68,68,.4)',   borderWidth: 0 },
                { label: 'Break',      data: breakMins,    backgroundColor: 'rgba(245,158,11,.55)', borderWidth: 0 },
            ]
            },
            options: {
            ...chartDefaults,
            scales: {
                x: { stacked: true, ticks: { color:'#3d5470', font:{family:'DM Mono',size:10}, maxRotation:0 }, grid:{color:'rgba(30,41,59,.5)'} },
                y: { stacked: true, display: false, max: 1 }
            }
            }
        });

        // Donut chart
        const existDist = Chart.getChart('distChart');
        if (existDist) existDist.destroy();
        new Chart(document.getElementById('distChart'), {
            type: 'doughnut',
            data: {
            labels: ['Focus', 'Distracted', 'Break'],
            datasets: [{
                data: [Math.round(focus), Math.round(dist - bt * BREAK_DURATION), Math.round(bt * BREAK_DURATION)],
                backgroundColor: ['rgba(16,185,129,.8)','rgba(239,68,68,.5)','rgba(245,158,11,.6)'],
                borderColor:     ['rgba(16,185,129,1)', 'rgba(239,68,68,.7)','rgba(245,158,11,.8)'],
                borderWidth: 1
            }]
            },
            options: {
            ...chartDefaults,
            plugins: {
                ...chartDefaults.plugins,
                tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmt(ctx.raw)}` } }
            },
            cutout: '68%'
            }
        });

        // Milestones bar chart
        const existMil = Chart.getChart('milChart');
        if (existMil) existMil.destroy();
        new Chart(document.getElementById('milChart'), {
            type: 'bar',
            data: {
            labels: ['Focus', 'Distracted', 'Breaks'],
            datasets: [{
                data: [Math.round(focus/60), Math.round(Math.max(0,elapsed-focus-bt*BREAK_DURATION)/60), bt*10],
                backgroundColor: ['rgba(6,182,212,.7)','rgba(239,68,68,.5)','rgba(245,158,11,.6)'],
                borderColor:     ['rgba(6,182,212,1)', 'rgba(239,68,68,.8)','rgba(245,158,11,.9)'],
                borderWidth: 1, borderRadius: 6
            }]
            },
            options: {
            ...chartDefaults,
            plugins: { ...chartDefaults.plugins, legend: { display: false } },
            scales: {
                x: { ticks: { color:'#8fa3c0', font:{family:'DM Mono',size:11} }, grid:{color:'rgba(30,41,59,.5)'} },
                y: { ticks: { color:'#3d5470', font:{family:'DM Mono',size:10}, callback: v => `${v}m` }, grid:{color:'rgba(30,41,59,.3)'} }
            }
            }
        });
        }

        // ══════════════════════════════════════════════════
        //  UTILS
        // ══════════════════════════════════════════════════
        function fmt(secs) {
        const s = Math.max(0, Math.floor(secs));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        return `${pad(h)}:${pad(m)}:${pad(sec)}`;
        }
        function pad(n) { return String(n).padStart(2, '0'); }

        function switchTab(tab, btn) {
        document.querySelectorAll('.panel').forEach(p  => p.classList.remove('active'));
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.getElementById(`tab-${tab}`).classList.add('active');
        if (btn) btn.classList.add('active');
        }

        let toastTO;
        function showToast(msg) {
        const t = document.getElementById('toast');
        t.textContent = msg;
        t.classList.add('on');
        clearTimeout(toastTO);
        toastTO = setTimeout(() => t.classList.remove('on'), 3200);
        }