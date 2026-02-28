'use strict';

/* ===============================
   CONFIG
=============================== */

const YT_API_KEY = "AIzaSyBckdlGXY7-mWtwPSETzsTlsNtHENJakAA";

/* ===============================
   STATE
=============================== */

let player;
let queue = [];
let queueIdx = -1;
let isReady = false;

/* ===============================
   DOM
=============================== */

const $ = id => document.getElementById(id);

const searchInput = $('searchInput');
const resultsList = $('resultsList');
const playBtn = $('playBtn');
const nextBtn = $('nextBtn');
const prevBtn = $('prevBtn');
const songTitle = $('songTitle');
const artistLink = $('artistLink');
const progressFill = $('progressFill');
const progressThumb = $('progressThumb');
const progressWrap = $('progressWrap');
const currentTimeEl = $('currentTime');
const totalTimeEl = $('totalTime');

/* ===============================
   YOUTUBE PLAYER INIT
=============================== */

window.onYouTubeIframeAPIReady = function () {
  player = new YT.Player('ytPlayer', {
    height: '0',
    width: '0',
    playerVars: {
      autoplay: 0,
      controls: 0,
      disablekb: 1,
      modestbranding: 1,
      rel: 0
    },
    events: {
      onReady: () => {
        isReady = true;
      },
      onStateChange: onPlayerStateChange
    }
  });
};

function onPlayerStateChange(e) {
  if (e.data === YT.PlayerState.ENDED) {
    if (player) {
      player.seekTo(0, true);  // go back to start
      player.playVideo();      // immediately play again
    }
  }
}

/* ===============================
   SEARCH
=============================== */

searchInput.addEventListener("keydown", async e => {
  if (e.key !== "Enter") return;

  const q = searchInput.value.trim();
  if (!q) return;

  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=20&q=${encodeURIComponent(q)}&key=${YT_API_KEY}`
  );

  const data = await res.json();
  queue = data.items;
  renderResults(queue);
});

function renderResults(videos) {
  resultsList.innerHTML = "";

  videos.forEach((vid, i) => {

    const div = document.createElement("div");
    div.className = "track-card";

    div.innerHTML = `
      <div class="track-thumb">
        <img src="${vid.snippet.thumbnails.medium.url}" />
      </div>
      <div class="track-card-info">
        <div class="track-card-title">${vid.snippet.title}</div>
        <div class="track-card-artist">${vid.snippet.channelTitle}</div>
      </div>
    `;

    div.addEventListener("click", () => {
      queueIdx = i;
      loadVideo(queue[queueIdx]);
    });

    resultsList.appendChild(div);
  });
}

/* ===============================
   PLAYER CONTROL
=============================== */

function loadVideo(video) {
  if (!isReady) return;

  const videoId = video.id.videoId;

  songTitle.textContent = video.snippet.title;
  artistLink.textContent = video.snippet.channelTitle;

  player.loadVideoById(videoId);

  startProgressUpdater();
}

playBtn.addEventListener("click", () => {
  if (!player) return;

  const state = player.getPlayerState();

  if (state === YT.PlayerState.PLAYING) {
    player.pauseVideo();
  } else {
    player.playVideo();
  }
});

nextBtn.addEventListener("click", playNext);
prevBtn.addEventListener("click", playPrev);

function playNext() {
  if (!queue.length) return;
  queueIdx++;
  if (queueIdx >= queue.length) queueIdx = 0;
  loadVideo(queue[queueIdx]);
}

function playPrev() {
  if (!queue.length) return;
  queueIdx--;
  if (queueIdx < 0) queueIdx = queue.length - 1;
  loadVideo(queue[queueIdx]);
}

/* ===============================
   PROGRESS BAR
=============================== */

let progressInterval;

function startProgressUpdater() {

  clearInterval(progressInterval);

  progressInterval = setInterval(() => {

    if (!player || player.getDuration() === 0) return;

    const current = player.getCurrentTime();
    const duration = player.getDuration();
    const frac = current / duration;

    progressFill.style.width = (frac * 100) + "%";
    progressThumb.style.left = (frac * 100) + "%";

    currentTimeEl.textContent = formatTime(current);
    totalTimeEl.textContent = formatTime(duration);

  }, 500);
}

progressWrap.addEventListener("click", e => {
  if (!player) return;

  const rect = progressWrap.getBoundingClientRect();
  const frac = (e.clientX - rect.left) / rect.width;
  const seekTo = frac * player.getDuration();
  player.seekTo(seekTo, true);
});

/* ===============================
   HELPERS
=============================== */

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2,'0')}`;
}