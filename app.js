/* --------------------------------------------------
   STUDY MOMENTUM TRACKER CONTROL ENGINE (app.js)
   Supabase Cloud Integrations & Local Simulation Fallbacks
-------------------------------------------------- */

// State Management
const STATE = {
  sessions: [],
  xp: 0,
  level: 1,
  
  // Supabase/Auth State
  isSupabaseEnabled: false,
  currentUser: null
};

// Global Supabase Client Pointer
let supabaseClient = null;

// Common Subjects for autocomplete suggestions
const SUGGESTED_SUBJECTS = [
  "Mathematics",
  "Physics",
  "Chemistry",
  "Organic Chemistry",
  "Inorganic Chemistry",
  "Physical Chemistry",
  "Programming (JavaScript)",
  "Programming (Python)",
  "Biology",
  "English Literature",
  "World History",
  "Economics",
  "Data Structures & Algorithms"
];

// LocalStorage Keys
const STORAGE_KEYS = {
  SESSIONS: "momentum_sessions",
  XP: "momentum_xp"
};

// Date helper: Get YYYY-MM-DD in local time
function getLocalDateString(dateObj = new Date()) {
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Format date for display: "May 23, 2026"
function formatDisplayDate(dateStr) {
  const [year, month, day] = dateStr.split('-');
  const dateObj = new Date(year, month - 1, day);
  return dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Format weekday: "Mon", "Tue", etc.
function getWeekdayShort(dateStr) {
  const [year, month, day] = dateStr.split('-');
  const dateObj = new Date(year, month - 1, day);
  return dateObj.toLocaleDateString('en-US', { weekday: 'short' });
}

function parseTopics(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];

  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
  } catch (err) {
    // Plain comma-separated topic strings are expected in older local caches.
  }

  return trimmed.split(',').map(topic => topic.trim()).filter(Boolean);
}

function normalizeSession(session) {
  return {
    ...session,
    hours: parseFloat(session.hours) || 0,
    topics: parseTopics(session.topics),
    timestamp: parseInt(session.timestamp, 10) || Date.now()
  };
}

function activateAllFeatures() {
  return true;
}

// Generate Mock Data on First Load to display visual momentum
function seedInitialData() {
  const seeded = localStorage.getItem("momentum_seeded");
  if (seeded) return;

  const today = new Date();
  const mockSessions = [];
  
  // Create history for past 5 consecutive days to establish a streak
  const mockDetails = [
    { sub: "Organic Chemistry", hours: 2.0, mood: "productive", topics: "Stereochemistry, Enantiomers" },
    { sub: "Mathematics", hours: 1.5, mood: "neutral", topics: "Integration by parts" },
    { sub: "Physics", hours: 2.5, mood: "productive", topics: "Electrostatics, Gauss Law" },
    { sub: "Programming (Python)", hours: 1.0, mood: "neutral", topics: "List comprehensions, Lambda functions" },
    { sub: "Physical Chemistry", hours: 3.0, mood: "tired", topics: "Thermodynamics, Entropy" },
    { sub: "Biology", hours: 1.2, mood: "distracted", topics: "Cell division, Mitosis" }
  ];

  for (let i = 4; i >= 1; i--) {
    const prevDate = new Date();
    prevDate.setDate(today.getDate() - i);
    const dateStr = getLocalDateString(prevDate);
    
    const detailIndex = (4 - i) % mockDetails.length;
    const detail = mockDetails[detailIndex];
    
    mockSessions.push({
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 9),
      date: dateStr,
      subject: detail.sub,
      hours: detail.hours,
      mood: detail.mood,
      topics: parseTopics(detail.topics),
      timestamp: prevDate.getTime()
    });

    if (i === 3) {
      mockSessions.push({
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 9),
        date: dateStr,
        subject: "Mathematics",
        hours: 1.0,
        mood: "productive",
        topics: ["Matrices", "Determinants"],
        timestamp: prevDate.getTime() + 10000000
      });
    }
  }

  localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(mockSessions));
  
  let totalXP = 0;
  mockSessions.forEach(s => {
    let multiplier = 1.0;
    if (s.mood === "productive") multiplier = 1.2;
    if (s.mood === "tired") multiplier = 0.8;
    if (s.mood === "distracted") multiplier = 0.5;
    totalXP += Math.round(s.hours * 10 * multiplier);
  });
  localStorage.setItem(STORAGE_KEYS.XP, totalXP);
  
  localStorage.setItem("momentum_seeded", "true");
}

// Load Data from LocalStorage (Offline Cache)
function loadState() {
  const storedSessions = localStorage.getItem(STORAGE_KEYS.SESSIONS);
  STATE.sessions = storedSessions ? JSON.parse(storedSessions).map(normalizeSession) : [];
  
  const storedXP = localStorage.getItem(STORAGE_KEYS.XP);
  STATE.xp = storedXP ? parseInt(storedXP, 10) : 0;
  
  activateAllFeatures();
}

// Save Data to LocalStorage (Offline Cache)
function saveSessions() {
  localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(STATE.sessions));
}

function saveXP() {
  localStorage.setItem(STORAGE_KEYS.XP, STATE.xp);
}

/* --------------------------------------------------
   SUPABASE INITIALIZATION & SYNC LOGIC
-------------------------------------------------- */

function initSupabase() {
  // Gracefully handle const declarations at top-level of config.js (which don't bind to window)
  const config = (typeof SUPABASE_CONFIG !== 'undefined' ? SUPABASE_CONFIG : null) || window.SUPABASE_CONFIG || {};
  if (typeof supabase !== 'undefined' && config.URL && config.ANON_KEY) {
    try {
      supabaseClient = supabase.createClient(config.URL, config.ANON_KEY);
      STATE.isSupabaseEnabled = true;
      console.log("[Supabase] Live client initialized successfully.");
    } catch (err) {
      console.error("[Supabase] Failed to initialize live client:", err);
      STATE.isSupabaseEnabled = false;
    }
  } else {
    STATE.isSupabaseEnabled = false;
    console.log("[Supabase] Running in Simulated Backend Mode.");
  }
}

