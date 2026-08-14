document.addEventListener('DOMContentLoaded', () => {

  // --- Mobile Navigation Hamburger Logic ---
  const hamburger = document.querySelector('.hamburger');
  const navLinks = document.querySelector('.nav-links');

  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      const isOpen = navLinks.classList.toggle('active');
      hamburger.setAttribute('aria-expanded', String(isOpen));
      hamburger.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
    });
  }

  // --- Lite YouTube Facade Pattern ---
  // Finds elements with class .lite-youtube and a data-id attribute
  // Injects iframe only when clicked
  const youtubeEmbeds = document.querySelectorAll('.lite-youtube');
  
  youtubeEmbeds.forEach(embed => {
    const videoId = embed.getAttribute('data-id');
    const videoTitle = embed.getAttribute('data-title') || 'YouTube video';

    if(videoId && !embed.style.backgroundImage) {
      const standardThumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
      const highResolutionThumbnail = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

      embed.style.backgroundImage = `url('${standardThumbnail}')`;

      const thumbnailProbe = new Image();
      thumbnailProbe.addEventListener('load', () => {
        if (thumbnailProbe.naturalWidth >= 640) {
          embed.style.backgroundImage = `url('${highResolutionThumbnail}')`;
        }
      });
      thumbnailProbe.src = highResolutionThumbnail;
    }

    if (!embed.hasAttribute('role')) embed.setAttribute('role', 'button');
    if (!embed.hasAttribute('tabindex')) embed.setAttribute('tabindex', '0');
    if (!embed.hasAttribute('aria-label')) embed.setAttribute('aria-label', `Play ${videoTitle}`);

    const playVideo = () => {
      if(!videoId || embed.querySelector('iframe')) return;

      const iframe = document.createElement('iframe');
      iframe.setAttribute('frameborder', '0');
      iframe.setAttribute('allowfullscreen', '1');
      iframe.setAttribute('title', videoTitle);
      iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
      iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      iframe.setAttribute('src', `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&playsinline=1`);

      embed.classList.add('is-playing');
      embed.removeAttribute('role');
      embed.removeAttribute('tabindex');
      embed.removeAttribute('aria-label');
      embed.appendChild(iframe);
    };

    embed.addEventListener('click', playVideo);
    embed.addEventListener('keydown', event => {
      if(event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        playVideo();
      }
    });
  });

  // --- Wedding Collection Selector ---
  const collectionOptions = document.querySelectorAll('.collection-option');
  const selectedName = document.querySelector('[data-selected-name]');
  const selectedCoverage = document.querySelector('[data-selected-coverage]');
  const selectedPrice = document.querySelector('[data-selected-price]');

  collectionOptions.forEach(option => {
    option.addEventListener('click', () => {
      collectionOptions.forEach(candidate => {
        const isSelected = candidate === option;
        candidate.classList.toggle('is-selected', isSelected);
        candidate.setAttribute('aria-pressed', String(isSelected));
      });

      if (selectedName) selectedName.textContent = option.dataset.name;
      if (selectedCoverage) selectedCoverage.textContent = option.dataset.coverage;
      if (selectedPrice) selectedPrice.textContent = option.dataset.price;
    });
  });

  // --- Photo + Video Partner Collection Selector ---
  const partnerOptions = Array.from(document.querySelectorAll('.partner-collection'));
  const partnerSelectedName = document.querySelector('[data-partner-selected-name]');
  const partnerSelectedCoverage = document.querySelector('[data-partner-selected-coverage]');
  const partnerSelectedPrice = document.querySelector('[data-partner-selected-price]');
  const partnerInquiryLink = document.querySelector('[data-partner-inquiry-link]');

  const selectPartnerCollection = (option, updateUrl = true) => {
    if (!option) return;

    partnerOptions.forEach(candidate => {
      const isSelected = candidate === option;
      candidate.classList.toggle('is-selected', isSelected);
      candidate.setAttribute('aria-pressed', String(isSelected));
    });

    if (partnerSelectedName) partnerSelectedName.textContent = option.dataset.partnerName;
    if (partnerSelectedCoverage) partnerSelectedCoverage.textContent = option.dataset.partnerCoverage;
    if (partnerSelectedPrice) partnerSelectedPrice.textContent = option.dataset.partnerPrice;

    if (partnerInquiryLink instanceof HTMLAnchorElement) {
      const inquiryUrl = new URL(partnerInquiryLink.href, window.location.href);
      inquiryUrl.searchParams.set('collection', option.dataset.partnerCollection);
      partnerInquiryLink.href = inquiryUrl.toString();
    }

    if (updateUrl && window.history?.replaceState) {
      const pageUrl = new URL(window.location.href);
      pageUrl.searchParams.set('collection', option.dataset.partnerCollection);
      window.history.replaceState({}, '', pageUrl);
    }
  };

  if (partnerOptions.length) {
    const requestedCollection = new URLSearchParams(window.location.search).get('collection');
    const initialOption = partnerOptions.find(option => option.dataset.partnerCollection === requestedCollection)
      || partnerOptions.find(option => option.classList.contains('is-selected'))
      || partnerOptions[0];

    selectPartnerCollection(initialOption, false);
    partnerOptions.forEach(option => {
      option.addEventListener('click', () => selectPartnerCollection(option));
    });
  }

});
