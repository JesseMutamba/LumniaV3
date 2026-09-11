// Hash history does not trigger beforeunload. Let the active workspace keep
// its unsaved-change dialog open before React unmounts that workspace.
export const BEFORE_WORKSPACE_NAVIGATION = 'lumnia:before-workspace-navigation'

// Client selectors change mounted workspaces without changing the hash.
// Give them the same save/continue decision as ordinary navigation.
export function requestWorkspaceNavigation(action, target = window) {
  let proceeded = false
  const proceed = () => {
    if (proceeded) return
    proceeded = true
    action()
  }
  const event = new target.CustomEvent(BEFORE_WORKSPACE_NAVIGATION, {
    cancelable: true,
    detail: {proceed},
  })
  target.dispatchEvent(event)
  if (!event.defaultPrevented) proceed()
}

export function subscribeWorkspaceNavigation(onChange, target = window) {
  let acceptedHash = target.location.hash
  let approvedHash = null
  const onHashChange = () => {
    const nextHash = target.location.hash
    if (nextHash === acceptedHash) return
    if (approvedHash !== nextHash) {
      const event = new target.CustomEvent(BEFORE_WORKSPACE_NAVIGATION, {
        cancelable: true,
        detail: { proceed() { approvedHash = nextHash; target.location.hash = nextHash } },
      })
      target.dispatchEvent(event)
      if (event.defaultPrevented) {
        target.history.replaceState(null, '', target.location.pathname + target.location.search + acceptedHash)
        return
      }
    }
    approvedHash = null
    acceptedHash = nextHash
    onChange()
  }
  target.addEventListener('hashchange', onHashChange)
  return () => target.removeEventListener('hashchange', onHashChange)
}
