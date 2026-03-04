PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  destination TEXT NOT NULL,
  date_iso TEXT NOT NULL,
  responsible TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS passengers (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  name TEXT NOT NULL,
  cpf TEXT NOT NULL,
  phone TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(trip_id) REFERENCES trips(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  passenger_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  url TEXT NOT NULL,
  public_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(passenger_id) REFERENCES passengers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_passengers_trip ON passengers(trip_id);
CREATE INDEX IF NOT EXISTS idx_docs_pass ON documents(passenger_id);