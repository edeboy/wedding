/**
 * TOBORE WEDDING JOTTER - LUXURY MAGAZINE FLIP ENGINE
 * Built on Turn.js with responsive fullscreen, smart cover spread slicing, audio synthesis, and graceful fallback.
 */

(function () {
  'use strict';

  // Configuration settings (easily customizable)
  const CONFIG = {
    // Default total pages (can be changed dynamically via settings or saved in browser)
    totalPages: parseInt(localStorage.getItem('wedding_jotter_pages') || '10', 10),
    imageFolder: 'images/',
    extensions: ['jpg', 'png', 'jpeg', 'webp', 'JPG', 'PNG', 'JPEG', 'WEBP'],
    pageRatio: 1.414, // Standard Book proportion (width * ratio = height per single page)
    soundEnabled: localStorage.getItem('wedding_jotter_sound') !== 'false',
    autoPlayInterval: 4000,
    title: 'Tobore Wedding Jotter'
  };

  let flipbook = null;
  let autoPlayTimer = null;
  let isAutoPlaying = false;
  let audioCtx = null;
  let resizeTimeout = null;

  // DOM Elements cache
  const elements = {
    stage: document.getElementById('book-stage'),
    viewport: document.getElementById('flipbook-viewport'),
    flipbook: document.getElementById('flipbook'),
    pageIndicator: document.getElementById('page-indicator'),
    scrubber: document.getElementById('page-scrubber'),
    btnPrev: document.getElementById('btn-prev'),
    btnNext: document.getElementById('btn-next'),
    sidePrev: document.getElementById('side-prev'),
    sideNext: document.getElementById('side-next'),
    btnFirst: document.getElementById('btn-first'),
    btnLast: document.getElementById('btn-last'),
    btnSound: document.getElementById('btn-sound'),
    soundIconOn: document.getElementById('sound-icon-on'),
    soundIconOff: document.getElementById('sound-icon-off'),
    btnPlay: document.getElementById('btn-play'),
    playIcon: document.getElementById('play-icon'),
    pauseIcon: document.getElementById('pause-icon'),
    btnFullscreen: document.getElementById('btn-fullscreen'),
    iconFullscreenEnter: document.getElementById('icon-fs-enter'),
    iconFullscreenExit: document.getElementById('icon-fs-exit'),
    btnThumbs: document.getElementById('btn-thumbs'),
    thumbsModal: document.getElementById('thumbs-modal'),
    thumbsGrid: document.getElementById('thumbs-grid'),
    btnCloseThumbs: document.getElementById('btn-close-thumbs'),
    btnSettings: document.getElementById('btn-settings'),
    settingsModal: document.getElementById('settings-modal'),
    btnCloseSettings: document.getElementById('btn-close-settings'),
    inputTotalPages: document.getElementById('input-total-pages'),
    btnSaveSettings: document.getElementById('btn-save-settings')
  };

  // =========================================================================
  // PAGE SOUND SYNTHESIZER (Realistic Paper Swoosh via Web Audio API)
  // =========================================================================
  function initAudio() {
    if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextClass();
    }
  }

  function playFlipSound() {
    if (!CONFIG.soundEnabled) return;
    try {
      initAudio();
      if (!audioCtx) return;
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }

      // Generate soft paper rustle noise
      const bufferSize = Math.floor(audioCtx.sampleRate * 0.18);
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = audioCtx.createBufferSource();
      noise.buffer = buffer;

      // Bandpass filter to shape like paper sliding
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1400, audioCtx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(600, audioCtx.currentTime + 0.18);
      filter.Q.setValueAtTime(2.5, audioCtx.currentTime);

      // Volume envelope
      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.01, audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.18, audioCtx.currentTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.18);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(audioCtx.destination);

      noise.start();
      noise.stop(audioCtx.currentTime + 0.18);
    } catch (e) {
      console.warn('Audio synthesis not permitted without interaction:', e);
    }
  }

  // =========================================================================
  // DYNAMIC PAGE BUILDER
  // =========================================================================
  function buildPagesDOM(totalPages) {
    const $fb = $(elements.flipbook);
    $fb.empty();

    for (let i = 1; i <= totalPages; i++) {
      const isHard = i === 1 || i === totalPages;
      const isLeft = i % 2 === 0;
      const shadowClass = isLeft ? 'page-shadow-left' : 'page-shadow-right';
      const hardClass = isHard ? 'hard' : '';

      const subtitle = i === 1
        ? 'Front Cover'
        : i === totalPages
          ? 'Back Cover'
          : `Magazine Page`;

      const pageHtml = `
        <div class="page ${hardClass}" data-page="${i}">
          <div class="page-inner">
            <!-- Photo layer with smart spread slicing support -->
            <div class="page-photo" data-index="${i}"></div>

            <!-- Luxury Wedding Fallback Layer -->
            <div class="placeholder-page" id="placeholder-${i}">
              <div class="placeholder-frame"></div>
              <div class="placeholder-header">
                <div class="placeholder-ornament">❧ ❦ ☙</div>
                <div class="placeholder-title">Tobore &amp; Beloved</div>
              </div>
              <div class="placeholder-center">
                <div class="placeholder-badge">${i}</div>
                <div class="placeholder-subtitle">${subtitle}</div>
                <div class="placeholder-hint">Add "${i}.jpg" in images/ folder</div>
              </div>
              <div class="placeholder-footer">
                A Celebration of True Love
              </div>
            </div>

            <!-- Page spine gradient shadow -->
            <div class="${shadowClass}"></div>
          </div>
        </div>
      `;

      $fb.append(pageHtml);
    }

    // Attach smart image loader
    loadPageImages(totalPages);
  }

  /**
   * Smart image loader:
   * 1. Tests for 1.jpg, 1.png, 1.jpeg, 1.webp etc.
   * 2. Detects if image is a 2-page wide spread (aspect ratio > 1.25)
   *    - If wide spread & Page 1: slices to display right half (Front Cover)
   *    - If wide spread & Last Page: slices to display left half (Back Cover)
   *    - If single page: displays fully fitted
   */
  function loadPageImages(totalPages) {
    let coverSpreadUrl = null;

    function checkPageImage(pageIndex, totalPages) {
      const photoEl = document.querySelector(`.page-photo[data-index="${pageIndex}"]`);
      const placeholderEl = document.getElementById(`placeholder-${pageIndex}`);
      if (!photoEl) return;

      let extIdx = 0;
      function tryNextExt() {
        if (extIdx >= CONFIG.extensions.length) {
          // If this is the last page (Back Cover) and no dedicated image was found,
          // check if page 1 had a wide cover spread (containing the back cover on its left half)
          if (pageIndex === totalPages && coverSpreadUrl) {
            photoEl.className = 'page-photo mode-spread-left';
            photoEl.style.backgroundImage = `url("${coverSpreadUrl}")`;
            if (placeholderEl) placeholderEl.style.display = 'none';
            updateThumbPreview(totalPages, coverSpreadUrl, true, true);
          }
          return;
        }

        const ext = CONFIG.extensions[extIdx++];
        const imgUrl = `${CONFIG.imageFolder}${pageIndex}.${ext}`;
        const testImg = new Image();

        testImg.onload = function () {
          const isWideSpread = (testImg.naturalWidth / testImg.naturalHeight) > 1.25;

          photoEl.className = 'page-photo';

          if (isWideSpread) {
            if (pageIndex === 1) {
              // Right half of jacket spread = Front Cover
              photoEl.classList.add('mode-spread-right');
              coverSpreadUrl = imgUrl;

              // Check if last page is already awaiting back cover
              const lastPhoto = document.querySelector(`.page-photo[data-index="${totalPages}"]`);
              const lastPlaceholder = document.getElementById(`placeholder-${totalPages}`);
              if (lastPhoto && !lastPhoto.style.backgroundImage) {
                lastPhoto.className = 'page-photo mode-spread-left';
                lastPhoto.style.backgroundImage = `url("${imgUrl}")`;
                if (lastPlaceholder) lastPlaceholder.style.display = 'none';
                updateThumbPreview(totalPages, imgUrl, true, true);
              }
            } else if (pageIndex === totalPages) {
              // Left half of jacket spread = Back Cover
              photoEl.classList.add('mode-spread-left');
            } else {
              // Inner spread
              if (pageIndex % 2 === 0) {
                photoEl.classList.add('mode-spread-left');
              } else {
                photoEl.classList.add('mode-spread-right');
              }
            }
          } else {
            // Standard single portrait page
            photoEl.classList.add('mode-contain');
          }

          photoEl.style.backgroundImage = `url("${imgUrl}")`;

          if (placeholderEl) {
            placeholderEl.style.display = 'none';
          }

          updateThumbPreview(pageIndex, imgUrl, isWideSpread, pageIndex === totalPages);
        };

        testImg.onerror = function () {
          tryNextExt();
        };

        testImg.src = imgUrl;
      }

      tryNextExt();
    }

    for (let i = 1; i <= totalPages; i++) {
      checkPageImage(i, totalPages);
    }
  }

  function updateThumbPreview(pageIndex, imgUrl, isWideSpread, isLeftHalf) {
    const thumbImg = document.querySelector(`.thumb-card[data-page="${pageIndex}"] .thumb-img`);
    const placeholder = document.querySelector(`.thumb-card[data-page="${pageIndex}"] .thumb-placeholder`);
    if (thumbImg) {
      thumbImg.style.backgroundImage = `url("${imgUrl}")`;
      if (isWideSpread) {
        thumbImg.style.backgroundSize = '200% 100%';
        thumbImg.style.backgroundPosition = isLeftHalf ? 'left center' : 'right center';
      } else {
        thumbImg.style.backgroundSize = 'cover';
        thumbImg.style.backgroundPosition = 'center center';
      }
      if (placeholder) placeholder.style.display = 'none';
    }
  }

  // =========================================================================
  // VIEWPORT & RESPONSIVE GEOMETRY
  // =========================================================================
  function calculateBookDimensions() {
    const stageWidth = elements.stage.clientWidth - 40;
    const stageHeight = elements.stage.clientHeight - 30;

    // Determine if single or double page display based on screen width
    const isSinglePage = window.innerWidth <= 768;

    let targetWidth, targetHeight;

    if (isSinglePage) {
      // Single page view: aspect ratio is width : height (~1 : 1.414)
      const maxH = stageHeight * 0.95;
      const maxW = stageWidth * 0.95;

      targetHeight = Math.min(maxH, maxW * CONFIG.pageRatio);
      targetWidth = targetHeight / CONFIG.pageRatio;
    } else {
      // 2-page spread view: aspect ratio is 2 * width : height (~2 : 1.414 = ~1.414 spread aspect ratio)
      const spreadRatio = 2 / CONFIG.pageRatio;
      const maxH = stageHeight * 0.94;
      const maxW = stageWidth * 0.96;

      targetWidth = Math.min(maxW, maxH * spreadRatio);
      targetHeight = targetWidth / spreadRatio;
    }

    return {
      width: Math.floor(targetWidth),
      height: Math.floor(targetHeight),
      display: isSinglePage ? 'single' : 'double'
    };
  }

  // =========================================================================
  // INITIALIZE TURN.JS
  // =========================================================================
  function initFlipbook() {
    buildPagesDOM(CONFIG.totalPages);
    buildThumbnails(CONFIG.totalPages);

    const dims = calculateBookDimensions();
    const $fb = $(elements.flipbook);

    // Initialize Turn.js
    $fb.turn({
      width: dims.width,
      height: dims.height,
      display: dims.display,
      autoCenter: true,
      elevation: 60,
      duration: 800,
      acceleration: true,
      gradients: true,
      when: {
        turning: function (event, page, view) {
          playFlipSound();
          updateUI(page, view);
        },
        turned: function (event, page, view) {
          updateUI(page, view);
        }
      }
    });

    flipbook = $fb;

    // Setup scrubber bounds
    elements.scrubber.max = CONFIG.totalPages;
    elements.scrubber.value = 1;

    updateUI(1, [1]);
  }

  // =========================================================================
  // UI & STATE UPDATES
  // =========================================================================
  function updateUI(page, view) {
    if (!view) {
      view = flipbook ? flipbook.turn('view') : [page];
    }

    // Scrubber update
    elements.scrubber.value = page;

    // Page indicator text
    let text = '';
    const total = CONFIG.totalPages;
    if (page === 1) {
      text = `Cover (Page 1 of ${total})`;
    } else if (page === total) {
      text = `Back Cover (Page ${total} of ${total})`;
    } else {
      // Spread view
      const left = view[0];
      const right = view[1];
      if (left && right) {
        text = `Pages ${left} - ${right} of ${total}`;
      } else {
        text = `Page ${page} of ${total}`;
      }
    }
    elements.pageIndicator.textContent = text;

    // Arrow states
    const isFirst = page === 1;
    const isLast = page === total;

    elements.btnPrev.disabled = isFirst;
    elements.btnNext.disabled = isLast;
    elements.btnFirst.disabled = isFirst;
    elements.btnLast.disabled = isLast;

    elements.sidePrev.classList.toggle('disabled', isFirst);
    elements.sideNext.classList.toggle('disabled', isLast);

    // Highlight active thumbnail
    document.querySelectorAll('.thumb-card').forEach(card => {
      const p = parseInt(card.dataset.page, 10);
      if (view.includes(p) || p === page) {
        card.classList.add('active');
      } else {
        card.classList.remove('active');
      }
    });
  }

  // =========================================================================
  // THUMBNAILS DRAWER
  // =========================================================================
  function buildThumbnails(totalPages) {
    elements.thumbsGrid.innerHTML = '';

    for (let i = 1; i <= totalPages; i++) {
      const card = document.createElement('div');
      card.className = 'thumb-card';
      card.dataset.page = i;

      const label = i === 1 ? 'Cover' : i === totalPages ? 'Back' : `Page ${i}`;

      card.innerHTML = `
        <div class="thumb-preview">
          <div class="thumb-img"></div>
          <span class="thumb-placeholder">${i}</span>
        </div>
        <div class="thumb-label">${label}</div>
      `;

      card.addEventListener('click', () => {
        if (flipbook) {
          flipbook.turn('page', i);
        }
        closeModals();
      });

      elements.thumbsGrid.appendChild(card);
    }
  }

  function openThumbnails() {
    elements.thumbsModal.classList.add('active');
  }

  function closeModals() {
    elements.thumbsModal.classList.remove('active');
    elements.settingsModal.classList.remove('active');
  }

  // =========================================================================
  // SLIDESHOW / AUTOPLAY
  // =========================================================================
  function toggleAutoPlay() {
    if (isAutoPlaying) {
      stopAutoPlay();
    } else {
      startAutoPlay();
    }
  }

  function startAutoPlay() {
    isAutoPlaying = true;
    elements.btnPlay.classList.add('active');
    elements.playIcon.style.display = 'none';
    elements.pauseIcon.style.display = 'block';

    autoPlayTimer = setInterval(() => {
      if (!flipbook) return;
      const curr = flipbook.turn('page');
      if (curr >= CONFIG.totalPages) {
        stopAutoPlay();
      } else {
        flipbook.turn('next');
      }
    }, CONFIG.autoPlayInterval);
  }

  function stopAutoPlay() {
    isAutoPlaying = false;
    clearInterval(autoPlayTimer);
    elements.btnPlay.classList.remove('active');
    elements.playIcon.style.display = 'block';
    elements.pauseIcon.style.display = 'none';
  }

  // =========================================================================
  // FULLSCREEN TOGGLE
  // =========================================================================
  function toggleFullScreen() {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      const docEl = document.documentElement;
      if (docEl.requestFullscreen) {
        docEl.requestFullscreen();
      } else if (docEl.webkitRequestFullscreen) {
        docEl.webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }
  }

  function updateFullscreenIcons() {
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    elements.iconFullscreenEnter.style.display = isFs ? 'none' : 'block';
    elements.iconFullscreenExit.style.display = isFs ? 'block' : 'none';
    elements.btnFullscreen.classList.toggle('active', isFs);

    // Allow browser animation to settle before resizing
    setTimeout(handleResize, 150);
  }

  // =========================================================================
  // RESIZE HANDLER
  // =========================================================================
  function handleResize() {
    if (!flipbook) return;

    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      const dims = calculateBookDimensions();

      if (flipbook.turn('display') !== dims.display) {
        flipbook.turn('display', dims.display);
      }

      flipbook.turn('size', dims.width, dims.height);
    }, 100);
  }

  // =========================================================================
  // SETTINGS & PAGE COUNT CONFIG
  // =========================================================================
  function openSettings() {
    elements.inputTotalPages.value = CONFIG.totalPages;
    elements.settingsModal.classList.add('active');
  }

  function saveSettings() {
    const newPages = parseInt(elements.inputTotalPages.value, 10);
    if (newPages && newPages >= 2 && newPages <= 200) {
      CONFIG.totalPages = newPages;
      localStorage.setItem('wedding_jotter_pages', newPages.toString());
      closeModals();

      // Destroy and rebuild flipbook with new total page count
      if (flipbook) {
        flipbook.turn('destroy');
        flipbook = null;
      }
      initFlipbook();
    } else {
      alert('Please enter a valid page number between 2 and 200.');
    }
  }

  // =========================================================================
  // EVENT LISTENERS BINDING
  // =========================================================================
  function bindEvents() {
    // Nav buttons
    elements.btnPrev.addEventListener('click', () => flipbook && flipbook.turn('previous'));
    elements.btnNext.addEventListener('click', () => flipbook && flipbook.turn('next'));
    elements.sidePrev.addEventListener('click', () => flipbook && flipbook.turn('previous'));
    elements.sideNext.addEventListener('click', () => flipbook && flipbook.turn('next'));

    elements.btnFirst.addEventListener('click', () => flipbook && flipbook.turn('page', 1));
    elements.btnLast.addEventListener('click', () => flipbook && flipbook.turn('page', CONFIG.totalPages));

    // Scrubber
    elements.scrubber.addEventListener('input', (e) => {
      const p = parseInt(e.target.value, 10);
      if (flipbook) {
        flipbook.turn('page', p);
      }
    });

    // Sound toggle
    const updateSoundUI = () => {
      if (CONFIG.soundEnabled) {
        elements.soundIconOn.style.display = 'block';
        elements.soundIconOff.style.display = 'none';
        elements.btnSound.classList.add('active');
      } else {
        elements.soundIconOn.style.display = 'none';
        elements.soundIconOff.style.display = 'block';
        elements.btnSound.classList.remove('active');
      }
    };

    updateSoundUI();
    elements.btnSound.addEventListener('click', () => {
      CONFIG.soundEnabled = !CONFIG.soundEnabled;
      localStorage.setItem('wedding_jotter_sound', CONFIG.soundEnabled);
      updateSoundUI();
      if (CONFIG.soundEnabled) {
        initAudio();
        playFlipSound();
      }
    });

    // Slideshow
    elements.btnPlay.addEventListener('click', toggleAutoPlay);

    // Fullscreen
    elements.btnFullscreen.addEventListener('click', toggleFullScreen);
    document.addEventListener('fullscreenchange', updateFullscreenIcons);
    document.addEventListener('webkitfullscreenchange', updateFullscreenIcons);

    // Thumbnails
    elements.btnThumbs.addEventListener('click', openThumbnails);
    elements.btnCloseThumbs.addEventListener('click', closeModals);
    elements.thumbsModal.addEventListener('click', (e) => {
      if (e.target === elements.thumbsModal) closeModals();
    });

    // Settings
    elements.btnSettings.addEventListener('click', openSettings);
    elements.btnCloseSettings.addEventListener('click', closeModals);
    elements.btnSaveSettings.addEventListener('click', saveSettings);
    elements.settingsModal.addEventListener('click', (e) => {
      if (e.target === elements.settingsModal) closeModals();
    });

    // Keyboard navigation
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;

      switch (e.key) {
        case 'ArrowLeft':
          if (flipbook) flipbook.turn('previous');
          break;
        case 'ArrowRight':
        case ' ':
          if (flipbook) flipbook.turn('next');
          break;
        case 'Home':
          if (flipbook) flipbook.turn('page', 1);
          break;
        case 'End':
          if (flipbook) flipbook.turn('page', CONFIG.totalPages);
          break;
        case 'f':
        case 'F':
          toggleFullScreen();
          break;
        case 'Escape':
          closeModals();
          break;
      }
    });

    // Resize
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    // Audio unlock on gesture
    const unlockAudio = () => {
      initAudio();
      document.removeEventListener('click', unlockAudio);
      document.removeEventListener('touchstart', unlockAudio);
    };
    document.addEventListener('click', unlockAudio);
    document.addEventListener('touchstart', unlockAudio);
  }

  // =========================================================================
  // BOOTSTRAP
  // =========================================================================
  $(document).ready(() => {
    initFlipbook();
    bindEvents();
  });

})();
