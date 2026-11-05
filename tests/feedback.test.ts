import { describe, expect, it } from 'vitest'
import { LOCAL_SCORES_NOTE, PRIVACY_NOTE, RELEASE } from '../src/config/release'
import { feedbackMarkup } from '../src/ui/feedback'

describe('beta feedback link', () => {
  it('uses the central respondent URL without prefilled player or game data', () => {
    const url = new URL(RELEASE.feedbackUrl)
    expect(url.search).toBe('')
    expect(url.hash).toBe('')
    expect(url.pathname).toMatch(/^\/forms\/d\/e\/[A-Za-z0-9_-]+\/viewform$/)
    expect(feedbackMarkup()).toContain(`href="${RELEASE.feedbackUrl}"`)
    expect(RELEASE.label).toBe('v0.3.1 Beta')
  })

  it('renders native new-tab navigation isolated from the game tab', () => {
    const html = feedbackMarkup()
    expect(html).toContain('<a class="btn feedback-link"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('referrerpolicy="no-referrer"')
    expect(html).toContain('Feedback / Report a Bug')
    expect(html).not.toMatch(/<form|<script|data-act=|onclick=/)
  })

  it('provides non-scripted recovery instructions for blocked tabs or unavailable Forms', () => {
    const html = feedbackMarkup()
    expect(html).toContain('copy the feedback link address')
    expect(html).toContain('allow new tabs')
    expect(html).toContain('Google Forms is unavailable, try again later')
  })

  it.each(['', 'not a url', 'javascript:alert(1)', 'https://example.com/viewform',
    `${RELEASE.feedbackUrl}?score=123`, `${RELEASE.feedbackUrl}#player`,
    'https://docs.google.com/forms/d/e/"onclick="bad/viewform',
  ])('degrades safely for invalid configuration: %s', (url) => {
    const html = feedbackMarkup(url)
    expect(html).not.toContain('<a')
    expect(html).not.toContain(url || 'href=')
    expect(html).toContain('Feedback is temporarily unavailable')
  })

  it('explains browser-local scores and separate feedback privacy', () => {
    expect(LOCAL_SCORES_NOTE).toBe('Scores are saved in this browser only. They are not shared online or synchronized between devices. Clearing browser data may erase them.')
    expect(PRIVACY_NOTE).toContain('Game progress and high scores are stored locally in this browser')
    expect(PRIVACY_NOTE).toContain('Feedback is submitted separately through Google Forms')
    expect(PRIVACY_NOTE).toContain('avoid including sensitive personal information')
  })
})
