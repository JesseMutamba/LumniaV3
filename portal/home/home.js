// A bounded public demonstration. No upload, account or client data is accessed.
(() => {
  const button = document.getElementById('add-region')
  const chart = document.getElementById('region-chart')
  const status = document.getElementById('preview-status')
  if (button && chart && status) button.addEventListener('click', () => {
    const expanded = button.getAttribute('aria-expanded') !== 'true'
    button.setAttribute('aria-expanded', String(expanded))
    chart.hidden = !expanded
    button.innerHTML = expanded
      ? 'Remove region breakdown <span aria-hidden="true">−</span>'
      : 'Try it: add revenue by region <span aria-hidden="true">+</span>'
    status.textContent = expanded
      ? 'Region breakdown added. Your monthly revenue chart stays in place.'
      : 'One dashboard. Keep building on the same analysis.'
  })
  const menu = document.querySelector('.mobile-nav')
  if (menu) {
    menu.querySelectorAll('a').forEach(link => link.addEventListener('click', () => { menu.open = false }))
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape' && menu.open) {
        menu.open = false
        menu.querySelector('summary').focus()
      }
    })
    document.addEventListener('click', event => { if (!menu.contains(event.target)) menu.open = false })
  }
})()
