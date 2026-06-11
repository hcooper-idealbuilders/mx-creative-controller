import { describe, it, expect } from 'vitest'
import { indicatesApproval, type ChildProcessInfo } from './approval-detector.js'

const child = (name: string, created: number): ChildProcessInfo => ({ pid: 1, name, created })

describe('indicatesApproval', () => {
  const promptAt = 1_000_000

  it('no children → false', () => {
    expect(indicatesApproval([], promptAt)).toBe(false)
  })

  it('children older than the prompt (MCP servers, shell snapshots) → false', () => {
    expect(indicatesApproval([child('node.exe', promptAt - 60_000)], promptAt)).toBe(false)
  })

  it('child created just inside the clock-skew margin → false', () => {
    expect(indicatesApproval([child('pwsh.exe', promptAt + 500)], promptAt)).toBe(false)
  })

  it('tool child spawned after the prompt → true', () => {
    expect(indicatesApproval([child('pwsh.exe', promptAt + 5_000)], promptAt)).toBe(true)
    expect(indicatesApproval([child('bash.exe', promptAt + 5_000)], promptAt)).toBe(true)
    expect(indicatesApproval([child('cmd.exe', promptAt + 5_000)], promptAt)).toBe(true)
  })

  it('powershell.exe children are ignored (our own hooks)', () => {
    expect(indicatesApproval([child('powershell.exe', promptAt + 5_000)], promptAt)).toBe(false)
    expect(indicatesApproval([child('PowerShell.EXE', promptAt + 5_000)], promptAt)).toBe(false)
  })

  it('mixed set: one qualifying child is enough', () => {
    expect(
      indicatesApproval(
        [
          child('node.exe', promptAt - 60_000),
          child('powershell.exe', promptAt + 3_000),
          child('bash.exe', promptAt + 4_000),
        ],
        promptAt,
      ),
    ).toBe(true)
  })
})
