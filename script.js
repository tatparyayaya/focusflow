/**
 * FocusFlow — Main JS Engine & Admin Portal Controller
 * Integrates Supabase ADHD Media Player & Admin Management
 */

document.addEventListener('DOMContentLoaded', () => {
  // =========================================================================
  // Theme Switcher
  // =========================================================================
  const themeToggle = document.getElementById('themeToggle');
  const themeIcon = document.getElementById('themeIcon');
  const htmlRoot = document.documentElement;

  if (themeToggle) {
    const savedTheme = localStorage.getItem('focusflow-theme') || 
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setTheme(savedTheme);

    themeToggle.addEventListener('click', () => {
      const currentTheme = htmlRoot.getAttribute('data-theme');
      setTheme(currentTheme === 'dark' ? 'light' : 'dark');
    });
  }

  function setTheme(theme) {
    htmlRoot.setAttribute('data-theme', theme);
    localStorage.setItem('focusflow-theme', theme);
    if (themeIcon) {
      themeIcon.className = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
      themeToggle.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    }
  }

  // =========================================================================
  // Global Media & Audio Player (Runs in Background)
  // =========================================================================
  const audioObj = new Audio();
  audioObj.loop = true;
  let mediaList = [];
  let currentTrackIndex = 0;
  let isPlaying = false;

  const trackSelect = document.getElementById('trackSelect');
  const currentTrackTitle = document.getElementById('currentTrackTitle');
  const currentTrackCategory = document.getElementById('currentTrackCategory');
  const mainPlayIcon = document.getElementById('mainPlayIcon');
  const playPauseBtn = document.getElementById('playPauseBtn');
  const prevTrackBtn = document.getElementById('prevTrackBtn');
  const nextTrackBtn = document.getElementById('nextTrackBtn');
  const muteBtn = document.getElementById('muteBtn');
  const muteIcon = document.getElementById('muteIcon');
  const volumeSlider = document.getElementById('volumeSlider');
  const equalizerBars = document.getElementById('equalizerBars');
  const filterPills = document.querySelectorAll('.pill');

  // Mini Player
  const miniPlayBtn = document.getElementById('miniPlayBtn');
  const miniPlayIcon = document.getElementById('miniPlayIcon');
  const miniTrackTitle = document.getElementById('miniTrackTitle');
  const miniTrackCategory = document.getElementById('miniTrackCategory');

  // Background Video
  const videoBackground = document.getElementById('videoBackground');
  const bgVideoIframe = document.getElementById('bgVideoIframe');
  const toggleBgVideoBtn = document.getElementById('toggleBgVideoBtn');
  const closeVideoBgBtn = document.getElementById('closeVideoBgBtn');

  // Fetch Supabase Media List via Python API
  async function loadSupabaseMedia() {
    try {
      const res = await fetch('/api/media');
      if (!res.ok) throw new Error('API request failed');
      mediaList = await res.json();
      
      // If on main page, populate dropdown
      if (trackSelect) {
        populateDropdown(mediaList);
        if (mediaList.length > 0) {
          selectTrack(0, false);
        }
      }
      
      // If on admin page, render admin dashboard table
      if (document.getElementById('mediaTableBody')) {
        renderAdminTable(mediaList);
      }
    } catch (err) {
      console.warn('Using local fallback media:', err);
    }
  }

  function populateDropdown(items) {
    if (!trackSelect) return;
    trackSelect.innerHTML = '';
    if (items.length === 0) {
      trackSelect.innerHTML = '<option value="">No media found in Supabase database</option>';
      return;
    }

    items.forEach((item, index) => {
      const opt = document.createElement('option');
      opt.value = index;
      const typeIcon = item.type === 'video' ? '🎬' : '🎵';
      opt.textContent = `${typeIcon} ${item.title} [${item.category || 'ADHD Focus'}]`;
      trackSelect.appendChild(opt);
    });
  }

  function selectTrack(index, autoPlay = true) {
    if (!mediaList || mediaList.length === 0) return;
    if (index < 0) index = mediaList.length - 1;
    if (index >= mediaList.length) index = 0;

    currentTrackIndex = index;
    const track = mediaList[index];

    if (currentTrackTitle) currentTrackTitle.textContent = track.title;
    if (currentTrackCategory) currentTrackCategory.textContent = track.category || 'ADHD Focus';
    if (miniTrackTitle) miniTrackTitle.textContent = track.title;
    if (miniTrackCategory) miniTrackCategory.textContent = track.category || 'ADHD Focus';
    if (trackSelect) trackSelect.value = index;

    // Check if item is video or audio
    if (track.type === 'video' || track.url.includes('youtube.com') || track.url.includes('youtu.be')) {
      audioObj.pause();
      setPlayState(false);
      showVideoBackground(track.url);
    } else {
      if (videoBackground) videoBackground.classList.add('hidden');
      audioObj.src = track.url;
      if (autoPlay) {
        audioObj.play().then(() => setPlayState(true)).catch(() => setPlayState(false));
      }
    }
  }

  function togglePlay() {
    if (!mediaList || mediaList.length === 0) return;
    const track = mediaList[currentTrackIndex];

    if (track && track.type === 'video') {
      if (videoBackground) {
        videoBackground.classList.toggle('hidden');
      }
      return;
    }

    if (isPlaying) {
      audioObj.pause();
      setPlayState(false);
    } else {
      audioObj.play().then(() => setPlayState(true)).catch(err => console.error(err));
    }
  }

  function setPlayState(playing) {
    isPlaying = playing;
    if (mainPlayIcon) mainPlayIcon.className = playing ? 'fa-solid fa-pause' : 'fa-solid fa-play';
    if (miniPlayIcon) miniPlayIcon.className = playing ? 'fa-solid fa-pause' : 'fa-solid fa-play';
    const cdIcon = document.getElementById('cdIcon');
    if (cdIcon) cdIcon.classList.toggle('fa-spin', playing);
    if (equalizerBars) equalizerBars.classList.toggle('hidden', !playing);
  }

  function showVideoBackground(url) {
    if (!videoBackground || !bgVideoIframe) return;
    let embedUrl = url;
    if (url.includes('watch?v=')) {
      embedUrl = url.replace('watch?v=', 'embed/');
    }
    if (!embedUrl.includes('autoplay=')) {
      embedUrl += (embedUrl.includes('?') ? '&' : '?') + 'autoplay=1&mute=1&loop=1';
    }
    bgVideoIframe.src = embedUrl;
    videoBackground.classList.remove('hidden');
  }

  // Audio Event Listeners
  if (playPauseBtn) playPauseBtn.addEventListener('click', togglePlay);
  if (miniPlayBtn) miniPlayBtn.addEventListener('click', togglePlay);

  if (prevTrackBtn) {
    prevTrackBtn.addEventListener('click', () => selectTrack(currentTrackIndex - 1, true));
  }
  if (nextTrackBtn) {
    nextTrackBtn.addEventListener('click', () => selectTrack(currentTrackIndex + 1, true));
  }
  if (trackSelect) {
    trackSelect.addEventListener('change', (e) => selectTrack(parseInt(e.target.value, 10), true));
  }

  if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
      const vol = parseFloat(e.target.value);
      audioObj.volume = vol;
      audioObj.muted = (vol === 0);
      if (muteIcon) {
        muteIcon.className = vol === 0 ? 'fa-solid fa-volume-xmark' : (vol < 0.5 ? 'fa-solid fa-volume-low' : 'fa-solid fa-volume-high');
      }
    });
  }

  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      audioObj.muted = !audioObj.muted;
      if (muteIcon) {
        muteIcon.className = audioObj.muted ? 'fa-solid fa-volume-xmark' : 'fa-solid fa-volume-high';
      }
    });
  }

  if (toggleBgVideoBtn) {
    toggleBgVideoBtn.addEventListener('click', () => {
      const track = mediaList[currentTrackIndex];
      if (track) showVideoBackground(track.url);
    });
  }
  if (closeVideoBgBtn) {
    closeVideoBgBtn.addEventListener('click', () => {
      if (videoBackground) videoBackground.classList.add('hidden');
      if (bgVideoIframe) bgVideoIframe.src = '';
    });
  }

  // Filter Pills
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const filter = pill.dataset.filter;

      if (filter === 'all') {
        populateDropdown(mediaList);
      } else {
        const filtered = mediaList.filter(m => m.type === filter || m.category === filter);
        populateDropdown(filtered);
      }
    });
  });

  // =========================================================================
  // Pomodoro Timer Logic
  // =========================================================================
  let totalTime = 1500;
  let timeLeft = totalTime;
  let timerInterval = null;
  let isTimerRunning = false;
  let sessionsCount = 0;
  let totalFocusMinutes = 0;

  const timeDisplay = document.getElementById('timeDisplay');
  const sessionStatus = document.getElementById('sessionStatus');
  const startTimerBtn = document.getElementById('startTimerBtn');
  const resetTimerBtn = document.getElementById('resetTimerBtn');
  const startBtnText = document.getElementById('startBtnText');
  const playIcon = document.getElementById('playIcon');
  const progressRing = document.getElementById('progressRing');
  const modeTabs = document.querySelectorAll('.mode-tab');
  const sessionsCompletedEl = document.getElementById('sessionsCompleted');
  const minutesFocusedEl = document.getElementById('minutesFocused');

  if (progressRing) {
    const circleCircumference = 2 * Math.PI * 95;
    progressRing.style.strokeDasharray = `${circleCircumference} ${circleCircumference}`;
    progressRing.style.strokeDashoffset = 0;

    function updateDisplay() {
      const mins = Math.floor(timeLeft / 60);
      const secs = timeLeft % 60;
      timeDisplay.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      const progressRatio = (totalTime - timeLeft) / totalTime;
      progressRing.style.strokeDashoffset = circleCircumference * (1 - progressRatio);
    }

    function startTimer() {
      if (isTimerRunning) return;
      isTimerRunning = true;
      startBtnText.textContent = 'Pause';
      playIcon.className = 'fa-solid fa-pause';
      sessionStatus.textContent = 'Focusing...';

      timerInterval = setInterval(() => {
        if (timeLeft > 0) {
          timeLeft--;
          updateDisplay();
        } else {
          clearInterval(timerInterval);
          isTimerRunning = false;
          playChime();
          startBtnText.textContent = 'Start';
          playIcon.className = 'fa-solid fa-play';
          sessionStatus.textContent = 'Session Complete! 🎉';

          const activeTab = document.querySelector('.mode-tab.active');
          if (activeTab && activeTab.dataset.label === 'Focus Session') {
            sessionsCount++;
            totalFocusMinutes += Math.floor(totalTime / 60);
            if (sessionsCompletedEl) sessionsCompletedEl.textContent = sessionsCount;
            if (minutesFocusedEl) minutesFocusedEl.textContent = `${totalFocusMinutes}m`;
          }
        }
      }, 1000);
    }

    function pauseTimer() {
      if (!isTimerRunning) return;
      clearInterval(timerInterval);
      isTimerRunning = false;
      startBtnText.textContent = 'Resume';
      playIcon.className = 'fa-solid fa-play';
      sessionStatus.textContent = 'Paused';
    }

    function resetTimer() {
      clearInterval(timerInterval);
      isTimerRunning = false;
      timeLeft = totalTime;
      startBtnText.textContent = 'Start';
      playIcon.className = 'fa-solid fa-play';
      const activeTab = document.querySelector('.mode-tab.active');
      sessionStatus.textContent = activeTab ? `Ready (${activeTab.dataset.label})` : 'Ready';
      updateDisplay();
    }

    if (startTimerBtn) startTimerBtn.addEventListener('click', () => isTimerRunning ? pauseTimer() : startTimer());
    if (resetTimerBtn) resetTimerBtn.addEventListener('click', resetTimer);

    modeTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        modeTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        totalTime = parseInt(tab.dataset.time, 10);
        resetTimer();
      });
    });

    updateDisplay();
  }

  function playChime() {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.8);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.8);
    } catch (e) {}
  }

  // =========================================================================
  // AI Coach Generator
  // =========================================================================
  const tips = [
    "The 5-Minute Rule: If you're struggling to start, commit to working for just 5 minutes. Motivation follows action!",
    "Active Recall: Test yourself with key questions or explain a concept out loud to lock it into memory.",
    "Hydration & Movement: Drink water and stretch your legs between 25-minute Pomodoro sessions.",
    "Single-tasking power: Close extra browser tabs and put your phone out of sight during focus sprints."
  ];

  const aiAdviceEl = document.getElementById('aiAdvice');
  const getTipBtn = document.getElementById('getTipBtn');
  const getPlanBtn = document.getElementById('getPlanBtn');
  const getMotivationBtn = document.getElementById('getMotivationBtn');

  if (aiAdviceEl) {
    if (getTipBtn) {
      getTipBtn.addEventListener('click', () => {
        const tip = tips[Math.floor(Math.random() * tips.length)];
        aiAdviceEl.innerText = `💡 Study Tip: ${tip}`;
      });
    }
    if (getPlanBtn) {
      getPlanBtn.addEventListener('click', () => {
        aiAdviceEl.innerText = "⚡ 2-Hour Plan:\n• 25m Focus Hard Task\n• 5m Rest & Hydrate\n• 25m Practice Problems\n• 5m Walk\n• 25m Review Key Notes";
      });
    }
    if (getMotivationBtn) {
      getMotivationBtn.addEventListener('click', () => {
        aiAdviceEl.innerText = "🔥 'Small daily improvements over time lead to stunning results.' Keep going!";
      });
    }
  }

  // =========================================================================
  // Admin Portal Operations (Add / Delete Supabase Items)
  // =========================================================================
  const addMediaForm = document.getElementById('addMediaForm');
  const mediaTableBody = document.getElementById('mediaTableBody');
  const formFeedback = document.getElementById('formFeedback');
  const refreshLibraryBtn = document.getElementById('refreshLibraryBtn');

  if (addMediaForm) {
    addMediaForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('mediaTitle').value.trim();
      const type = document.getElementById('mediaType').value;
      const category = document.getElementById('mediaCategory').value;
      const url = document.getElementById('mediaUrl').value.trim();

      const saveBtn = document.getElementById('saveMediaBtn');
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving to Supabase...';

      try {
        const res = await fetch('/api/media', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, type, category, url })
        });
        if (!res.ok) throw new Error('Failed to save to database');
        
        formFeedback.textContent = '✨ Successfully added to Supabase database!';
        formFeedback.className = 'form-feedback success';
        addMediaForm.reset();
        await loadSupabaseMedia();
      } catch (err) {
        formFeedback.textContent = `❌ Error: ${err.message}`;
        formFeedback.className = 'form-feedback error';
      } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Add to Supabase Database';
      }
    });
  }

  if (refreshLibraryBtn) {
    refreshLibraryBtn.addEventListener('click', loadSupabaseMedia);
  }

  function renderAdminTable(items) {
    if (!mediaTableBody) return;
    
    // Update Stats
    const statAudio = document.getElementById('statAudioCount');
    const statVideo = document.getElementById('statVideoCount');
    const statTotal = document.getElementById('statTotalCount');
    
    if (statAudio) statAudio.textContent = items.filter(i => i.type === 'audio').length;
    if (statVideo) statVideo.textContent = items.filter(i => i.type === 'video').length;
    if (statTotal) statTotal.textContent = items.length;

    if (items.length === 0) {
      mediaTableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4">No media items in Supabase database. Use form above to add some!</td></tr>';
      return;
    }

    mediaTableBody.innerHTML = '';
    items.forEach(item => {
      const tr = document.createElement('tr');
      const typeBadge = item.type === 'video' ? 
        '<span class="badge-type badge-video"><i class="fa-solid fa-video"></i> Video</span>' : 
        '<span class="badge-type badge-audio"><i class="fa-solid fa-music"></i> Audio</span>';

      tr.innerHTML = `
        <td><code>#${item.id || '-'}</code></td>
        <td>${typeBadge}</td>
        <td class="font-weight-600">${escapeHtml(item.title)}</td>
        <td><span class="category-pill">${escapeHtml(item.category || 'ADHD Focus')}</span></td>
        <td>
          <button class="btn btn-danger btn-sm btn-delete" data-id="${item.id}">
            <i class="fa-solid fa-trash-can"></i> Delete
          </button>
        </td>
      `;
      mediaTableBody.appendChild(tr);
    });

    // Attach Delete listeners
    document.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        if (confirm(`Are you sure you want to delete item #${id} from Supabase database?`)) {
          btn.disabled = true;
          btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
          try {
            const res = await fetch(`/api/media/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Delete failed');
            await loadSupabaseMedia();
          } catch (err) {
            alert('Delete failed: ' + err.message);
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-trash-can"></i> Delete';
          }
        }
      });
    });
  }

  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Initial Load
  loadSupabaseMedia();
});