// Merge local sessions cache and cloud sessions
function mergeSessions(localSess, cloudSess) {
  const merged = [...localSess];
  cloudSess.forEach(c => {
    if (!merged.some(l => l.id === c.id)) {
      merged.push(c);
    }
  });
  return merged;
}

// Synchronize offline cache database records to Supabase / Simulated Cloud
async function syncLocalToCloud() {
  if (!STATE.currentUser) return;
  
  showToast("Syncing data to cloud... 🔄");
  updateSyncStatusText("Syncing...");
  
  try {
    const userId = STATE.currentUser.id;
    
    if (STATE.isSupabaseEnabled) {
      // 1. Upsert profile stats (non-blocking)
      try {
        const { error: profileError } = await supabaseClient
          .from('profiles')
          .upsert({
            id: userId,
            xp: STATE.xp
          });
        if (profileError) {
          console.error("[Supabase] Profile upsert failed:", profileError);
        }
      } catch (profileErr) {
        console.error("[Supabase] Profile upsert exception:", profileErr);
      }
      
      // 2. Upsert Session Records
      if (STATE.sessions.length > 0) {
        const dbSessions = STATE.sessions.map(s => ({
          id: s.id,
          user_id: userId,
          date: s.date,
          subject: s.subject,
          hours: s.hours,
          mood: s.mood,
          topics: s.topics, 
          timestamp: s.timestamp
        }));
        
        const { error: sessionsError } = await supabaseClient
          .from('sessions')
          .upsert(dbSessions);
        if (sessionsError) throw sessionsError;
      }
    } else {
      // Simulated cloud sync in localStorage
      localStorage.setItem(`mock_cloud_sessions_${userId}`, JSON.stringify(STATE.sessions));
      const existingProfile = JSON.parse(localStorage.getItem(`mock_cloud_profile_${userId}`) || '{}');
      localStorage.setItem(`mock_cloud_profile_${userId}`, JSON.stringify({ ...existingProfile, xp: STATE.xp }));
      await new Promise(resolve => setTimeout(resolve, 800)); // simulate short latency
    }
    
    showToast("Cloud sync complete! ✅");
    updateSyncStatusText("Synced");
    updateAuthUI();
  } catch (err) {
    console.error("Cloud sync failed:", err);
    showToast(`Sync failed: ${err.message || err.details || err} ❌`);
    updateSyncStatusText("Sync Error");
  }
}

// Download cloud database records and update local cache
async function fetchCloudData() {
  if (!STATE.currentUser) return;
  
  updateSyncStatusText("Syncing...");
  
  try {
    const userId = STATE.currentUser.id;
    
    if (STATE.isSupabaseEnabled) {
      // 1. Fetch Profile (non-blocking)
      try {
        const { data: profile, error: profileError } = await supabaseClient
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle();
        
        if (profileError) {
          console.error("[Supabase] Profile select failed:", profileError);
        } else if (profile) {
          STATE.xp = profile.xp;
          saveXP();
        } else {
          const { error: createProfileError } = await supabaseClient
            .from('profiles')
            .upsert({ id: userId, xp: STATE.xp });
          if (createProfileError) {
            console.error("[Supabase] Profile create failed:", createProfileError);
          }
        }
      } catch (profileErr) {
        console.error("[Supabase] Profile fetch exception:", profileErr);
      }
      
      // 2. Fetch Sessions
      const { data: sessions, error: sessionsError } = await supabaseClient
        .from('sessions')
        .select('*')
        .eq('user_id', userId);
      if (sessionsError) throw sessionsError;
      
      if (sessions) {
        const cloudSessions = sessions.map(db => normalizeSession({
          id: db.id,
          date: db.date,
          subject: db.subject,
          hours: db.hours,
          mood: db.mood,
          topics: db.topics,
          timestamp: db.timestamp
        }));
        // Merge instead of blind overwrite to protect local offline logs
        STATE.sessions = mergeSessions(STATE.sessions, cloudSessions);
        saveSessions();
      }
    } else {
      // Simulated fetch from LocalStorage mock databases
      const cachedProfileStr = localStorage.getItem(`mock_cloud_profile_${userId}`);
      if (cachedProfileStr) {
        const profile = JSON.parse(cachedProfileStr);
        STATE.xp = profile.xp;
        saveXP();
      }
      
      const cachedSessionsStr = localStorage.getItem(`mock_cloud_sessions_${userId}`);
      if (cachedSessionsStr) {
        const cloudSessions = JSON.parse(cachedSessionsStr).map(normalizeSession);
        STATE.sessions = mergeSessions(STATE.sessions, cloudSessions);
        saveSessions();
      }
    }
    
    updateSyncStatusText("Synced");
    updateAuthUI();
  } catch (err) {
    console.error("Cloud fetch failed:", err);
    showToast(`Fetch failed: ${err.message || err.details || err} ❌`);
    updateSyncStatusText("Sync Error");
  }
}

// Handle login success tasks
async function handleLoginSuccess(user) {
  STATE.currentUser = user;
  updateAuthUI();
  
  // Cache current offline achievements
  const offlineSessions = [...STATE.sessions];
  const offlineXP = STATE.xp;
  // Download existing user cloud data
  await fetchCloudData();
  
  // Merge Offline Data with Cloud Data (prevent progress loss)
  STATE.sessions = mergeSessions(offlineSessions, STATE.sessions);
  STATE.xp = Math.max(offlineXP, STATE.xp);
  
  // Save unified merge state locally & upload to cloud
  saveSessions();
  saveXP();
  activateAllFeatures();
  
  await syncLocalToCloud();
  renderDashboard();
  
  showToast(`Logged in as: ${user.email} 👋`);
}

