document.addEventListener('DOMContentLoaded', () => {

  // --- Mobile Navigation Hamburger Logic ---
  const hamburger = document.querySelector('.hamburger');
  const navLinks = document.querySelector('.nav-links');

  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      navLinks.classList.toggle('active');
    });
  }

  // --- Lite YouTube Facade Pattern ---
  // Finds elements with class .lite-youtube and a data-id attribute
  // Injects iframe only when clicked
  const youtubeEmbeds = document.querySelectorAll('.lite-youtube');
  
  youtubeEmbeds.forEach(embed => {
    // Optionally load thumbnail if data-id is valid youtube ID
    const videoId = embed.getAttribute('data-id');
    if(videoId && !embed.style.backgroundImage) {
      embed.style.backgroundImage = `url('https://img.youtube.com/vi/${videoId}/maxresdefault.jpg')`;
    }

    embed.addEventListener('click', () => {
      // Prevent multiple clicks
      if(embed.querySelector('iframe')) return;
      
      const iframe = document.createElement('iframe');
      iframe.setAttribute('frameborder', '0');
      iframe.setAttribute('allowfullscreen', '1');
      iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
      
      // Auto-play the video when the facade is clicked
      iframe.setAttribute('src', `https://www.youtube.com/embed/${videoId}?autoplay=1`);
      
      embed.appendChild(iframe);
    });
  });

});
