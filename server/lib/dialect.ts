import type { DatabaseSync, StatementSync } from 'node:sqlite'
import {
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type QueryResult,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type CompiledQuery,
  type Kysely,
} from 'kysely'

class NodeSqliteConnection implements DatabaseConnection {
  readonly #open: DatabaseSync

  constructor(open: DatabaseSync) {
    this.#open = open
  }

  async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    const statement: StatementSync = this.#open.prepare(compiled.sql)
    const parameters = compiled.parameters as never[]

    if (compiled.query.kind === 'SelectQueryNode') {
      return { rows: statement.all(...parameters) as R[] }
    }

    const result = statement.run(...parameters)

    return {
      rows: [],
      numAffectedRows: BigInt(result.changes),
      insertId: result.lastInsertRowid === undefined ? undefined : BigInt(result.lastInsertRowid),
    }
  }

  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('ccwt does not stream queries; node:sqlite is synchronous.')
  }
}

class NodeSqliteDriver implements Driver {
  readonly #openDatabase: () => DatabaseSync
  #connection: NodeSqliteConnection | undefined
  #open: DatabaseSync | undefined
  #queue: Promise<unknown> = Promise.resolve()

  constructor(openDatabase: () => DatabaseSync) {
    this.#openDatabase = openDatabase
  }

  async init(): Promise<void> {
    this.#open = this.#openDatabase()
    this.#connection = new NodeSqliteConnection(this.#open)
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    const held = this.#connection
    if (!held) throw new Error('The database driver was used before it was initialised.')

    let release = () => {}
    const taken = new Promise<void>((done) => {
      release = done
    })

    const waited = this.#queue
    this.#queue = waited.then(() => taken)
    await waited

    releases.set(held, release)
    return held
  }

  async releaseConnection(connection: DatabaseConnection): Promise<void> {
    const release = releases.get(connection)
    releases.delete(connection)
    release?.()
  }

  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(raw('BEGIN'))
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(raw('COMMIT'))
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(raw('ROLLBACK'))
  }

  async destroy(): Promise<void> {
    this.#open?.close()
    this.#open = undefined
    this.#connection = undefined
  }
}

const releases = new WeakMap<DatabaseConnection, () => void>()

function raw(sql: string): CompiledQuery {
  return {
    sql,
    parameters: [],
    query: { kind: 'RawNode', sqlFragments: [sql], parameters: [] },
  } as unknown as CompiledQuery
}

export function nodeSqliteDialect(openDatabase: () => DatabaseSync): Dialect {
  return {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => new NodeSqliteDriver(openDatabase),
    createQueryCompiler: () => new SqliteQueryCompiler(),
    createIntrospector: (database: Kysely<unknown>) => new SqliteIntrospector(database),
  }
}