// Delete session on the cloud
async function deleteCloudSession(id) {
  if (!STATE.currentUser) return;
  try {
    if (STATE.isSupabaseEnabled) {
      const { error } = await supabaseClient
        .from('sessions')
        .delete()
        .eq('id', id);
      if (error) throw error;

      // Upsert profile (non-blocking)
      try {
        const { error: profileError } = await supabaseClient
          .from('profiles')
          .upsert({
            id: STATE.currentUser.id,
            xp: STATE.xp
          });
        if (profileError) {
          console.error("[Supabase] Profile delete sync failed:", profileError);
        }
      } catch (profileErr) {
        console.error("[Supabase] Profile delete sync exception:", profileErr);
      }
    } else {
      const userId = STATE.currentUser.id;
      let mockSessions = JSON.parse(localStorage.getItem(`mock_cloud_sessions_${userId}`) || '[]');
      mockSessions = mockSessions.filter(s => s.id !== id);
      localStorage.setItem(`mock_cloud_sessions_${userId}`, JSON.stringify(mockSessions));
      const existingProfile = JSON.parse(localStorage.getItem(`mock_cloud_profile_${userId}`) || '{}');
      localStorage.setItem(`mock_cloud_profile_${userId}`, JSON.stringify({ ...existingProfile, xp: STATE.xp }));
    }
    updateSyncStatusText("Synced");
  } catch (err) {
    console.error("Cloud delete failed:", err);
    showToast(`Delete failed: ${err.message || err.details || err} ❌`);
    updateSyncStatusText("Sync Error");
  }
}

/* --------------------------------------------------
   AUTHENTICATION API ACTIONS
-------------------------------------------------- */

async function signUpUser(email, password) {
  if (STATE.isSupabaseEnabled) {
    const { data, error } = await supabaseClient.auth.signUp({ email, password });
    if (error) throw error;
    
    // Create initial user profile row
    const user = data.user;
    if (user) {
      const { error: profileError } = await supabaseClient
        .from('profiles')
        .upsert({
          id: user.id,
          xp: STATE.xp
        });
      if (profileError) console.error("Error creating database profile:", profileError);
    }
    return data;
  } else {
    // Simulated sign-up flow
    let mockUsers = JSON.parse(localStorage.getItem('mock_users') || '[]');
    if (mockUsers.some(u => u.email === email)) {
      throw new Error("A user with this email already exists.");
    }
    const newUser = { id: Math.random().toString(36).substring(2, 9), email, password };
    mockUsers.push(newUser);
    localStorage.setItem('mock_users', JSON.stringify(mockUsers));
    return { user: newUser };
  }
}

async function signInUser(email, password) {
  if (STATE.isSupabaseEnabled) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  } else {
    // Simulated login flow
    let mockUsers = JSON.parse(localStorage.getItem('mock_users') || '[]');
    const user = mockUsers.find(u => u.email === email && u.password === password);
    if (!user) {
      throw new Error("Invalid email or password credentials.");
    }
    return { user };
  }
}

async function signOutUser() {
  try {
    if (STATE.isSupabaseEnabled) {
      const { error } = await supabaseClient.auth.signOut();
      if (error) throw error;
    } else {
      localStorage.removeItem('mock_current_user');
    }
    
    // Reset local auth session state
    STATE.currentUser = null;
    updateAuthUI();
    showToast("Logged out successfully. 🚪");
    
    // Reload local cache data to clear user cloud values
    loadState();
    renderDashboard();
  } catch (err) {
    console.error("Sign out failed:", err);
    showToast("Logout failed. ❌");
  }
}

/* --------------------------------------------------
   STREAK & XP PROGRESSION COMPUTATIONS
-------------------------------------------------- */

// Calculate Streak Counter (consecutive days with study hours > 0)
function calculateStreak() {
  if (STATE.sessions.length === 0) return 0;
  
  const activeDates = new Set();
  const dailyHours = {};
  
  STATE.sessions.forEach(s => {
    dailyHours[s.date] = (dailyHours[s.date] || 0) + s.hours;
  });
  
  for (const dateStr in dailyHours) {
    if (dailyHours[dateStr] > 0) {
      activeDates.add(dateStr);
    }
  }
  
  let streak = 0;
  let checkDate = new Date();
  let todayStr = getLocalDateString(checkDate);
  
  let yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  let yesterdayStr = getLocalDateString(yesterday);
  
  let startCheckingDate;
  if (activeDates.has(todayStr)) {
    startCheckingDate = checkDate;
  } else if (activeDates.has(yesterdayStr)) {
    startCheckingDate = yesterday;
  } else {
    return 0;
  }
  
  while (true) {
    let currentCheckStr = getLocalDateString(startCheckingDate);
    if (activeDates.has(currentCheckStr)) {
      streak++;
      startCheckingDate.setDate(startCheckingDate.getDate() - 1);
    } else {
      break;
    }
  }
  
  return streak;
}

// Add New Session
function addSession(subject, hours, mood, topics) {
  const todayStr = getLocalDateString();
  
  const topicsArray = topics
    ? topics.split(',').map(t => t.trim()).filter(t => t.length > 0)
    : [];
    
  const newSession = {
    id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 9),
    date: todayStr,
    subject: subject.trim(),
    hours: parseFloat(hours),
    mood: mood,
    topics: topicsArray,
    timestamp: Date.now()
  };
  
  STATE.sessions.push(newSession);
  saveSessions();
  
  // XP Calculations
  const previousLevel = calculateLevel(STATE.xp);
  let multiplier = 1.0;
  if (mood === "productive") multiplier = 1.2;
  if (mood === "tired") multiplier = 0.8;
  if (mood === "distracted") multiplier = 0.5;
  
  const xpEarned = Math.round(newSession.hours * 10 * multiplier);
  STATE.xp += xpEarned;
  saveXP();
  
  const newLevel = calculateLevel(STATE.xp);
  if (newLevel > previousLevel) {
    triggerLevelUpCelebration(newLevel);
  }
  
  // Sync to database if logged in
  if (STATE.currentUser) {
    syncLocalToCloud();
  }
  
  return true;
}

