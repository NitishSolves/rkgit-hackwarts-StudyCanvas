// SmartCanvas – script.js
// Smooth fade-in on scroll for feature cards

document.addEventListener('DOMContentLoaded', () => {
  const cards = document.querySelectorAll('.feature-card');

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );

  cards.forEach((card, i) => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(24px)';
    card.style.transition = `opacity 0.5s ease ${i * 0.08}s, transform 0.5s ease ${i * 0.08}s`;
    observer.observe(card);
  });

  // When card becomes visible
  document.head.insertAdjacentHTML('beforeend', `
    <style>
      .feature-card.visible {
        opacity: 1 !important;
        transform: translateY(0) !important;
      }
    </style>
  `);
});
