/* =========================================
   PULSE — SoundCloud Player  |  app.js
   =========================================

   Architecture:
   ┌─────────────────────────────────────────┐
   │  SCApi      — REST API calls            │
   │  SCPlayer   — Widget iframe control     │
   │  PlayerUI   — DOM updates for player   │
   │  SearchUI   — Results list rendering   │
   │  ArtistUI   — Artist panel rendering   │
   │  QueueMgr   — Track queue mgmt         │
   └─────────────────────────────────────────┘

   IMPORTANT: Replace CLIENT_ID with your own.
   To get one: open soundcloud.com in Chrome, open
   DevTools → Network tab, play any song, filter
   by "stream" and copy the client_id query param.
   ========================================= */

'use strict';

// ──────────────────────────────────────────
//  CONFIG
// ──────────────────────────────────────────
const CLIENT_ID = 'CkCiIyf14rHi27fhk7HxhPOzc85okfSJ'; // public read-only key

const SC_API = 'https://api-v2.soundcloud.com';
const SC_PROXY = 'https://api-v2.soundcloud.com';       // used as fallback hint only

// ──────────────────────────────────────────
//  DOM REFS
// ──────────────────────────────────────────
const $ = id => document.getElementById(id);

const searchInput = $('searchInput');
const searchClear = $('searchClear');
const searchSpinner = $('searchSpinner');
const tabTracks = $('tabTracks');
const tabArtists = $('tabArtists');
const resultsList = $('resultsList');
const emptyHint = $('emptyHint');

const albumArt = $('albumArt');
const artImg = $('artImg');
const artPlaceholder = $('artPlaceholder');
const songTitle = $('songTitle');
const artistLink = $('artistLink');
const currentTimeEl = $('currentTime');
const totalTimeEl = $('totalTime');
const progressFill = $('progressFill');
const progressThumb = $('progressThumb');
const progressWrap = $('progressWrap');
const volFill = $('volFill');
const volThumb = $('volThumb');
const volWrap = $('volWrap');
const volIcon = $('volIcon');
const muteBtn = $('muteBtn');
const playBtn = $('playBtn');
const prevBtn = $('prevBtn');
const nextBtn = $('nextBtn');
const shuffleBtn = $('shuffleBtn');
const repeatBtn = $('repeatBtn');
const bgArt = $('bgArt');
const visBars = $('visBars');
const toastRoot = $('toastRoot');

const artistPanel = $('artistPanel');
const artistPanelClose = $('artistPanelClose');
const artistAvatar = $('artistAvatar');
const artistAvatarPlaceholder = $('artistAvatarPlaceholder');
const artistName = $('artistName');
const artistStats = $('artistStats');
const discographyList = $('discographyList');
const discCount = $('discCount');
const discLoader = $('discLoader');

const scWidgetIframe = $('scWidget');

// ──────────────────────────────────────────
//  STATE
// ──────────────────────────────────────────
let searchMode = 'tracks';   // 'tracks' | 'artists'
let queue = [];         // array of track objects
let queueIdx = -1;
let isPlaying = false;
let isShuffle = false;
let repeatMode = 0;          // 0=off 1=all 2=one
let isMuted = false;
let volume = 0.8;
let currentTrack = null;       // SC track object currently loaded
let trackDuration = 0;
let progressDrag = false;
let volDrag = false;
let currentArtist = null;       // artist object in right panel
let widgetReady = false;
let pendingPlay = null;       // track url to play once widget ready

// ──────────────────────────────────────────
//  VISUALIZER (fake — Widget blocks real audio)
// ──────────────────────────────────────────
const NUM_BARS = 30;
for (let i = 0; i < NUM_BARS; i++) {
  const b = document.createElement('div');
  b.className = 'vis-bar';
  b.style.height = '2px';
  visBars.appendChild(b);
}
const visBarEls = visBars.querySelectorAll('.vis-bar');
let visAnimId;
let visPhase = 0;

function startVisualizer() {
  cancelAnimationFrame(visAnimId);
  (function frame() {
    visPhase += 0.06;
    for (let i = 0; i < NUM_BARS; i++) {
      const h = 6 + 20 * Math.abs(Math.sin(visPhase + i * 0.35)) * Math.abs(Math.sin(i * 0.15));
      visBarEls[i].style.height = h.toFixed(1) + 'px';
      visBarEls[i].style.opacity = (0.35 + 0.55 * (h / 26)).toFixed(2);
    }
    visAnimId = requestAnimationFrame(frame);
  })();
}

