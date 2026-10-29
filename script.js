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

  // Authentication is verified by the server; client state only controls presentation.
  const loginButton = document.getElementById('loginButton');
  const loginLabel = document.getElementById('loginLabel');
  const loginDialog = document.getElementById('loginDialog');
  const logoutButton = document.getElementById('logoutButton');
  const createAccountButton = document.getElementById('createAccountButton');
  let creatingAccount = false;
  async function refreshSession() {
    try {
      const response = await fetch('/api/session', { cache: 'no-store' });
      if (!response.ok) throw new Error('Session unavailable');
      const { user } = await response.json();
      if (loginLabel) loginLabel.textContent = user ? user.name : 'Login';
      if (logoutButton) logoutButton.hidden = !user;
      if (createAccountButton) createAccountButton.hidden = !!user;
      document.querySelectorAll('[data-admin-link]').forEach(link => { link.hidden = !user?.admin; });
    } catch {
      if (loginLabel) loginLabel.textContent = 'Login';
      if (createAccountButton) createAccountButton.hidden = false;
      document.querySelectorAll('[data-admin-link]').forEach(link => { link.hidden = true; });
    }
  }
  function openAuth(signup) {
    creatingAccount = signup;
    const form = document.getElementById('loginForm');
    form.reset();
    document.getElementById('authTitle').textContent = signup ? 'Create your student account' : 'Login to FocusFlow';
    document.getElementById('signupNameLabel').hidden = !signup;
    form.elements.name.required = signup;
    form.elements.password.minLength = signup ? 8 : 1;
    form.elements.password.autocomplete = signup ? 'new-password' : 'current-password';
    document.getElementById('authSubmit').textContent = signup ? 'Create Account' : 'Login';
    document.getElementById('loginError').textContent = '';
    document.getElementById('authMessage').textContent = '';
    loginDialog.showModal();
    form.elements[signup ? 'name' : 'email'].focus();
  }
  loginButton?.addEventListener('click', event => { event.preventDefault(); openAuth(false); });
  createAccountButton?.addEventListener('click', event => { event.preventDefault(); openAuth(true); });
  document.getElementById('closeLogin')?.addEventListener('click', () => loginDialog.close());
  document.getElementById('loginForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const error = document.getElementById('loginError');
    error.textContent = '';
    try {
      const response = await fetch(creatingAccount ? '/api/signup' : '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.elements.name.value.trim(), email: form.elements.email.value.trim(), password: form.elements.password.value }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Login failed');
      form.reset();
      if (result.confirmation_required) {
        document.getElementById('authMessage').textContent = 'Check your email to confirm your account, then log in.';
        return;
      }
      await refreshSession();
      loginDialog.close();
    } catch (err) { error.textContent = err instanceof TypeError ? 'Cannot reach FocusFlow. Please reload the page and try again.' : err.message; }
    finally { submit.disabled = false; }
  });
  logoutButton?.addEventListener('click', async () => {
    try {
      const response = await fetch('/api/logout', { method: 'POST' });
      if (!response.ok) throw new Error('Logout failed');
      await refreshSession();
      loginDialog.close();
    } catch (err) { document.getElementById('loginError').textContent = err.message; }
  });
  if (loginButton) {
    refreshSession();
    window.addEventListener('focus', refreshSession);
  }

  document.querySelectorAll('a[href="#timer-demo"]').forEach(link => link.addEventListener('click', event => {
    const timer = document.querySelector('.timer-card');
    if (!timer) return;
    event.preventDefault();
    const headerHeight = document.querySelector('.navbar')?.getBoundingClientRect().height || 0;
    window.scrollTo({ top: window.scrollY + timer.getBoundingClientRect().top - headerHeight - 16,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }));
  const musicToggle = document.getElementById('musicToggle');
  const miniPlayer = document.getElementById('miniPlayer');
  function setPlayerExpanded(expanded) {
    if (!miniPlayer) return;
    miniPlayer.classList.toggle('minimized', !expanded);
    musicToggle.setAttribute('aria-expanded', String(expanded));
    musicToggle.setAttribute('aria-label', expanded ? 'Minimize music player' : 'Expand music player');
  }
  musicToggle?.addEventListener('click', () => setPlayerExpanded(miniPlayer.classList.contains('minimized')));
  document.querySelectorAll('a[href="#adhd-player"]').forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    setPlayerExpanded(true);
    document.getElementById('trackSelect')?.focus();
  }));

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
      opt.value = mediaList.indexOf(item);
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

    if (track.type === 'video') {
      audioObj.pause();
      setPlayState(false);
      if (autoPlay) showVideoBackground(track.url);
    } else {
      closeStudyVideo();
      audioObj.src = track.url;
      if (autoPlay) audioObj.play().then(() => setPlayState(true)).catch(() => setPlayState(false));
    }
  }

  function togglePlay() {
    if (!mediaList.length) return;
    const track = mediaList[currentTrackIndex];
    if (track.type === 'video') {
      if (videoBackground.classList.contains('hidden')) showVideoBackground(track.url);
      else toggleStudyPlayback();
    } else if (isPlaying) {
      audioObj.pause(); setPlayState(false);
    } else audioObj.play().then(() => setPlayState(true)).catch(() => setPlayState(false));
  }

  function setPlayState(playing) {
    isPlaying = playing;
    if (mainPlayIcon) mainPlayIcon.className = playing ? 'fa-solid fa-pause' : 'fa-solid fa-play';
    if (miniPlayIcon) miniPlayIcon.className = playing ? 'fa-solid fa-pause' : 'fa-solid fa-play';
    const cdIcon = document.getElementById('cdIcon');
    if (cdIcon) cdIcon.classList.toggle('fa-spin', playing);
    if (equalizerBars) equalizerBars.classList.toggle('hidden', !playing);
  }

  const studyNative = document.getElementById('studyNativeVideo');
  const studyError = document.getElementById('studyVideoError');
  const studyTimerSlot = document.getElementById('studyTimerSlot');
  let studyTimerMarker = null;
  let studyPlaying = false;
  let youtubeOrigin = null;
  function videoSource(raw) {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Unsupported video URL.');
    const host = url.hostname.toLowerCase();
    if (['youtube.com','www.youtube.com','m.youtube.com','youtube-nocookie.com','www.youtube-nocookie.com','youtu.be'].includes(host)) {
      const id = host === 'youtu.be' ? url.pathname.slice(1) : url.pathname.startsWith('/embed/') ? url.pathname.split('/')[2] : url.pathname.startsWith('/shorts/') ? url.pathname.split('/')[2] : url.searchParams.get('v');
      if (!/^[a-zA-Z0-9_-]{11}$/.test(id || '')) throw new Error('Please select a valid YouTube video link.');
      return {youtube: true, url: `https://www.youtube.com/embed/${id}?enablejsapi=1&autoplay=1&origin=${encodeURIComponent(location.origin)}`};
    }
    if (!/\.(mp4|webm|ogv|ogg|mov)$/i.test(url.pathname)) throw new Error('Unsupported video link. Use a YouTube URL or a direct MP4, WebM or Ogg video.');
    return {youtube: false, url: url.href};
  }
  function stopStudyPlayback() {
    if (!studyNative) return;
    studyNative.pause(); studyNative.removeAttribute('src'); studyNative.load();
    bgVideoIframe.removeAttribute('src');
    studyNative.hidden = true; bgVideoIframe.hidden = true;
    youtubeOrigin = null; studyPlaying = false; setPlayState(false);
  }
  function closeStudyVideo() {
    if (!videoBackground || !studyNative || (videoBackground.classList.contains('hidden') && !studyTimerMarker)) return;
    stopStudyPlayback();
    videoBackground.classList.add('hidden');
    document.body.classList.remove('study-open');
    if (studyTimerMarker) { studyTimerMarker.replaceWith(document.querySelector('.timer-card')); studyTimerMarker = null; }
  }
  function showVideoBackground(raw) {
    if (!studyNative || !studyTimerSlot) return;
    stopStudyPlayback();
    studyError.textContent = '';
    document.getElementById('studyVideoTitle').textContent = mediaList[currentTrackIndex]?.title || 'Study With Me';
    if (!studyTimerMarker) {
      const timer = document.querySelector('.timer-card');
      studyTimerMarker = document.createComment('study-timer-position');
      timer.before(studyTimerMarker); studyTimerSlot.append(timer);
    }
    videoBackground.classList.remove('hidden'); document.body.classList.add('study-open');
    try {
      const source = videoSource(raw);
      if (source.youtube) {
        bgVideoIframe.hidden = false; bgVideoIframe.src = source.url;
        youtubeOrigin = 'https://www.youtube.com';
        studyError.textContent = 'If playback is blocked, press Play in the video. The owner must allow embedding.';
      } else {
        studyNative.hidden = false; studyNative.src = source.url;
        studyNative.play().catch(() => { studyError.textContent = 'Press Play to start the video, or select another source if unavailable.'; });
      }
    } catch (err) { studyError.textContent = err.message; }
  }
  function toggleStudyPlayback() {
    if (!studyNative.hidden) {
      if (studyNative.paused) studyNative.play().catch(() => { studyError.textContent = 'Video unavailable. Please choose another source.'; });
      else studyNative.pause();
    } else if (youtubeOrigin) {
      bgVideoIframe.contentWindow.postMessage(JSON.stringify({event:'command',func:studyPlaying ? 'pauseVideo' : 'playVideo',args:[]}), youtubeOrigin);
      studyPlaying = !studyPlaying; setPlayState(studyPlaying);
    }
  }
  document.getElementById('studyVideoPlay')?.addEventListener('click', toggleStudyPlayback);
  studyNative?.addEventListener('play', () => { studyPlaying = true; setPlayState(true); });
  studyNative?.addEventListener('pause', () => { studyPlaying = false; setPlayState(false); });
  studyNative?.addEventListener('ended', () => { studyPlaying = false; setPlayState(false); });
  studyNative?.addEventListener('error', () => { if (studyNative.getAttribute('src')) studyError.textContent = 'This video could not be played. Check the URL or select another video.'; });
  bgVideoIframe?.addEventListener('load', () => {
    if (!youtubeOrigin) return;
    bgVideoIframe.contentWindow.postMessage(JSON.stringify({event:'listening',id:'focusflow-study'}), youtubeOrigin);
    for (const name of ['onStateChange', 'onError']) bgVideoIframe.contentWindow.postMessage(JSON.stringify({event:'command',func:'addEventListener',args:[name]}), youtubeOrigin);
  });
  window.addEventListener('message', event => {
    if (!youtubeOrigin || event.origin !== youtubeOrigin || event.source !== bgVideoIframe.contentWindow) return;
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      const state = data.event === 'onStateChange' ? data.info : data.info?.playerState;
      if (typeof state === 'number') { studyPlaying = state === 1; setPlayState(studyPlaying); }
      if (data.event === 'onError') studyError.textContent = 'YouTube cannot play this video here. Choose another video or check embedding permissions.';
    } catch {}
  });

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
      closeStudyVideo();
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
  // ADHD Focus Task List Sidebar (Add, Complete, Edit, Delete, Filter)
  // =========================================================================
  const taskForm = document.getElementById('taskForm');
  const taskInput = document.getElementById('taskInput');
  const tasksList = document.getElementById('tasksList');
  const tasksCounter = document.getElementById('tasksCounter');
  const clearCompletedBtn = document.getElementById('clearCompletedBtn');
  const taskFilterBtns = document.querySelectorAll('.task-filter-btn');

  const TASKS_STORAGE_KEY = 'focusflow-tasks';
  let currentFilter = 'all';

  let tasks = [];
  try {
    const raw = localStorage.getItem(TASKS_STORAGE_KEY);
    if (raw) {
      tasks = JSON.parse(raw);
    } else {
      tasks = [
        { id: 1, text: 'Review priority chapter or notes', completed: false },
        { id: 2, text: 'Complete 1 focused Pomodoro interval', completed: false }
      ];
      saveTasks();
    }
  } catch (e) {
    tasks = [];
  }

  function saveTasks() {
    try {
      localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
    } catch (e) {}
    renderTasks();
  }

  function renderTasks() {
    if (!tasksList) return;

    const completedCount = tasks.filter(t => t.completed).length;
    const totalCount = tasks.length;
    if (tasksCounter) {
      tasksCounter.textContent = `${completedCount}/${totalCount}`;
    }

    const filteredTasks = tasks.filter(task => {
      if (currentFilter === 'active') return !task.completed;
      if (currentFilter === 'completed') return task.completed;
      return true;
    });

    tasksList.innerHTML = '';

    if (filteredTasks.length === 0) {
      const emptyLi = document.createElement('li');
      emptyLi.className = 'tasks-empty';
      let emptyMsg = 'No focus tasks yet.<br>Add one goal for this session!';
      if (currentFilter === 'active' && totalCount > 0) {
        emptyMsg = 'All tasks completed! 🎉<br>Take a break or add a new goal.';
      } else if (currentFilter === 'completed' && totalCount > 0) {
        emptyMsg = 'No completed tasks in this view.';
      }
      emptyLi.innerHTML = `
        <i class="fa-regular fa-circle-check"></i>
        <span>${emptyMsg}</span>
      `;
      tasksList.appendChild(emptyLi);
      return;
    }

    filteredTasks.forEach(task => {
      const li = document.createElement('li');
      li.className = `task-item ${task.completed ? 'completed' : ''}`;
      li.dataset.id = task.id;

      const checkBtn = document.createElement('button');
      checkBtn.type = 'button';
      checkBtn.className = 'task-checkbox-btn';
      checkBtn.title = task.completed ? 'Mark incomplete' : 'Mark complete';
      checkBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
      checkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleTask(task.id);
      });

      const textSpan = document.createElement('span');
      textSpan.className = 'task-text';
      textSpan.textContent = task.text;
      textSpan.title = 'Click to toggle';
      textSpan.addEventListener('click', () => toggleTask(task.id));

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'task-actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'task-action-btn btn-edit';
      editBtn.title = 'Edit task';
      editBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        startEditingTask(li, task);
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'task-action-btn btn-delete';
      deleteBtn.title = 'Delete task';
      deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteTask(task.id);
      });

      actionsDiv.appendChild(editBtn);
      actionsDiv.appendChild(deleteBtn);

      li.appendChild(checkBtn);
      li.appendChild(textSpan);
      li.appendChild(actionsDiv);

      tasksList.appendChild(li);
    });
  }

  function addTask(text) {
    const cleanText = text.trim();
    if (!cleanText) return;
    tasks.unshift({
      id: Date.now(),
      text: cleanText,
      completed: false
    });
    saveTasks();
  }

  function toggleTask(id) {
    const target = tasks.find(t => t.id === id);
    if (target) {
      target.completed = !target.completed;
      saveTasks();
    }
  }

  function deleteTask(id) {
    tasks = tasks.filter(t => t.id !== id);
    saveTasks();
  }

  function startEditingTask(li, task) {
    const textSpan = li.querySelector('.task-text');
    const actionsDiv = li.querySelector('.task-actions');
    if (!textSpan) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'task-edit-input';
    input.value = task.text;
    input.maxLength = 90;

    function finishEdit(save) {
      if (save) {
        const val = input.value.trim();
        if (val && val !== task.text) {
          task.text = val;
          saveTasks();
          return;
        }
      }
      renderTasks();
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finishEdit(true);
      } else if (e.key === 'Escape') {
        finishEdit(false);
      }
    });

    input.addEventListener('blur', () => {
      finishEdit(true);
    });

    li.replaceChild(input, textSpan);
    if (actionsDiv) actionsDiv.style.display = 'none';
    input.focus();
    input.select();
  }

  if (taskForm && taskInput) {
    taskForm.addEventListener('submit', (e) => {
      e.preventDefault();
      addTask(taskInput.value);
      taskInput.value = '';
    });
  }

  if (clearCompletedBtn) {
    clearCompletedBtn.addEventListener('click', () => {
      const initialLen = tasks.length;
      tasks = tasks.filter(t => !t.completed);
      if (tasks.length !== initialLen) {
        saveTasks();
      }
    });
  }

  taskFilterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      taskFilterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter || 'all';
      renderTasks();
    });
  });

  renderTasks();

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
  // AI Coach Generator (Powered by Google Gemini: gemini-flash-lite-latest)
  // Designed for minimal credit/token usage with concise high-impact responses
  // =========================================================================
  // AI Coach Generator (Google Gemini API)
  // Direct, versatile answers (essays, study help, explanations, questions)
  // Scrollable chat window with message history
  // =========================================================================
  const GEMINI_API_KEY = "AQ.Ab8RN6K_Rk2hEXvS2rWsjsZTDeiryPe9dR2-tpIsLVmJebxTnQ";
  const GEMINI_MODEL = "gemini-flash-lite-latest";

  const aiAdviceEl = document.getElementById('aiAdvice');
  const getTipBtn = document.getElementById('getTipBtn');
  const getPlanBtn = document.getElementById('getPlanBtn');
  const getMotivationBtn = document.getElementById('getMotivationBtn');
  const clearChatBtn = document.getElementById('clearChatBtn');
  const aiChatForm = document.getElementById('aiChatForm');
  const aiUserInput = document.getElementById('aiUserInput');
  const aiSendBtn = document.getElementById('aiSendBtn');

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatMarkdown(text) {
    if (!text) return '';
    let formatted = escapeHtml(text);
    // Bold: **text**
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Italic: *text*
    formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');
    // Code inline: `text`
    formatted = formatted.replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.1);padding:2px 5px;border-radius:4px;font-size:0.88em;">$1</code>');
    // Line breaks
    formatted = formatted.replace(/\n/g, '<br>');
    return formatted;
  }

  function resetChatWindow() {
    if (!aiAdviceEl) return;
    aiAdviceEl.innerHTML = `
      <div class="ai-msg ai-msg-bot">
        <div class="ai-msg-bot-label"><i class="fa-solid fa-robot"></i> FocusBot</div>
        <div>Welcome! I'm FocusBot, your AI study partner. You can ask me anything—from writing essays, solving problems, explaining concepts, to focus tips and study plans. What are we working on today?</div>
      </div>
    `;
    aiAdviceEl.scrollTop = 0;
  }

  async function askGeminiCoach(userPrompt, displayPrompt = "") {
    if (!aiAdviceEl) return;

    const actualDisplay = displayPrompt || userPrompt;

    // Append User Message to the chat window
    const userMsgDiv = document.createElement('div');
    userMsgDiv.className = 'ai-msg ai-msg-user';
    userMsgDiv.innerHTML = `
      <div class="ai-msg-user-label"><i class="fa-solid fa-user"></i> You</div>
      <div>${escapeHtml(actualDisplay)}</div>
    `;
    aiAdviceEl.appendChild(userMsgDiv);

    // Append Thinking placeholder
    const botMsgDiv = document.createElement('div');
    botMsgDiv.className = 'ai-msg ai-msg-bot';
    botMsgDiv.innerHTML = `
      <div class="ai-msg-bot-label"><i class="fa-solid fa-robot"></i> FocusBot</div>
      <div style="display:flex;align-items:center;gap:8px;color:var(--text-muted);">
        <i class="fa-solid fa-spinner fa-spin" style="color:var(--accent-purple);"></i>
        <span>Thinking...</span>
      </div>
    `;
    aiAdviceEl.appendChild(botMsgDiv);
    aiAdviceEl.scrollTop = aiAdviceEl.scrollHeight;

    const buttons = [getTipBtn, getPlanBtn, getMotivationBtn, aiSendBtn, clearChatBtn].filter(Boolean);
    buttons.forEach(btn => btn.disabled = true);

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: "You are FocusBot, an intelligent and versatile AI study coach and assistant. Directly and thoroughly answer whatever the user asks—including writing essays, answering questions, explaining concepts, solving problems, providing study plans, or motivation. Never refuse or deflect; fulfill the user's prompt directly, clearly, and completely."
            }]
          },
          contents: [{
            parts: [{ text: userPrompt }]
          }],
          generationConfig: {
            maxOutputTokens: 1000,
            temperature: 0.7
          }
        })
      });

      if (!response.ok) {
        throw new Error(`API response status: ${response.status}`);
      }

      const result = await response.json();
      const botResponse = result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

      if (!botResponse) {
        throw new Error("Empty response from AI");
      }

      botMsgDiv.innerHTML = `
        <div class="ai-msg-bot-label"><i class="fa-solid fa-robot"></i> FocusBot</div>
        <div>${formatMarkdown(botResponse)}</div>
      `;
    } catch (err) {
      console.warn("AI Coach API error/fallback:", err);
      botMsgDiv.innerHTML = `
        <div class="ai-msg-bot-label"><i class="fa-solid fa-robot"></i> FocusBot</div>
        <div>I'm having a brief connection hitch. Here is a quick thought: Take a breath, pick one priority task, and give it 10 uninterrupted minutes. Action beats anxiety!</div>
      `;
    } finally {
      buttons.forEach(btn => btn.disabled = false);
      aiAdviceEl.scrollTop = aiAdviceEl.scrollHeight;
    }
  }

  if (aiAdviceEl) {
    if (getTipBtn) {
      getTipBtn.addEventListener('click', () => {
        askGeminiCoach("Give me 1 quick, actionable study tip for deep focus.");
      });
    }
    if (getPlanBtn) {
      getPlanBtn.addEventListener('click', () => {
        askGeminiCoach("Give me a punchy 2-hour Pomodoro study plan with focus and short break intervals.");
      });
    }
    if (getMotivationBtn) {
      getMotivationBtn.addEventListener('click', () => {
        askGeminiCoach("Give me a powerful 2-sentence motivational boost to start studying right now.");
      });
    }
    if (clearChatBtn) {
      clearChatBtn.addEventListener('click', resetChatWindow);
    }
    if (aiChatForm && aiUserInput) {
      aiChatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const userQuery = aiUserInput.value.trim();
        if (!userQuery) return;
        aiUserInput.value = '';
        askGeminiCoach(userQuery, userQuery);
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
      saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving to media library...';

      try {
        const res = await fetch('/api/media', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, type, category, url })
        });
        if (!res.ok) throw new Error('Failed to save to database');
        
        formFeedback.textContent = '✨ Successfully added to media library!';
        formFeedback.className = 'form-feedback success';
        addMediaForm.reset();
        localStorage.setItem('focusflow-media-updated', String(Date.now()));
        await loadSupabaseMedia();
      } catch (err) {
        formFeedback.textContent = `❌ Error: ${err.message}`;
        formFeedback.className = 'form-feedback error';
      } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Add to Media Library';
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
            localStorage.setItem('focusflow-media-updated', String(Date.now()));
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


  // =========================================================================
  // Timer Settings
  // =========================================================================
  const SETTINGS_KEY = 'focusflow-timer-settings';

  let timerSettings = { focus: 1500, short: 300, long: 900 };
  try { const raw = localStorage.getItem(SETTINGS_KEY); if (raw) timerSettings = JSON.parse(raw); } catch(e) {}

  function applyTimerSettings() {
    const tabs = document.querySelectorAll('.mode-tab');
    const map = [
      { secs: timerSettings.focus, label: 'Focus Session', display: `Focus (${timerSettings.focus/60}m)` },
      { secs: timerSettings.short, label: 'Short Break',   display: `Short Break (${timerSettings.short/60}m)` },
      { secs: timerSettings.long,  label: 'Long Break',    display: `Long Break (${timerSettings.long/60}m)` }
    ];
    tabs.forEach((tab, i) => { if (map[i]) { tab.dataset.time = map[i].secs; tab.dataset.label = map[i].label; tab.textContent = map[i].display; } });
    const activeTab = document.querySelector('.mode-tab.active');
    if (activeTab) {
      totalTime = parseInt(activeTab.dataset.time, 10);
      timeLeft = totalTime;
      if (timeDisplay) {
        const m = Math.floor(timeLeft/60), s = timeLeft%60;
        timeDisplay.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      }
      if (progressRing) {
        const c = 2*Math.PI*95;
        progressRing.style.strokeDasharray = `${c} ${c}`;
        progressRing.style.strokeDashoffset = 0;
      }
    }
  }

  applyTimerSettings();

  const settingsModal     = document.getElementById('timerSettingsModal');
  const timerSettingsBtn  = document.getElementById('timerSettingsBtn');
  const settingsSaveBtn   = document.getElementById('settingsSaveBtn');
  const settingsCancelBtn = document.getElementById('settingsCancelBtn');
  const settingFocusEl    = document.getElementById('settingFocus');
  const settingShortEl    = document.getElementById('settingShort');
  const settingLongEl     = document.getElementById('settingLong');
  const settingsError     = document.getElementById('settingsError');

  function openSettings() {
    settingFocusEl.value = timerSettings.focus / 60;
    settingShortEl.value = timerSettings.short / 60;
    settingLongEl.value  = timerSettings.long  / 60;
    settingsError.style.display = 'none';
    settingsModal.classList.add('open');
    settingsModal.setAttribute('aria-hidden','false');
    settingFocusEl.focus();
  }

  function closeSettings() {
    settingsModal.classList.remove('open');
    settingsModal.setAttribute('aria-hidden','true');
  }

  function saveSettings() {
    const f = parseInt(settingFocusEl.value, 10);
    const s = parseInt(settingShortEl.value, 10);
    const l = parseInt(settingLongEl.value,  10);
    if (!f||f<1||f>120||!s||s<1||s>60||!l||l<1||l>120) {
      settingsError.textContent = 'Focus: 1-120 min · Short break: 1-60 min · Long break: 1-120 min';
      settingsError.style.display = 'block'; return;
    }
    timerSettings = { focus: f*60, short: s*60, long: l*60 };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(timerSettings)); } catch(e) {}
    applyTimerSettings();
    closeSettings();
  }

  if (timerSettingsBtn)  timerSettingsBtn.addEventListener('click', openSettings);
  if (settingsSaveBtn)   settingsSaveBtn.addEventListener('click', saveSettings);
  if (settingsCancelBtn) settingsCancelBtn.addEventListener('click', closeSettings);
  if (settingsModal) {
    settingsModal.addEventListener('click', e => { if (e.target === settingsModal) closeSettings(); });
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && settingsModal && settingsModal.classList.contains('open')) closeSettings();
  });
  [settingFocusEl, settingShortEl, settingLongEl].forEach(inp => {
    if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') saveSettings(); });
  });

  // =========================================================================
  // Focus Mode
  // =========================================================================
  const focusModeToggle  = document.getElementById('focusModeToggle');
  const focusOverlay     = document.getElementById('focusOverlay');
  const exitFocusMode    = document.getElementById('exitFocusMode');
  const focusTasksToggle = document.getElementById('focusTasksToggle');
  const focusAIToggle    = document.getElementById('focusAIToggle');
  const focusContent     = document.getElementById('focusContent');

  // Original parent references for restoring
  const timerLayoutWrapper = document.querySelector('.timer-layout-wrapper');
  const timerCard   = document.querySelector('.timer-card');
  const tasksSidebar = document.getElementById('tasksSidebar');
  const aiCoach     = document.getElementById('ai-coach');

  // Placeholders to preserve DOM position when elements are moved
  const timerPlaceholder = document.createComment('timer-card-placeholder');
  const taskPlaceholder  = document.createComment('tasks-sidebar-placeholder');
  const aiPlaceholder    = document.createComment('ai-coach-placeholder');

  let focusActive    = false;
  let showTasks      = false;
  let showAI         = false;

  function enterFocusMode() {
    closeStudyVideo();
    if (focusActive) return;
    focusActive = true;
    showTasks = false;
    showAI = false;

    // Insert placeholders
    timerCard.before(timerPlaceholder);
    tasksSidebar.before(taskPlaceholder);
    aiCoach.before(aiPlaceholder);

    // Move elements into overlay content
    focusContent.appendChild(tasksSidebar);
    focusContent.appendChild(timerCard);
    focusContent.appendChild(aiCoach);

    // Reset visibility
    tasksSidebar.classList.remove('focus-visible');
    aiCoach.classList.remove('focus-visible');
    focusContent.classList.remove('has-tasks','has-ai');
    focusTasksToggle.classList.remove('panel-active');
    focusAIToggle.classList.remove('panel-active');

    focusOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    if (focusModeToggle) focusModeToggle.textContent = 'Exit Focus Mode';
  }

  function exitFocus() {
    closeStudyVideo();
    if (!focusActive) return;
    focusActive = false;

    // Restore elements to original positions
    timerPlaceholder.after(timerCard);
    taskPlaceholder.after(tasksSidebar);
    aiPlaceholder.after(aiCoach);

    // Remove placeholders
    timerPlaceholder.parentNode && timerPlaceholder.parentNode.removeChild(timerPlaceholder);
    taskPlaceholder.parentNode  && taskPlaceholder.parentNode.removeChild(taskPlaceholder);
    aiPlaceholder.parentNode    && aiPlaceholder.parentNode.removeChild(aiPlaceholder);

    // Remove focus classes
    tasksSidebar.classList.remove('focus-visible');
    aiCoach.classList.remove('focus-visible');
    focusContent.classList.remove('has-tasks','has-ai');

    focusOverlay.classList.remove('active');
    document.body.style.overflow = '';
    if (focusModeToggle) focusModeToggle.textContent = 'Enter Focus Mode';
  }

  function updateFocusPanels() {
    tasksSidebar.classList.toggle('focus-visible', showTasks);
    aiCoach.classList.toggle('focus-visible', showAI);
    focusContent.classList.toggle('has-tasks', showTasks);
    focusContent.classList.toggle('has-ai', showAI);
    focusTasksToggle.classList.toggle('panel-active', showTasks);
    focusAIToggle.classList.toggle('panel-active', showAI);
  }

  if (focusModeToggle) focusModeToggle.addEventListener('click', () => {
    focusActive ? exitFocus() : enterFocusMode();
  });
  if (exitFocusMode)    exitFocusMode.addEventListener('click', exitFocus);
  if (focusTasksToggle) focusTasksToggle.addEventListener('click', () => { showTasks = !showTasks; updateFocusPanels(); });
  if (focusAIToggle)    focusAIToggle.addEventListener('click', () => { showAI = !showAI; updateFocusPanels(); });

  // Close on Escape
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && focusActive) exitFocus(); });

  // Close on overlay backdrop click (not inner)
  if (focusOverlay) focusOverlay.addEventListener('click', (e) => { if (e.target === focusOverlay) exitFocus(); });

  window.addEventListener('storage', event => { if (event.key === 'focusflow-media-updated' && trackSelect) refreshMediaLibrary(); });
  window.addEventListener('focus', () => { if (trackSelect) refreshMediaLibrary(); });
  async function refreshMediaLibrary() {
    try {
      const response = await fetch('/api/media');
      if (!response.ok) return;
      const selected = mediaList[currentTrackIndex];
      mediaList = await response.json();
      populateDropdown(mediaList);
      const index = mediaList.findIndex(item => item.id === selected?.id);
      if (index >= 0) { currentTrackIndex = index; trackSelect.value = index; }
    } catch {}
  }
  // Initial Load
  if (trackSelect || mediaTableBody) loadSupabaseMedia();
});
