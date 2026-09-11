/* First-party entry from the preserved public portal into the new workspace. */
(() => {
  function sync() {
    const hash = window.location.hash || '#/'
    if (hash === '#signin') {
      window.location.replace('/workspace/#/analysis')
      return
    }
    if (/^#\/(?:analysis|studio|financial|reports)(?:[/?]|$)/.test(hash)) {
      window.location.replace('/workspace/' + hash)
      return
    }
    const entry = document.getElementById('lumnia-workspace-entry')
    if (entry) entry.hidden = /^#\/(?:r|m|c|a)\//.test(hash)
  }
  window.addEventListener('hashchange', sync)
  sync()
})()
