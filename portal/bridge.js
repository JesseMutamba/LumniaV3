/* Route public entry points without reading or modifying client credentials. */
(() => {
  function sync() {
    const hash = window.location.hash || '#/'
    const legacy = /^\/legacy(?:\/|$)/.test(window.location.pathname)
    if (hash === '#signin') {
      window.location.replace('/workspace/#/analysis')
      return
    }
    if (/^#\/(?:analysis|studio|financial|reports|published)(?:[/?]|$)/.test(hash)) {
      window.location.replace('/workspace/' + hash)
      return
    }
    if (/^#\/(?:r|m|c|a)(?:\/|$)/.test(hash)) {
      if (!legacy) window.location.replace('/legacy/' + hash)
      return
    }
    // The preserved viewer's brand/home links should return to the current
    // public page. Its old marketing and sign-in screen are no longer entries.
    if (legacy) window.location.replace(hash === '#/' ? '/' : '/' + hash)
  }
  window.addEventListener('hashchange', sync)
  sync()
})()
