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
    CREATE TABLE IF NOT EXISTS Veiculos (
      placa TEXT PRIMARY KEY,
      descricao TEXT
    );
    CREATE TABLE IF NOT EXISTS LeiturasVeiculos (
      id TEXT PRIMARY KEY,
      placa TEXT,
      matricula_condutor TEXT,
      nome_condutor TEXT,
      credencial_condutor TEXT,
      data_hora_leitura TEXT,
      id_celular TEXT,
      situacao INTEGER,
      sincronizado INTEGER DEFAULT 0
    );
  `);

  try {
    await db.execAsync(`ALTER TABLE LeiturasVeiculos ADD COLUMN credencial_condutor TEXT;`);
  } catch (e) {
    // Ignora se a coluna já existir
  }
  
  try {
    await db.execAsync(`ALTER TABLE LeiturasVeiculos ADD COLUMN id_portaria INTEGER;`);
  } catch (e) {
    // Ignora
  }

  try {
    await db.execAsync(`ALTER TABLE LeiturasVeiculos ADD COLUMN sentido TEXT;`);
  } catch (e) {
    // Ignora
  }

  try {
    await db.execAsync(`ALTER TABLE LeiturasVeiculos ADD COLUMN is_condutor INTEGER;`);
  } catch (e) {
    // Ignora
  }
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

// Veiculos Sync & Queries

export async function clearVeiculos() {
  const db = await getDB();
  await db.execAsync("DELETE FROM Veiculos");
}

export async function insertVeiculos(veiculos: any[]) {
  const db = await getDB();
  await db.withTransactionAsync(async () => {
    for (const v of veiculos) {
      await db.runAsync(
        "INSERT OR REPLACE INTO Veiculos (placa, descricao) VALUES (?, ?)",
        [v.placa, v.descricao],
      );
    }
  });
}

export async function findVeiculoByPlaca(placa: string) {
  const db = await getDB();
  const result = await db.getFirstAsync(
    "SELECT * FROM Veiculos WHERE placa = ?",
    [placa],
  );
  return result as any;
}

export async function saveLeituraVeiculo(
  id: string,
  placa: string,
  matricula_condutor: string,
  nome_condutor: string,
  credencial_condutor: string,
  id_portaria: number,
  sentido: string,
  data_hora_leitura: string,
  id_celular: string,
  situacao: number,
  is_condutor: number
) {
  const db = await getDB();
  await db.runAsync(
    "INSERT INTO LeiturasVeiculos (id, placa, matricula_condutor, nome_condutor, credencial_condutor, id_portaria, sentido, data_hora_leitura, id_celular, situacao, is_condutor, sincronizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
    [id, placa, matricula_condutor, nome_condutor, credencial_condutor, id_portaria, sentido, data_hora_leitura, id_celular, situacao, is_condutor],
  );
}

export async function getUnsyncedLeiturasVeiculos() {
  const db = await getDB();
  const results = await db.getAllAsync(
    "SELECT * FROM LeiturasVeiculos WHERE sincronizado = 0",
  );
  return results as any[];
}

export async function markLeiturasVeiculosAsSynced(ids: string[]) {
  if (ids.length === 0) return;
  const db = await getDB();
  await db.withTransactionAsync(async () => {
    for (const id of ids) {
      await db.runAsync("UPDATE LeiturasVeiculos SET sincronizado = 1 WHERE id = ?", [
        id,
      ]);
    }
  });
}