// Edit Existing Session
function editSession(id, subject, hours, mood, topics) {
  const sessionIndex = STATE.sessions.findIndex(s => s.id === id);
  if (sessionIndex === -1) return false;
  
  const originalSession = STATE.sessions[sessionIndex];
  
  // Adjust XP boundaries
  let oldMultiplier = 1.0;
  if (originalSession.mood === "productive") oldMultiplier = 1.2;
  if (originalSession.mood === "tired") oldMultiplier = 0.8;
  if (originalSession.mood === "distracted") oldMultiplier = 0.5;
  const oldXPEarned = Math.round(originalSession.hours * 10 * oldMultiplier);
  
  let newMultiplier = 1.0;
  if (mood === "productive") newMultiplier = 1.2;
  if (mood === "tired") newMultiplier = 0.8;
  if (mood === "distracted") newMultiplier = 0.5;
  const newXPEarned = Math.round(parseFloat(hours) * 10 * newMultiplier);
  
  STATE.xp = Math.max(0, STATE.xp - oldXPEarned + newXPEarned);
  saveXP();
  
  const topicsArray = topics
    ? topics.split(',').map(t => t.trim()).filter(t => t.length > 0)
    : [];
  
  originalSession.subject = subject.trim();
  originalSession.hours = parseFloat(hours);
  originalSession.mood = mood;
  originalSession.topics = topicsArray;
  
  saveSessions();
  
  const currentLevel = calculateLevel(STATE.xp);
  const previousLevel = calculateLevel(STATE.xp - newXPEarned + oldXPEarned);
  if (currentLevel > previousLevel) {
    triggerLevelUpCelebration(currentLevel);
  }
  
  // Sync changes to cloud
  if (STATE.currentUser) {
    syncLocalToCloud();
  }
  
  return true;
}

// Delete Session
function deleteSession(id) {
  const sessionIndex = STATE.sessions.findIndex(s => s.id === id);
  if (sessionIndex === -1) return false;
  
  const originalSession = STATE.sessions[sessionIndex];
  
  let multiplier = 1.0;
  if (originalSession.mood === "productive") multiplier = 1.2;
  if (originalSession.mood === "tired") multiplier = 0.8;
  if (originalSession.mood === "distracted") multiplier = 0.5;
  const xpLost = Math.round(originalSession.hours * 10 * multiplier);
  
  STATE.xp = Math.max(0, STATE.xp - xpLost);
  saveXP();
  
  STATE.sessions.splice(sessionIndex, 1);
  saveSessions();
  
  // Delete row from cloud
  if (STATE.currentUser) {
    deleteCloudSession(id);
  }
  
  return true;
}

function calculateLevel(xpVal) {
  return Math.floor(xpVal / 100) + 1;
}

function openDonationContact() {
  const instagramUrl = (window.DONATION_CONFIG && window.DONATION_CONFIG.INSTAGRAM_URL) || "https://www.instagram.com/iamyugank/";
  window.open(instagramUrl, "_blank", "noopener,noreferrer");
  showToast("Thanks for supporting Momentum.");
}

// Summarize metrics for calendar date
function getDailySummary(dateStr) {
  const daySessions = STATE.sessions.filter(s => s.date === dateStr);
  
  let totalHours = 0;
  const subjectHours = {};
  const moods = [];
  let aggregatedTopics = [];
  
  daySessions.forEach(s => {
    totalHours += s.hours;
    subjectHours[s.subject] = (subjectHours[s.subject] || 0) + s.hours;
    moods.push(s.mood);
    aggregatedTopics = aggregatedTopics.concat(s.topics);
  });
  
  let frequentMood = "➖";
  if (moods.length > 0) {
    const counts = {};
    let maxCount = 0;
    moods.forEach(m => {
      counts[m] = (counts[m] || 0) + 1;
      if (counts[m] > maxCount) {
        maxCount = counts[m];
        frequentMood = m;
      }
    });
  }
  
  const moodEmojiMap = {
    productive: "🚀",
    neutral: "😐",
    tired: "😴",
    distracted: "🤪"
  };
  
  return {
    totalHours: parseFloat(totalHours.toFixed(1)),
    subjects: subjectHours,
    mood: moodEmojiMap[frequentMood] || "➖",
    topics: Array.from(new Set(aggregatedTopics))
  };
}

/* --------------------------------------------------
   DASHBOARD RENDERING ENGINES
-------------------------------------------------- */

// Render Dashboard components
function renderDashboard() {
  const todayStr = getLocalDateString();
  const summary = getDailySummary(todayStr);
  
  const streak = calculateStreak();
  const streakCountNode = document.getElementById("streak-count");
  const streakBadgeNode = document.getElementById("streak-badge");
  
  streakCountNode.textContent = streak;
  if (streak > 0) {
    streakBadgeNode.classList.add("active");
  } else {
    streakBadgeNode.classList.remove("active");
  }
  
  document.getElementById("today-date-str").textContent = formatDisplayDate(todayStr);
  document.getElementById("today-total-hours").textContent = summary.totalHours.toFixed(1);
  document.getElementById("today-mood-summary").textContent = summary.mood;
  
  // Today's subjects
  const subjectsListNode = document.getElementById("today-subjects-list");
  subjectsListNode.innerHTML = "";
  
  const subjectsKeys = Object.keys(summary.subjects);
  if (subjectsKeys.length === 0) {
    subjectsListNode.innerHTML = `<li class="empty-state-list text-secondary">No subjects logged today.</li>`;
  } else {
    subjectsKeys.forEach(subj => {
      const hoursVal = summary.subjects[subj];
      subjectsListNode.innerHTML += `
        <li>
          <span class="subject-name">${escapeHTML(subj)}</span>
          <span class="subject-hours">${hoursVal.toFixed(1)} hr</span>
        </li>
      `;
    });
  }
  
  // Today's topics
  const topicsContainerNode = document.getElementById("today-topics-container");
  topicsContainerNode.innerHTML = "";
  if (summary.topics.length === 0) {
    topicsContainerNode.innerHTML = `<span class="empty-state-text text-secondary">No topics recorded.</span>`;
  } else {
    summary.topics.forEach(topic => {
      topicsContainerNode.innerHTML += `<span class="topic-tag">${escapeHTML(topic)}</span>`;
    });
  }
  
  const xpCard = document.getElementById("xp-dashboard-card");
  const analyticsCard = document.getElementById("analytics-dashboard-card");
  
  activateAllFeatures();
  
  const currentLevel = calculateLevel(STATE.xp);
  const levelXP = STATE.xp % 100;
  const progressPercent = Math.min(100, Math.max(0, levelXP));
  
  document.getElementById("user-level-badge").textContent = `Level ${currentLevel}`;
  document.getElementById("current-xp-display").textContent = `${levelXP} / 100 XP`;
  document.getElementById("xp-to-next-level").textContent = `${100 - levelXP} XP to Level ${currentLevel + 1}`;
  document.getElementById("xp-bar-fill").style.width = `${progressPercent}%`;
  
  renderProAnalytics();
  
  renderWeeklyChart();
  renderSessionsList();
}

