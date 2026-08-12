export class NotImplemented extends Error {
  readonly milestone: number

  constructor(what: string, milestone: number) {
    super(`${what} is not built yet — Milestone ${milestone}.`)
    this.name = 'NotImplemented'
    this.milestone = milestone
  }
}

export function stub(what: string, milestone: number): never {
  throw new NotImplemented(what, milestone)
}
