
const fs = require("fs");
let content = fs.readFileSync("src/features/research-repository.ts", "utf8");

content = content.replace("CREATE TABLE IF NOT EXISTS data_source_health (", `
    CREATE TABLE IF NOT EXISTS data_snapshots (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS evidence_bundles (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lineage_refs (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS alert_deliveries (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS data_source_health (`);

content = content.replace("saveSourceHealth(id: string, data: any)", `
  saveDataSnapshot(snapshot: any) {
    db.prepare("INSERT OR REPLACE INTO data_snapshots (id, data) VALUES (?, ?)").run(snapshot.id, JSON.stringify(snapshot));
  },
  getDataSnapshot(id: string) {
    const row = db.prepare("SELECT data FROM data_snapshots WHERE id = ?").get(id) as any;
    return row ? JSON.parse(row.data) : null;
  },
  saveEvidenceBundle(bundle: any) {
    db.prepare("INSERT OR REPLACE INTO evidence_bundles (id, data) VALUES (?, ?)").run(bundle.id, JSON.stringify(bundle));
  },
  getEvidenceBundle(id: string) {
    const row = db.prepare("SELECT data FROM evidence_bundles WHERE id = ?").get(id) as any;
    return row ? JSON.parse(row.data) : null;
  },
  saveLineageRef(lineage: any) {
    db.prepare("INSERT OR REPLACE INTO lineage_refs (id, data) VALUES (?, ?)").run(lineage.id, JSON.stringify(lineage));
  },
  getLineageRef(id: string) {
    const row = db.prepare("SELECT data FROM lineage_refs WHERE id = ?").get(id) as any;
    return row ? JSON.parse(row.data) : null;
  },
  saveAlertDelivery(delivery: any) {
    db.prepare("INSERT OR REPLACE INTO alert_deliveries (id, data) VALUES (?, ?)").run(delivery.id, JSON.stringify(delivery));
  },
  getAlertDelivery(id: string) {
    const row = db.prepare("SELECT data FROM alert_deliveries WHERE id = ?").get(id) as any;
    return row ? JSON.parse(row.data) : null;
  },
  saveSourceHealth(id: string, data: any)`);

fs.writeFileSync("src/features/research-repository.ts", content);