// Generate Last 7 Days SVG bar chart
function renderWeeklyChart() {
  const chartContainer = document.getElementById("weekly-chart-container");
  chartContainer.innerHTML = "";
  
  const last7Days = [];
  const dailyTotals = {};
  
  STATE.sessions.forEach(s => {
    dailyTotals[s.date] = (dailyTotals[s.date] || 0) + s.hours;
  });
  
  for (let i = 6; i >= 0; i--) {
    const checkDate = new Date();
    checkDate.setDate(checkDate.getDate() - i);
    const dateStr = getLocalDateString(checkDate);
    last7Days.push({
      dateStr: dateStr,
      weekday: getWeekdayShort(dateStr),
      hours: dailyTotals[dateStr] || 0
    });
  }
  
  const maxHoursLogged = Math.max(...last7Days.map(d => d.hours));
  const maxScaleVal = Math.max(4, maxHoursLogged);
  
  const svgWidth = 500;
  const svgHeight = 160;
  const paddingX = 40;
  const paddingBottom = 25;
  const chartPlotHeight = svgHeight - paddingBottom;
  const chartPlotWidth = svgWidth - paddingX;
  const barWidth = 36;
  const countDays = 7;
  const gap = (chartPlotWidth - (barWidth * countDays)) / (countDays - 1);
  
  let svgContent = `<svg viewBox="0 0 ${svgWidth} ${svgHeight}" class="chart-svg">`;
  
  const gridLines = [0.25, 0.5, 0.75, 1.0];
  gridLines.forEach(ratio => {
    const val = maxScaleVal * ratio;
    const yPos = chartPlotHeight - (chartPlotHeight * ratio) + 10;
    svgContent += `
      <line x1="${paddingX}" y1="${yPos}" x2="${svgWidth}" y2="${yPos}" stroke="rgba(255,255,255,0.05)" stroke-dasharray="4" />
      <text x="5" y="${yPos + 4}" fill="#6B7280" font-size="9" font-family="Outfit" font-weight="600">${val.toFixed(1)}h</text>
    `;
  });
  
  last7Days.forEach((day, index) => {
    const barHeight = (day.hours / maxScaleVal) * (chartPlotHeight - 20);
    const xPos = paddingX + (index * (barWidth + gap)) + (gap / 2);
    const yPos = chartPlotHeight - barHeight;
    
    const fillStyle = day.hours > 0 
      ? 'fill="url(#barGradient)"' 
      : 'fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.05)" stroke-width="1"';
      
    const barRadius = 6;
    
    svgContent += `
      <g class="chart-bar-group" tabindex="0">
        <rect x="${xPos}" y="${yPos}" width="${barWidth}" height="${Math.max(4, barHeight)}" rx="${barRadius}" ry="${barRadius}" ${fillStyle} class="chart-bar-rect">
          <title>${day.hours.toFixed(1)} hours studied (${day.dateStr})</title>
        </rect>
        
        ${day.hours > 0 ? `
          <text x="${xPos + (barWidth / 2)}" y="${yPos - 6}" fill="#06B6D4" font-size="10" font-family="Outfit" font-weight="700" text-anchor="middle">
            ${day.hours.toFixed(1)}
          </text>
        ` : ''}
        
        <text x="${xPos + (barWidth / 2)}" y="${svgHeight - 6}" fill="${day.dateStr === getLocalDateString() ? '#06B6D4' : '#9CA3AF'}" font-size="11" font-family="Outfit" font-weight="700" text-anchor="middle">
          ${day.weekday}
        </text>
      </g>
    `;
  });
  
  svgContent += `
    <defs>
      <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#22D3EE" />
        <stop offset="100%" stop-color="#0891B2" />
      </linearGradient>
    </defs>
  </svg>`;
  
  chartContainer.innerHTML = svgContent;
}

