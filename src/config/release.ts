/** Public release/support metadata. Never append player or saved-game data to feedback links. */
export const RELEASE = {
  label: 'v0.3.1 Beta',
  feedbackUrl: 'https://docs.google.com/forms/d/e/1FAIpQLScJ8TuvCirbqvg3FgZIOsZ64wCOHKtzJAOzRJWOdpJqREWSYg/viewform',
} as const

// Version prefilling is deliberately disabled: no documented Google Forms entry ID was supplied.
export const LOCAL_SCORES_NOTE = 'Scores are saved in this browser only. They are not shared online or synchronized between devices. Clearing browser data may erase them.'
export const PRIVACY_NOTE = 'Game progress and high scores are stored locally in this browser. Feedback is submitted separately through Google Forms. Please avoid including sensitive personal information.'