function stopVisualizer() {
  cancelAnimationFrame(visAnimId);
  visBarEls.forEach(b => { b.style.height = '2px'; b.style.opacity = '0.25'; });
}

// ──────────────────────────────────────────
//  SC REST API MODULE
// ──────────────────────────────────────────
const SCApi = {
  async get(path, params = {}) {
    params.client_id = CLIENT_ID;
    const qs = new URLSearchParams(params).toString();
    const url = `${SC_API}${path}?${qs}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`SC API ${res.status}: ${path}`);
    return res.json();
  },

  searchTracks(q, limit = 20) {
    return this.get('/tracks', { q, limit, linked_partitioning: 1 });
  },

  searchUsers(q, limit = 20) {
    return this.get('/users', { q, limit });
  },

  getUserTracks(userId, limit = 50) {
    return this.get(`/users/${userId}/tracks`, { limit });
  },

  getUser(userId) {
    return this.get(`/users/${userId}`);
  },

  resolve(url) {
    return this.get('/resolve', { url });
  },
};

// ──────────────────────────────────────────
//  SC WIDGET PLAYER MODULE
// ──────────────────────────────────────────
const SCPlayer = {
  widget: null,

  init() {
    this.widget = SC.Widget(scWidgetIframe);
    this.widget.bind(SC.Widget.Events.READY, () => {
      widgetReady = true;
      this.widget.setVolume(volume * 100);
      if (pendingPlay) {
        this.load(pendingPlay, true);
        pendingPlay = null;
      }
    });

    this.widget.bind(SC.Widget.Events.PLAY, () => {
      isPlaying = true;
      PlayerUI.setPlaying(true);
      startVisualizer();
    });

    this.widget.bind(SC.Widget.Events.PAUSE, () => {
      isPlaying = false;
      PlayerUI.setPlaying(false);
      stopVisualizer();
    });

    this.widget.bind(SC.Widget.Events.FINISH, () => {
      isPlaying = false;
      PlayerUI.setPlaying(false);
      stopVisualizer();
      QueueMgr.playNext();
    });

    this.widget.bind(SC.Widget.Events.PLAY_PROGRESS, (data) => {
      if (progressDrag) return;
      const pct = data.relativePosition || 0;
      progressFill.style.width = (pct * 100) + '%';
      progressThumb.style.left = (pct * 100) + '%';
      currentTimeEl.textContent = formatTime(data.currentPosition / 1000);
    });

    this.widget.bind(SC.Widget.Events.ERROR, (e) => {
      console.warn('Widget error', e);
      showToast('Could not stream this track');
      PlayerUI.setPlaying(false);
      stopVisualizer();
    });
  },

  load(trackUrl, autoPlay = false) {
    if (!widgetReady) {
      pendingPlay = trackUrl;
      return;
    }
    this.widget.load(trackUrl, {
      auto_play: autoPlay,
      callback: () => {
        // After load, fetch duration via getCurrentSound
        setTimeout(() => {
          this.widget.getDuration(d => {
            trackDuration = d / 1000;
            totalTimeEl.textContent = formatTime(trackDuration);
          });
        }, 800);
      },
    });
  },

  play() { if (widgetReady) this.widget.play(); },
  pause() { if (widgetReady) this.widget.pause(); },

  seekTo(frac) {
    if (!widgetReady || !trackDuration) return;
    this.widget.seekTo(frac * trackDuration * 1000);
  },

  setVolume(v) {
    volume = v;
    if (widgetReady) this.widget.setVolume(v * 100);
  },

  toggle() {
    if (isPlaying) this.pause();
    else this.play();
  },
};

// ──────────────────────────────────────────
//  QUEUE MANAGER
// ──────────────────────────────────────────
const QueueMgr = {
  setQueue(tracks, startIdx = 0) {
    queue = tracks;
    queueIdx = startIdx;
    this.loadIdx(startIdx);
  },

  loadIdx(idx) {
    if (!queue.length) return;
    queueIdx = idx;
    currentTrack = queue[idx];
    PlayerUI.loadTrack(currentTrack);
    SCPlayer.load(currentTrack.permalink_url, true);
    SearchUI.highlightActive(currentTrack.id);
    ArtistUI.highlightActive(currentTrack.id);
  },

  playNext(manual = false) {
    if (!queue.length) return;
    if (repeatMode === 2 && !manual) {
      this.loadIdx(queueIdx);
      return;
    }
    let idx;
    if (isShuffle) {
      idx = Math.floor(Math.random() * queue.length);
    } else {
      idx = queueIdx + 1;
      if (idx >= queue.length) {
        if (repeatMode === 1) idx = 0;
        else return;
      }
    }
    this.loadIdx(idx);
  },

  playPrev() {
    if (!queue.length) return;
    let idx = queueIdx - 1;
    if (idx < 0) idx = queue.length - 1;
    this.loadIdx(idx);
  },
};

// ──────────────────────────────────────────
//  PLAYER UI MODULE
// ──────────────────────────────────────────
const PlayerUI = {
  loadTrack(track) {
    songTitle.textContent = track.title;
    artistLink.textContent = track.user ? track.user.username : '—';
    artistLink.dataset.uid = track.user ? track.user.id : '';
    artistLink.dataset.name = track.user ? track.user.username : '';

    currentTimeEl.textContent = '0:00';
    totalTimeEl.textContent = track.duration ? formatTime(track.duration / 1000) : '0:00';
    progressFill.style.width = '0%';
    progressThumb.style.left = '0%';
    trackDuration = track.duration ? track.duration / 1000 : 0;

    // Art
    const art = this.getArtwork(track, 300);
    if (art) {
      artImg.src = art;
      artImg.style.display = 'block';
      artPlaceholder.style.display = 'none';
    } else {
      artImg.style.display = 'none';
      artPlaceholder.style.display = 'flex';
    }

    this.updateBgHue();
  },

  setPlaying(playing) {
    const iconPlay = playBtn.querySelector('.icon-play');
    const iconPause = playBtn.querySelector('.icon-pause');
    iconPlay.style.display = playing ? 'none' : 'block';
    iconPause.style.display = playing ? 'block' : 'none';
    if (playing) {
      albumArt.classList.add('playing');
      playBtn.classList.add('pulsing');
    } else {
      albumArt.classList.remove('playing');
      playBtn.classList.remove('pulsing');
    }
  },

  getArtwork(track, size = 200) {
    const url = track.artwork_url || (track.user && track.user.avatar_url) || null;
    if (!url) return null;
    return url.replace('large', `t${size}x${size}`);
  },

  updateBgHue() {
    const hue = (queueIdx * 53 + 200) % 360;
    const hue2 = (hue + 85) % 360;
    bgArt.style.background = `
      radial-gradient(ellipse 80% 70% at 15% 25%, hsla(${hue},80%,55%,0.18) 0%, transparent 65%),
      radial-gradient(ellipse 60% 80% at 85% 75%, hsla(${hue2},70%,55%,0.15) 0%, transparent 65%),
      radial-gradient(ellipse 50% 50% at 50% 50%, hsla(200,60%,40%,0.07) 0%, transparent 70%)
    `;
  },
};

// ──────────────────────────────────────────
//  SEARCH UI MODULE
// ──────────────────────────────────────────
const SearchUI = {
  results: [],

  setResults(items) {
    this.results = items;
    this.render();
  },

  render() {
    resultsList.innerHTML = '';
    if (!this.results.length) {
      const eh = document.createElement('div');
      eh.className = 'empty-hint';
      eh.innerHTML = `<div class="empty-hint-icon">🔍</div><p>No results found</p>`;
      resultsList.appendChild(eh);
      return;
    }

    if (searchMode === 'tracks') {
      const fragment = document.createDocumentFragment();
      this.results.forEach((track, i) => {
        fragment.appendChild(this.makeTrackCard(track, i));
      });
      resultsList.appendChild(fragment);
    } else {
      const fragment = document.createDocumentFragment();
      this.results.forEach(user => {
        fragment.appendChild(this.makeArtistCard(user));
      });
      resultsList.appendChild(fragment);
    }
  },

  makeTrackCard(track, i) {
    const li = document.createElement('div');
    li.className = 'track-card';
    li.dataset.id = track.id;

    const artUrl = track.artwork_url
      ? track.artwork_url.replace('large', 't50x50')
      : null;

    const dur = track.duration ? formatTime(track.duration / 1000) : '';
    const artistName = track.user ? escHtml(track.user.username) : '—';
    const artistId = track.user ? track.user.id : '';

    li.innerHTML = `
      <div class="track-thumb">
        ${artUrl
        ? `<img src="${artUrl}" alt="" loading="lazy" />`
        : `<div class="track-thumb-placeholder">🎵</div>`}
      </div>
      <div class="track-play-icon">
        <div class="b"></div><div class="b"></div><div class="b"></div>
      </div>
      <div class="track-card-info">
        <div class="track-card-title" title="${escHtml(track.title)}">${escHtml(track.title)}</div>
        <div class="track-card-artist">
          <button class="track-card-artist-btn" data-uid="${artistId}" data-uname="${artistName}">${artistName}</button>
        </div>
      </div>
      <span class="track-card-dur">${dur}</span>
    `;

    // Play on card click
    li.addEventListener('click', (e) => {
      if (e.target.classList.contains('track-card-artist-btn')) return;
      const tracks = this.results.filter(t => t.streamable !== false);
      const idx = tracks.indexOf(track);
      QueueMgr.setQueue(tracks, idx < 0 ? 0 : idx);
    });

    // Artist btn
    li.querySelector('.track-card-artist-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const uid = e.currentTarget.dataset.uid;
      const uname = e.currentTarget.dataset.uname;
      if (uid) ArtistUI.open(uid, uname);
    });

    return li;
  },

  makeArtistCard(user) {
    const div = document.createElement('div');
    div.className = 'artist-card';
    div.dataset.id = user.id;

    const avatarUrl = user.avatar_url
      ? user.avatar_url.replace('large', 't50x50')
      : null;

    const followers = user.followers_count != null
      ? formatNumber(user.followers_count) + ' followers'
      : '';

    div.innerHTML = `
      <div class="artist-card-avatar">
        ${avatarUrl
        ? `<img src="${avatarUrl}" alt="" loading="lazy" />`
        : '🎤'}
      </div>
      <div class="artist-card-info">
        <div class="artist-card-name">${escHtml(user.username)}</div>
        <div class="artist-card-followers">${followers}</div>
      </div>
      <span class="artist-card-arrow">›</span>
    `;

    div.addEventListener('click', () => ArtistUI.open(user.id, user.username));
    return div;
  },

  highlightActive(trackId) {
    document.querySelectorAll('.track-card').forEach(el => {
      el.classList.toggle('active', String(el.dataset.id) === String(trackId));
    });
  },

  showEmpty(msg) {
    resultsList.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'empty-hint';
    div.innerHTML = `<div class="empty-hint-icon">🎵</div><p>${msg}</p>`;
    resultsList.appendChild(div);
  },
};

// ──────────────────────────────────────────
//  ARTIST UI MODULE
// ──────────────────────────────────────────
const ArtistUI = {
  discTracks: [],
  openUserId: null,

  async open(userId, displayName) {
    this.openUserId = userId;
    artistPanel.classList.add('open');

    // Reset
    artistName.textContent = displayName || 'Loading…';
    artistStats.textContent = '';
    artistAvatar.style.display = 'none';
    artistAvatarPlaceholder.style.display = 'flex';
    discographyList.innerHTML = '';
    discCount.textContent = '';
    discLoader.style.display = 'flex';
    this.discTracks = [];

    try {
      const [user, tracks] = await Promise.all([
        SCApi.getUser(userId),
        SCApi.getUserTracks(userId, 50),
      ]);

      if (this.openUserId !== userId) return; // cancelled

      currentArtist = user;

      // Avatar
      const avatarUrl = user.avatar_url
        ? user.avatar_url.replace('large', 't200x200')
        : null;
      if (avatarUrl) {
        artistAvatar.src = avatarUrl;
        artistAvatar.style.display = 'block';
        artistAvatarPlaceholder.style.display = 'none';
      }

      artistName.textContent = user.username;
      const parts = [];
      if (user.followers_count != null) parts.push(formatNumber(user.followers_count) + ' followers');
      if (user.track_count) parts.push(user.track_count + ' tracks');
      artistStats.textContent = parts.join(' · ');

      discLoader.style.display = 'none';

      // Filter streamable
      const streamable = Array.isArray(tracks) ? tracks : [];
      this.discTracks = streamable;
      discCount.textContent = streamable.length + ' tracks';

      const frag = document.createDocumentFragment();
      streamable.forEach(track => frag.appendChild(this.makeDiscTrack(track)));
      discographyList.appendChild(frag);

    } catch (err) {
      console.error(err);
      discLoader.style.display = 'none';
      discographyList.innerHTML = '<p style="padding:16px;color:var(--text-3);font-size:.8rem;">Could not load discography.</p>';
    }
  },

  close() {
    artistPanel.classList.remove('open');
    this.openUserId = null;
  },

  makeDiscTrack(track) {
    const div = document.createElement('div');
    div.className = 'disc-track';
    div.dataset.id = track.id;

    const artUrl = track.artwork_url
      ? track.artwork_url.replace('large', 't42x42')
      : null;

    const dur = track.duration ? formatTime(track.duration / 1000) : '';

    div.innerHTML = `
      <div class="disc-track-art">
        ${artUrl
        ? `<img src="${artUrl}" alt="" loading="lazy" />`
        : `<div class="disc-track-art-placeholder">🎵</div>`}
      </div>
      <div class="disc-track-info">
        <div class="disc-track-title" title="${escHtml(track.title)}">${escHtml(track.title)}</div>
        <div class="disc-track-dur">${dur}</div>
      </div>
    `;

    div.addEventListener('click', () => {
      const idx = this.discTracks.indexOf(track);
      QueueMgr.setQueue(this.discTracks, idx < 0 ? 0 : idx);
    });

    return div;
  },

  highlightActive(trackId) {
    document.querySelectorAll('.disc-track').forEach(el => {
      el.classList.toggle('active', String(el.dataset.id) === String(trackId));
    });
  },
};

// ──────────────────────────────────────────
//  SEARCH LOGIC
// ──────────────────────────────────────────
let searchTimer;

async function doSearch(q) {
  if (!q.trim()) {
    SearchUI.showEmpty('Search for a track or artist to get started');
    emptyHint.querySelector && (emptyHint.innerHTML = `<div class="empty-hint-icon">🎵</div><p>Search for a track or<br/>artist to get started</p>`);
    return;
  }
  searchSpinner.classList.add('active');
  try {
    if (searchMode === 'tracks') {
      const data = await SCApi.searchTracks(q, 30);
      const items = Array.isArray(data) ? data : (data.collection || []);
      SearchUI.setResults(items);
    } else {
      const data = await SCApi.searchUsers(q, 20);
      const items = Array.isArray(data) ? data : (data.collection || []);
      SearchUI.setResults(items);
    }
  } catch (err) {
    console.error(err);
    showToast('Search failed — check your client_id or network');
    SearchUI.showEmpty('Search error. Please try again.');
  } finally {
    searchSpinner.classList.remove('active');
  }
}

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  searchClear.classList.toggle('visible', q.length > 0);
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => doSearch(q), 420);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { clearTimeout(searchTimer); doSearch(searchInput.value.trim()); }
  if (e.key === 'Escape') { searchInput.value = ''; searchClear.classList.remove('visible'); }
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchClear.classList.remove('visible');
  SearchUI.showEmpty('Search for a track or<br/>artist to get started');
  searchInput.focus();
});

// Tabs
[tabTracks, tabArtists].forEach(btn => {
  btn.addEventListener('click', () => {
    [tabTracks, tabArtists].forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    searchMode = btn.dataset.mode;
    const q = searchInput.value.trim();
    if (q) doSearch(q);
  });
});

// ──────────────────────────────────────────
//  PLAYER CONTROLS
// ──────────────────────────────────────────
playBtn.addEventListener('click', () => {
  if (!currentTrack) { showToast('Search for a song to play!'); return; }
  SCPlayer.toggle();
});

prevBtn.addEventListener('click', () => QueueMgr.playPrev());
nextBtn.addEventListener('click', () => QueueMgr.playNext(true));

shuffleBtn.addEventListener('click', () => {
  isShuffle = !isShuffle;
  shuffleBtn.classList.toggle('active', isShuffle);
  showToast(isShuffle ? 'Shuffle on' : 'Shuffle off');
});

const REPEAT_LABELS = ['Repeat off', 'Repeat all', 'Repeat one'];
repeatBtn.addEventListener('click', () => {
  repeatMode = (repeatMode + 1) % 3;
  repeatBtn.classList.toggle('active', repeatMode > 0);
  // Update icon for repeat-one
  if (repeatMode === 2) {
    repeatBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="17 1 21 5 17 9"></polyline>
      <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
      <polyline points="7 23 3 19 7 15"></polyline>
      <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
      <text x="9" y="14.5" font-size="5.5" fill="currentColor" stroke="none" font-weight="bold" font-family="Inter,sans-serif">1</text>
    </svg>`;
  } else {
    repeatBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="17 1 21 5 17 9"></polyline>
      <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
      <polyline points="7 23 3 19 7 15"></polyline>
      <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
    </svg>`;
  }
  showToast(REPEAT_LABELS[repeatMode]);
});

// Artist link in player
artistLink.addEventListener('click', () => {
  const uid = artistLink.dataset.uid;
  const uname = artistLink.dataset.name;
  if (uid) ArtistUI.open(uid, uname);
});

// Artist panel close
artistPanelClose.addEventListener('click', () => ArtistUI.close());

// ──────────────────────────────────────────
//  PROGRESS SLIDER
// ──────────────────────────────────────────
setupSlider(progressWrap, (frac) => {
  progressFill.style.width = (frac * 100) + '%';
  progressThumb.style.left = (frac * 100) + '%';
  currentTimeEl.textContent = formatTime(frac * trackDuration);
  SCPlayer.seekTo(frac);
}, true);

// ──────────────────────────────────────────
//  VOLUME SLIDER
// ──────────────────────────────────────────
function setVolume(frac) {
  volume = frac;
  isMuted = frac === 0;
  SCPlayer.setVolume(frac);
  volFill.style.width = (frac * 100) + '%';
  volThumb.style.left = (frac * 100) + '%';
  updateVolIcon(frac);
}

setVolume(0.8);

setupSlider(volWrap, (frac) => setVolume(frac), false);

muteBtn.addEventListener('click', () => {
  if (isMuted) {
    setVolume(volume || 0.8);
  } else {
    const prev = volume;
    setVolume(0);
    volume = prev;
  }
});

function updateVolIcon(v) {
  let path;
  if (v === 0) {
    path = `<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/>`;
  } else if (v < 0.5) {
    path = `<path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/>`;
  } else {
    path = `<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>`;
  }
  volIcon.innerHTML = path;
}

// ──────────────────────────────────────────
//  KEYBOARD SHORTCUTS
// ──────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  switch (e.code) {
    case 'Space': e.preventDefault(); playBtn.click(); break;
    case 'ArrowRight':
      if (trackDuration) {
        e.preventDefault();
        const newFrac = Math.min(1, (parseFloat(currentTimeEl.textContent.replace(':', '.')) || 0) / trackDuration + 5 / trackDuration);
        SCPlayer.seekTo(newFrac);
        progressFill.style.width = (newFrac * 100) + '%';
        progressThumb.style.left = (newFrac * 100) + '%';
      }
      break;
    case 'ArrowLeft':
      if (trackDuration) {
        e.preventDefault();
        const newFrac2 = Math.max(0, (parseFloat(currentTimeEl.textContent.replace(':', '.')) || 0) / trackDuration - 5 / trackDuration);
        SCPlayer.seekTo(newFrac2);
        progressFill.style.width = (newFrac2 * 100) + '%';
        progressThumb.style.left = (newFrac2 * 100) + '%';
      }
      break;
    case 'KeyN': QueueMgr.playNext(true); break;
    case 'KeyP': QueueMgr.playPrev(); break;
    case 'KeyM': muteBtn.click(); break;
    case 'ArrowUp': e.preventDefault(); setVolume(Math.min(1, volume + 0.1)); break;
    case 'ArrowDown': e.preventDefault(); setVolume(Math.max(0, volume - 0.1)); break;
  }
});

// ──────────────────────────────────────────
//  GENERIC SLIDER HELPER
// ──────────────────────────────────────────
function setupSlider(wrap, onChange, isProgress = false) {
  function frac(e) {
    const r = wrap.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  }
  wrap.addEventListener('mousedown', (e) => {
    if (isProgress) progressDrag = true;
    else volDrag = true;
    onChange(frac(e));
    const move = (e) => onChange(frac(e));
    const up = () => {
      progressDrag = false; volDrag = false;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
  wrap.addEventListener('click', (e) => onChange(frac(e)));
}

// ──────────────────────────────────────────
//  HELPERS
// ──────────────────────────────────────────
function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let toastTimer;
function showToast(msg, duration = 2500) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  toastRoot.appendChild(t);
  setTimeout(() => {
    t.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => t.remove(), 300);
  }, duration);
}

// ──────────────────────────────────────────
//  INIT
// ──────────────────────────────────────────
// Wait for SC Widget API to load
window.addEventListener('load', () => {
  if (typeof SC === 'undefined') {
    showToast('SoundCloud API unavailable — check your connection');
    return;
  }
  SCPlayer.init();

  // Welcome hint
  setTimeout(() => {
    showToast('🎵 Search for a song or artist to begin', 3000);
  }, 800);
});

// Show initial empty hint
resultsList.innerHTML = '';
resultsList.appendChild(emptyHint);
