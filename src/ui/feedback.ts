import { RELEASE } from '../config/release'

/** A native user-activated link: no popup script, form submission, telemetry, or game-state callbacks. */
export function feedbackMarkup(configuredUrl: string = RELEASE.feedbackUrl): string {
  let url: URL
  try {
    url = new URL(configuredUrl)
    if (url.origin !== 'https://docs.google.com' ||
        !/^\/forms\/d\/e\/[A-Za-z0-9_-]+\/viewform$/.test(url.pathname) ||
        url.username || url.password || url.search || url.hash) throw new Error('Invalid feedback URL')
  } catch {
    return '<p class="fine feedback-help" role="status">Feedback is temporarily unavailable. Please try again later. Your game progress is unchanged.</p>'
  }
  return `<div class="feedback">
    <a class="btn feedback-link" href="${url.href}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Feedback / Report a Bug</a>
    <details class="fine feedback-help"><summary>Opens Google Forms in a new tab. Trouble opening it?</summary>
      <p>If a tab is blocked, allow new tabs or copy the feedback link address and open it manually. If Google Forms is unavailable, try again later. No game data is attached to the link.</p>
    </details>
  </div>`
}
