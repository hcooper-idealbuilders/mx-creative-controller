import { describe, it, expect } from 'vitest'
import { isPermissionPrompt } from './notification.js'

describe('isPermissionPrompt', () => {
  it('null/undefined/empty → false (safety default)', () => {
    expect(isPermissionPrompt(null)).toBe(false)
    expect(isPermissionPrompt(undefined)).toBe(false)
    expect(isPermissionPrompt('')).toBe(false)
  })

  it('unknown phrasing → false (safety default)', () => {
    expect(isPermissionPrompt('Want me to refactor this instead?')).toBe(false)
    expect(isPermissionPrompt('Should I proceed with option A or B?')).toBe(false)
  })

  it('tool permission prompts → true (current-task, safe to Approve)', () => {
    // Real samples captured from hooks-debug.log. The trailing tool name
    // varies (Bash, Edit, Write, …) so we match the stable prefix.
    expect(isPermissionPrompt('Claude needs your permission to use Bash')).toBe(true)
    expect(isPermissionPrompt('Claude needs your permission to use Edit')).toBe(true)
    expect(isPermissionPrompt('Claude needs your permission to use Write')).toBe(true)
  })
})