// Generate analytical segment charts
function renderProAnalytics() {
  // 1. Subject Donut SVG Chart
  const pieContainer = document.getElementById("subject-pie-chart");
  pieContainer.innerHTML = "";
  
  const subTotals = {};
  let totalHours = 0;
  STATE.sessions.forEach(s => {
    subTotals[s.subject] = (subTotals[s.subject] || 0) + s.hours;
    totalHours += s.hours;
  });
  
  const subjectsList = Object.keys(subTotals).map(subj => ({
    name: subj,
    hours: subTotals[subj]
  })).sort((a,b) => b.hours - a.hours);
  
  if (totalHours === 0) {
    pieContainer.innerHTML = `<span class="small text-secondary italic">No history to analyze yet.</span>`;
  } else {
    let displaySubjects = [];
    if (subjectsList.length <= 4) {
      displaySubjects = subjectsList;
    } else {
      displaySubjects = subjectsList.slice(0, 3);
      const otherHours = subjectsList.slice(3).reduce((acc, curr) => acc + curr.hours, 0);
      displaySubjects.push({ name: "Others", hours: otherHours });
    }
    
    const width = 180;
    const height = 100;
    const radius = 32;
    const circumference = 2 * Math.PI * radius;
    const centerX = 50;
    const centerY = 50;
    
    let svgStr = `<svg width="${width}" height="${height}" style="display: flex;">`;
    svgStr += `
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="1.5" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
    `;
    
    const colors = ["#06B6D4", "#8B5CF6", "#F97316", "#10B981"];
    let cumulativePercent = 0;
    
    displaySubjects.forEach((sub, idx) => {
      const color = colors[idx % colors.length];
      const percent = sub.hours / totalHours;
      const strokeLength = circumference * percent;
      const strokeOffset = circumference - (circumference * cumulativePercent);
      
      svgStr += `
        <circle cx="${centerX}" cy="${centerY}" r="${radius}" 
          fill="none" 
          stroke="${color}" 
          stroke-width="10"
          stroke-dasharray="${strokeLength} ${circumference}"
          stroke-dashoffset="${strokeOffset}"
          transform="rotate(-90 ${centerX} ${centerY})"
          filter="url(#glow)"
        />
      `;
      cumulativePercent += percent;
    });
    
    svgStr += `<circle cx="${centerX}" cy="${centerY}" r="22" fill="#0f1424" />`;
    
    let legendY = 20;
    displaySubjects.forEach((sub, idx) => {
      const color = colors[idx % colors.length];
      const pctVal = Math.round((sub.hours / totalHours) * 100);
      
      svgStr += `
        <rect x="105" y="${legendY}" width="8" height="8" rx="2" fill="${color}" />
        <text x="118" y="${legendY + 8}" fill="#F3F4F6" font-size="8.5" font-family="Outfit" font-weight="700">
          ${escapeHTML(sub.name.length > 8 ? sub.name.substring(0, 8) + '..' : sub.name)}
        </text>
        <text x="165" y="${legendY + 8}" fill="#9CA3AF" font-size="8" font-family="Outfit" font-weight="500">
          ${pctVal}%
        </text>
      `;
      legendY += 18;
    });
    
    svgStr += `</svg>`;
    pieContainer.innerHTML = svgStr;
  }
  
  // 2. Mood Hours Correlation Mini Chart
  const moodContainer = document.getElementById("mood-bar-chart");
  moodContainer.innerHTML = "";
  
  const moodHours = { productive: 0, neutral: 0, tired: 0, distracted: 0 };
  const moodCounts = { productive: 0, neutral: 0, tired: 0, distracted: 0 };
  
  STATE.sessions.forEach(s => {
    moodHours[s.mood] = (moodHours[s.mood] || 0) + s.hours;
    moodCounts[s.mood] = (moodCounts[s.mood] || 0) + 1;
  });
  
  const moodsList = ["productive", "neutral", "tired", "distracted"];
  const moodEmojis = { productive: "🚀", neutral: "😐", tired: "😴", distracted: "🤪" };
  const moodAverages = moodsList.map(m => {
    const avg = moodCounts[m] > 0 ? (moodHours[m] / moodCounts[m]) : 0;
    return { name: m, emoji: moodEmojis[m], avg: avg };
  });
  
  const maxAvgHours = Math.max(...moodAverages.map(m => m.avg));
  const maxScale = Math.max(2, maxAvgHours);
  
  moodAverages.forEach(m => {
    const fillPercent = Math.min(100, Math.max(3, (m.avg / maxScale) * 100));
    
    moodContainer.innerHTML += `
      <div class="mood-bar-item">
        <span class="mood-bar-label" title="${m.name}">${m.emoji}</span>
        <div class="mood-bar-track">
          <div class="mood-bar-value" style="width: ${fillPercent}%; ${m.name === 'productive' ? 'background: var(--grad-cyan);' : m.name === 'tired' ? 'background: #EA580C;' : 'background: #8B5CF6;'}"></div>
        </div>
        <span class="mood-bar-hours">${m.avg.toFixed(1)}h</span>
      </div>
    `;
  });
}

// Render Recent Sessions history list
function renderSessionsList() {
  const historyList = document.getElementById("history-list");
  const emptyState = document.getElementById("history-empty-state");
  const countBadge = document.getElementById("sessions-count");
  
  historyList.innerHTML = "";
  
  const sortedSessions = [...STATE.sessions].sort((a, b) => b.timestamp - a.timestamp);
  countBadge.textContent = `${sortedSessions.length} session${sortedSessions.length === 1 ? '' : 's'}`;
  
  if (sortedSessions.length === 0) {
    emptyState.style.display = "flex";
    historyList.style.display = "none";
  } else {
    emptyState.style.display = "none";
    historyList.style.display = "flex";
    
    sortedSessions.forEach(session => {
      const moodEmojis = {
        productive: "🚀",
        neutral: "😐",
        tired: "😴",
        distracted: "🤪"
      };
      
      const emoji = moodEmojis[session.mood] || "➖";
      
      let topicsHtml = "";
      if (session.topics && session.topics.length > 0) {
        session.topics.forEach(tag => {
          topicsHtml += `<span class="topic-tag">${escapeHTML(tag)}</span>`;
        });
      } else {
        topicsHtml = `<span class="empty-state-text text-secondary small">No topics logged</span>`;
      }
      
      historyList.innerHTML += `
        <li class="history-item" data-id="${session.id}">
          <div class="history-item-top">
            <div class="history-subj-block">
              <span class="history-mood-emoji" title="Mood: ${session.mood}">${emoji}</span>
              <div>
                <span class="history-subject">${escapeHTML(session.subject)}</span>
                <div class="history-item-date">${formatDisplayDate(session.date)}</div>
              </div>
            </div>
            <span class="history-hours">${session.hours.toFixed(1)} hrs</span>
          </div>
          <div class="history-item-topics">
            ${topicsHtml}
          </div>
          <div class="history-item-actions">
            <button class="btn-action edit" onclick="handleEditClick('${session.id}')">Edit</button>
            <button class="btn-action delete" onclick="handleDeleteClick('${session.id}')">Delete</button>
          </div>
        </li>
      `;
    });
  }
}

// Level Up Celebration overlay trigger
function triggerLevelUpCelebration(newLevel) {
  document.getElementById("new-level-val").textContent = newLevel;
  const overlay = document.getElementById("level-up-celebration");
  overlay.classList.add("active");
}

