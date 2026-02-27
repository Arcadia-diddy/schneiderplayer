'use strict';

/* ================================
   AUDIO ENGINE
================================ */

const audio = new Audio();
audio.crossOrigin = "anonymous";
audio.volume = 0.8;

let queue = [];
let queueIdx = -1;
let currentTrack = null;
let isShuffle = false;
let repeatMode = 0; // 0 off, 1 all, 2 one

/* ================================
   DOM
================================ */

const $ = id => document.getElementById(id);

const searchInput = $('searchInput');
const resultsList = $('resultsList');
const playBtn = $('playBtn');
const nextBtn = $('nextBtn');
const prevBtn = $('prevBtn');
const progressFill = $('progressFill');
const progressThumb = $('progressThumb');
const progressWrap = $('progressWrap');
const currentTimeEl = $('currentTime');
const totalTimeEl = $('totalTime');
const songTitle = $('songTitle');
const artistLink = $('artistLink');
const artImg = $('artImg');
const volWrap = $('volWrap');
const volFill = $('volFill');
const volThumb = $('volThumb');

/* ================================
   AUDIUS API
================================ */

const Audius = {

  host: null,

  async init() {
    const res = await fetch("https://api.audius.co");
    const data = await res.json();
    this.host = data.data[0];
  },

  async search(q) {
    const res = await fetch(
      `${this.host}/v1/tracks/search?query=${encodeURIComponent(q)}&app_name=PulsePlayer`
    );
    const data = await res.json();
    return data.data || [];
  },

  streamUrl(trackId) {
    return `${this.host}/v1/tracks/${trackId}/stream?app_name=PulsePlayer`;
  }
};

/* ================================
   SEARCH
================================ */

searchInput.addEventListener("keydown", async e => {
  if (e.key !== "Enter") return;

  const q = searchInput.value.trim();
  if (!q) return;

  const tracks = await Audius.search(q);
  renderResults(tracks);
});

function renderResults(tracks) {
  resultsList.innerHTML = "";

  tracks.forEach((track, i) => {

    const div = document.createElement("div");
    div.className = "track-card";

    div.innerHTML = `
      <div class="track-thumb">
        <img src="${track.artwork?.['150x150'] || ''}" />
      </div>
      <div class="track-card-info">
        <div class="track-card-title">${track.title}</div>
        <div class="track-card-artist">${track.user.name}</div>
      </div>
    `;

    div.addEventListener("click", () => {
      queue = tracks;
      queueIdx = i;
      loadTrack(queue[queueIdx]);
    });

    resultsList.appendChild(div);
  });
}

/* ================================
   PLAYER
================================ */

function loadTrack(track) {

  currentTrack = track;

  songTitle.textContent = track.title;
  artistLink.textContent = track.user.name;
  artImg.src = track.artwork?.['480x480'] || '';

  audio.src = Audius.streamUrl(track.id);
  audio.play();
}

playBtn.addEventListener("click", () => {
  if (!audio.src) return;
  if (audio.paused) audio.play();
  else audio.pause();
});

nextBtn.addEventListener("click", () => playNext(true));
prevBtn.addEventListener("click", playPrev);

function playNext(manual = false) {

  if (!queue.length) return;

  if (repeatMode === 2 && !manual) {
    loadTrack(queue[queueIdx]);
    return;
  }

  if (isShuffle) {
    queueIdx = Math.floor(Math.random() * queue.length);
  } else {
    queueIdx++;
    if (queueIdx >= queue.length) {
      if (repeatMode === 1) queueIdx = 0;
      else return;
    }
  }

  loadTrack(queue[queueIdx]);
}

function playPrev() {
  if (!queue.length) return;
  queueIdx--;
  if (queueIdx < 0) queueIdx = queue.length - 1;
  loadTrack(queue[queueIdx]);
}

/* ================================
   PROGRESS
================================ */

audio.addEventListener("timeupdate", () => {

  if (!audio.duration) return;

  const frac = audio.currentTime / audio.duration;

  progressFill.style.width = (frac * 100) + "%";
  progressThumb.style.left = (frac * 100) + "%";

  currentTimeEl.textContent = formatTime(audio.currentTime);
  totalTimeEl.textContent = formatTime(audio.duration);
});

audio.addEventListener("ended", () => {
  playNext();
});

progressWrap.addEventListener("click", e => {
  const rect = progressWrap.getBoundingClientRect();
  const frac = (e.clientX - rect.left) / rect.width;
  audio.currentTime = frac * audio.duration;
});

/* ================================
   VOLUME
================================ */

volWrap.addEventListener("click", e => {
  const rect = volWrap.getBoundingClientRect();
  const frac = (e.clientX - rect.left) / rect.width;
  audio.volume = frac;
  volFill.style.width = (frac * 100) + "%";
  volThumb.style.left = (frac * 100) + "%";
});

/* ================================
   HELPERS
================================ */

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2,'0')}`;
}

/* ================================
   INIT
================================ */

(async () => {
  await Audius.init();
})();