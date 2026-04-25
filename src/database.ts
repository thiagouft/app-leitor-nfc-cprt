import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";

let dbPromise: Promise<SQLiteDatabase> | null = null;
let cachedDb: SQLiteDatabase | null = null;

export async function getDB() {
  if (cachedDb) {
    return cachedDb;
  }
  if (!dbPromise) {
    dbPromise = openDatabaseAsync("cprt_v1.db");
  }
  cachedDb = await dbPromise;
  return cachedDb;
}

export async function initDB() {
  const db = await getDB();

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS Pessoas (
      matricula TEXT PRIMARY KEY,
      nome TEXT,
      credencial TEXT,
      situacao INTEGER
    );
    CREATE TABLE IF NOT EXISTS Leituras (
      id TEXT PRIMARY KEY,
      credencial TEXT,
      id_portaria INTEGER,
      data_hora_leitura TEXT,
      id_celular TEXT,
      situacao INTEGER,
      sincronizado INTEGER DEFAULT 0
    );
  `);
}

export async function clearPessoas() {
  const db = await getDB();
  await db.execAsync("DELETE FROM Pessoas");
}

export async function insertPessoas(pessoas: any[]) {
  const db = await getDB();
  await db.withTransactionAsync(async () => {
    for (const p of pessoas) {
      await db.runAsync(
        "INSERT OR REPLACE INTO Pessoas (matricula, nome, credencial, situacao) VALUES (?, ?, ?, ?)",
        [p.matricula, p.nome, p.credenciais || "", p.situacao],
      );
    }
  });
}

export async function findPessoaByCredencial(credencial: string) {
  const db = await getDB();
  const result = await db.getFirstAsync(
    "SELECT * FROM Pessoas WHERE credencial = ?",
    [credencial],
  );
  return result as any;
}

export async function saveLeitura(
  id: string,
  credencial: string,
  id_portaria: number,
  data_hora: string,
  id_celular: string,
  situacao: number,
) {
  const db = await getDB();
  await db.runAsync(
    "INSERT INTO Leituras (id, credencial, id_portaria, data_hora_leitura, id_celular, situacao, sincronizado) VALUES (?, ?, ?, ?, ?, ?, 0)",
    [id, credencial, id_portaria, data_hora, id_celular, situacao],
  );
}

export async function getUnsyncedLeituras() {
  const db = await getDB();
  const results = await db.getAllAsync(
    "SELECT * FROM Leituras WHERE sincronizado = 0",
  );
  return results as any[];
}

export async function markLeiturasAsSynced(ids: string[]) {
  if (ids.length === 0) return;
  const db = await getDB();
  await db.withTransactionAsync(async () => {
    for (const id of ids) {
      await db.runAsync("UPDATE Leituras SET sincronizado = 1 WHERE id = ?", [
        id,
      ]);
    }
  });
}
