/**
 * Aligns the static boot ring of index.html to the page clock - like the
 * React BootScreen does - so the ring does not jump back when React replaces
 * the element. A module of its own (instead of an inline script) so a
 * Content-Security-Policy without 'unsafe-inline' still lets it run; it is
 * listed before the app bundle, so it runs first.
 */
const ring = document.getElementById('neos-studio-boot-ring')
if (ring) ring.style.animationDelay = `${-(performance.now() % 1000)}ms`
