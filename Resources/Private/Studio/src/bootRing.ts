/**
 * Aligns the static boot ring of index.html to the wall clock - like the
 * React BootScreen does (src/app/BootScreen.tsx) - so the ring does not jump
 * back when React replaces the element, nor when the silent OAuth redirect
 * reloads the document mid-boot. A module of its own (instead of an inline
 * script) so a Content-Security-Policy without 'unsafe-inline' still lets it
 * run; it is listed before the app bundle, so it runs first.
 */
const ring = document.getElementById('neos-studio-boot-ring')
if (ring) ring.style.animationDelay = `${-(Date.now() % 1000)}ms`