function exportToCSV() {
  if (STATE.sessions.length === 0) {
    alert("No logged study data to export.");
    return;
  }
  
  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "ID,Date,Subject,Hours Studied,Mood,Topics\n";
  
  STATE.sessions.forEach(s => {
    const escapedSubject = `"${s.subject.replace(/"/g, '""')}"`;
    const escapedTopics = `"${s.topics.join(', ').replace(/"/g, '""')}"`;
    const row = [
      s.id,
      s.date,
      escapedSubject,
      s.hours,
      s.mood,
      escapedTopics
    ].join(",");
    csvContent += row + "\n";
  });
  
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `momentum_study_history_${getLocalDateString()}.csv`);
  document.body.appendChild(link);
  
  link.click();
  document.body.removeChild(link);
}

/* --------------------------------------------------
   UI METADATA AUTO-COMPLETE & INPUTS
-------------------------------------------------- */

const formSubjectInput = document.getElementById("form-subject");
const suggestionsBox = document.getElementById("subject-suggestions");

formSubjectInput.addEventListener("input", function() {
  const query = this.value.trim().toLowerCase();
  suggestionsBox.innerHTML = "";
  
  if (query.length === 0) {
    suggestionsBox.classList.remove("active");
    return;
  }
  
  const matches = SUGGESTED_SUBJECTS.filter(s => s.toLowerCase().includes(query));
  
  if (matches.length === 0) {
    suggestionsBox.classList.remove("active");
    return;
  }
  
  matches.forEach(match => {
    const item = document.createElement("div");
    item.className = "suggestion-item";
    item.textContent = match;
    item.addEventListener("click", () => {
      formSubjectInput.value = match;
      suggestionsBox.classList.remove("active");
      suggestionsBox.innerHTML = "";
    });
    suggestionsBox.appendChild(item);
  });
  
  suggestionsBox.classList.add("active");
});

document.addEventListener("click", (e) => {
  if (e.target !== formSubjectInput && e.target !== suggestionsBox) {
    suggestionsBox.classList.remove("active");
  }
});

/* --------------------------------------------------
   MODALS & EVENT INTERACTION HANDLERS
-------------------------------------------------- */

const logModal = document.getElementById("log-modal");
const donateModal = document.getElementById("donate-modal");
const authModal = document.getElementById("auth-modal");

const studyForm = document.getElementById("study-log-form");
const authForm = document.getElementById("auth-form");

// Log Entry Modal handlers
document.getElementById("btn-open-log-modal").addEventListener("click", () => {
  document.getElementById("modal-title").textContent = "Log Study Session";
  document.getElementById("edit-session-id").value = "";
  studyForm.reset();
  logModal.classList.add("active");
});

function closeLogModal() {
  logModal.classList.remove("active");
  studyForm.reset();
}
document.getElementById("btn-close-log-modal").addEventListener("click", closeLogModal);
document.getElementById("btn-cancel-log-modal").addEventListener("click", closeLogModal);

// Donate modal handlers
function closeDonateModal() {
  donateModal.classList.remove("active");
}
function openDonateModal() {
  donateModal.classList.add("active");
}
document.getElementById("btn-close-donate-modal").addEventListener("click", closeDonateModal);

document.getElementById("btn-header-donate").addEventListener("click", openDonateModal);

document.getElementById("btn-donate-contact").addEventListener("click", () => {
  openDonationContact();
});

document.getElementById("btn-close-celebration").addEventListener("click", () => {
  document.getElementById("level-up-celebration").classList.remove("active");
});

/* --------------------------------------------------
   AUTHENTICATION UI AND FORM TRIGGERS
-------------------------------------------------- */

// Auth Modal triggers
document.getElementById("btn-header-signin").addEventListener("click", () => {
  setAuthModalMode("login");
  authModal.classList.add("active");
});

function closeAuthModal() {
  authModal.classList.remove("active");
  authForm.reset();
  document.getElementById("auth-error-msg").style.display = "none";
}
document.getElementById("btn-close-auth-modal").addEventListener("click", closeAuthModal);
document.getElementById("btn-cancel-auth-modal").addEventListener("click", closeAuthModal);

// Switch Auth Modal Mode (Login vs Sign Up)
let currentAuthMode = "login";
function setAuthModalMode(mode) {
  currentAuthMode = mode;
  const tabLogin = document.getElementById("tab-login-btn");
  const tabSignup = document.getElementById("tab-signup-btn");
  const title = document.getElementById("auth-title");
  const subtitle = document.getElementById("auth-subtitle");
  const btnSubmit = document.getElementById("btn-auth-submit");
  const errorBox = document.getElementById("auth-error-msg");
  
  errorBox.style.display = "none";
  
  if (mode === "login") {
    tabLogin.classList.add("active");
    tabSignup.classList.remove("active");
    title.textContent = "Welcome Back";
    subtitle.textContent = "Sign in to sync your study logs to the cloud.";
    btnSubmit.textContent = "Log In";
  } else {
    tabLogin.classList.remove("active");
    tabSignup.classList.add("active");
    title.textContent = "Create Account";
    subtitle.textContent = "Register to save your study statistics online.";
    btnSubmit.textContent = "Sign Up";
  }
}

document.getElementById("tab-login-btn").addEventListener("click", () => setAuthModalMode("login"));
document.getElementById("tab-signup-btn").addEventListener("click", () => setAuthModalMode("signup"));

// Profile Menu toggle trigger
const profileTriggerBtn = document.getElementById("btn-profile-trigger");
const profileDropdownContent = document.getElementById("profile-dropdown-content");

profileTriggerBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  profileDropdownContent.classList.toggle("active");
});

// Close profile menu dropdown on clicking outside
document.addEventListener("click", () => {
  profileDropdownContent.classList.remove("active");
});

