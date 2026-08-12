import { NotImplemented } from '../lib/stub'

export async function guard<T>(run: () => Promise<T> | T): Promise<T> {
  try {
    return await run()
  } catch (cause) {
    if (cause instanceof NotImplemented) {
      throw createError({
        statusCode: 501,
        statusMessage: 'Not implemented',
        message: cause.message,
      })
    }
    throw cause
  }
}
