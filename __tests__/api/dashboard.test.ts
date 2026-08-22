import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { loadDashboardData } from "@/lib/dashboard-data";
import * as schema from "@/lib/db/schema";

describe("loadDashboardData", () => {
  let sqlite: Database.Database | undefined;

  afterEach(() => sqlite?.close());

  it("excludes pending-delete nodes from counts, recent nodes, and traffic", () => {
    sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE nodes (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        ip TEXT NOT NULL,
        wg_address TEXT NOT NULL,
        status TEXT NOT NULL,
        pending_delete INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE node_status (
        node_id INTEGER NOT NULL,
        upload_bytes INTEGER NOT NULL,
        download_bytes INTEGER NOT NULL,
        forward_upload_bytes INTEGER NOT NULL,
        forward_download_bytes INTEGER NOT NULL
      );
      CREATE TABLE devices (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        protocol TEXT NOT NULL,
        wg_address TEXT,
        last_handshake TEXT,
        line_id INTEGER,
        connection_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE lines (
        id INTEGER PRIMARY KEY,
        status TEXT NOT NULL
      );

      INSERT INTO nodes VALUES
        (1, 'active-online', '192.0.2.1', '10.210.0.1', 'online', 0, '2026-08-20T00:00:00.000Z'),
        (2, 'active-error', '192.0.2.2', '10.210.0.2', 'error', 0, '2026-08-21T00:00:00.000Z'),
        (3, 'deleted-node', '192.0.2.3', '10.210.0.3', 'offline', 1, '2026-08-22T00:00:00.000Z');
      INSERT INTO node_status VALUES
        (1, 100, 200, 10, 20),
        (2, 300, 400, 30, 40),
        (3, 500, 600, 50, 60);
    `);

    const database = drizzle(sqlite, { schema });
    const data = loadDashboardData(
      database as unknown as Parameters<typeof loadDashboardData>[0],
      Date.parse("2026-08-22T00:00:00.000Z")
    );

    expect(data.nodes).toEqual({ total: 2, online: 1, offline: 0, error: 1 });
    expect(data.recentNodes.map((node) => node.id)).toEqual([2, 1]);
    expect(data.traffic.nodes.map((node) => node.nodeId)).toEqual([1, 2]);
    expect(data.traffic).toMatchObject({
      totalUploadBytes: 400,
      totalDownloadBytes: 600,
      totalForwardUploadBytes: 40,
      totalForwardDownloadBytes: 60,
    });
  });
});