// Auth form submission handler
authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  const errorBox = document.getElementById("auth-error-msg");
  const btnSubmit = document.getElementById("btn-auth-submit");
  
  errorBox.style.display = "none";
  btnSubmit.disabled = true;
  btnSubmit.textContent = currentAuthMode === "login" ? "Logging in..." : "Signing up...";
  
  try {
    let result;
    if (currentAuthMode === "login") {
      result = await signInUser(email, password);
    } else {
      result = await signUpUser(email, password);
      // Automatically log in on signup success
      result = await signInUser(email, password);
    }
    
    // Save current simulated user in local storage if not live
    if (!STATE.isSupabaseEnabled && result.user) {
      localStorage.setItem('mock_current_user', JSON.stringify(result.user));
      await handleLoginSuccess(result.user);
    }
    
    closeAuthModal();
    
  } catch (err) {
    console.error("Auth action failed:", err);
    errorBox.textContent = err.message || "An authentication error occurred.";
    errorBox.style.display = "block";
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.textContent = currentAuthMode === "login" ? "Log In" : "Sign Up";
  }
});

// Log out button trigger
document.getElementById("btn-logout").addEventListener("click", signOutUser);

// Manual Sync button trigger
document.getElementById("btn-sync-now").addEventListener("click", async () => {
  if (STATE.currentUser) {
    await syncLocalToCloud();
    renderDashboard();
  }
});

// Toast notification helper
function showToast(message) {
  const toast = document.getElementById("toast-notification");
  const msgEl = document.getElementById("toast-message");
  msgEl.innerHTML = `<span>⚡</span> ${message}`;
  toast.classList.add("active");
  setTimeout(() => {
    toast.classList.remove("active");
  }, 3000);
}

// Sync UI label controls
function updateSyncStatusText(statusText) {
  const statusEl = document.getElementById("cloud-sync-status");
  statusEl.textContent = statusText;
  if (statusText === "Synced") {
    statusEl.className = "sync-status";
  } else if (statusText.includes("Error")) {
    statusEl.className = "sync-status text-danger";
  } else {
    statusEl.className = "sync-status text-secondary";
  }
}

// Synchronise Authenticated Header UI widgets
function updateAuthUI() {
  const btnSignIn = document.getElementById("btn-header-signin");
  const menuProfile = document.getElementById("user-profile-menu");
  const userEmailDisplay = document.getElementById("user-email-display");
  
  if (STATE.currentUser) {
    btnSignIn.style.display = "none";
    menuProfile.style.display = "block";
    userEmailDisplay.textContent = STATE.currentUser.email;
    updateSyncStatusText(STATE.isSupabaseEnabled ? "Synced" : "Simulated Cloud");
  } else {
    btnSignIn.style.display = "inline-flex";
    menuProfile.style.display = "none";
    updateSyncStatusText("Offline (Local)");
  }
}

// Form submission handler (Add or Edit)
studyForm.addEventListener("submit", (e) => {
  e.preventDefault();
  
  const editId = document.getElementById("edit-session-id").value;
  const subject = document.getElementById("form-subject").value;
  const hours = document.getElementById("form-hours").value;
  const mood = document.querySelector('input[name="form-mood"]:checked').value;
  const topics = document.getElementById("form-topics").value;
  
  let success = false;
  if (editId) {
    success = editSession(editId, subject, hours, mood, topics);
  } else {
    success = addSession(subject, hours, mood, topics);
  }
  
  if (success) {
    closeLogModal();
    renderDashboard();
  }
});

// CSV Export Trigger
document.getElementById("btn-export-csv").addEventListener("click", exportToCSV);

// Handle Edit Button Click in History List
window.handleEditClick = function(id) {
  const session = STATE.sessions.find(s => s.id === id);
  if (!session) return;
  
  document.getElementById("modal-title").textContent = "Edit Study Session";
  document.getElementById("edit-session-id").value = session.id;
  document.getElementById("form-subject").value = session.subject;
  document.getElementById("form-hours").value = session.hours;
  
  const moodRadio = document.querySelector(`input[name="form-mood"][value="${session.mood}"]`);
  if (moodRadio) moodRadio.checked = true;
  
  document.getElementById("form-topics").value = session.topics ? session.topics.join(", ") : "";
  
  logModal.classList.add("active");
};

// Handle Delete Button Click in History List
window.handleDeleteClick = function(id) {
  if (confirm("Are you sure you want to delete this study session? This will affect your streak and XP progress.")) {
    deleteSession(id);
    renderDashboard();
  }
};

// Helper: Escape user HTML input to prevent XSS attacks
function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

/* --------------------------------------------------
   BOOTSTRAP APPLICATION INITIALIZATION
-------------------------------------------------- */

window.addEventListener("DOMContentLoaded", async () => {
  seedInitialData();
  loadState();
  initSupabase();
  
  // Restore authentication session on startup
  if (STATE.isSupabaseEnabled) {
    try {
      // Listen to real-time Auth State Changes (handles initial session load and subsequent triggers)
      supabaseClient.auth.onAuthStateChange(async (event, session) => {
        if (session) {
          const isInitialLoad = !STATE.currentUser;
          STATE.currentUser = session.user;
          updateAuthUI();
          
          if (isInitialLoad) {
            // First time loading user session: merge local cache with cloud data to prevent loss
            const offlineSessions = [...STATE.sessions];
            const offlineXP = STATE.xp;
            
            await fetchCloudData();
            
            STATE.sessions = mergeSessions(offlineSessions, STATE.sessions);
            STATE.xp = Math.max(offlineXP, STATE.xp);
            
            saveSessions();
            saveXP();
            
            // Push merged results back to Supabase
            await syncLocalToCloud();
          } else {
            // Just regular sync/fetch on subsequent triggers
            await fetchCloudData();
          }
          renderDashboard();
        } else {
          STATE.currentUser = null;
          updateAuthUI();
          loadState();
          renderDashboard();
        }
      });
    } catch (err) {
      console.error("Auth session recovery failed:", err);
      renderDashboard();
    }
  } else {
    // Simulated auth restoration
    const savedUser = localStorage.getItem('mock_current_user');
    if (savedUser) {
      STATE.currentUser = JSON.parse(savedUser);
      updateAuthUI();
      await fetchCloudData();
    }
    renderDashboard();
  }
  
  // Register Service Worker for PWA/offline capability
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js")
        .then((reg) => console.log("[Service Worker] Registered successfully:", reg.scope))
        .catch((err) => console.error("[Service Worker] Registration failed:", err));
    });
  }
});
