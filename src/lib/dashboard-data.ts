import { and, count, desc, eq, gt, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { devices, lines, nodes, nodeStatus } from "@/lib/db/schema";
import { computeDeviceStatus, STATELESS_PROTOCOLS } from "@/lib/device-status";

export function loadDashboardData(database: typeof db = db, now = Date.now()) {
  const activeNode = eq(nodes.pendingDelete, false);

  const totalNodes = database.select({ count: count() }).from(nodes).where(activeNode).get()?.count ?? 0;
  const onlineNodes = database
    .select({ count: count() })
    .from(nodes)
    .where(and(activeNode, eq(nodes.status, "online")))
    .get()?.count ?? 0;
  const offlineNodes = database
    .select({ count: count() })
    .from(nodes)
    .where(and(activeNode, eq(nodes.status, "offline")))
    .get()?.count ?? 0;
  const errorNodes = database
    .select({ count: count() })
    .from(nodes)
    .where(and(activeNode, eq(nodes.status, "error")))
    .get()?.count ?? 0;

  // Stateless proxy devices count toward the total but have no online/offline state.
  const totalDevices = database.select({ count: count() }).from(devices).get()?.count ?? 0;
  const deviceThreshold = new Date(now - 10 * 60 * 1000).toISOString();
  const statefulOnly = notInArray(devices.protocol, [...STATELESS_PROTOCOLS]);
  const onlineDevices = database
    .select({ count: count() })
    .from(devices)
    .where(and(statefulOnly, gt(devices.lastHandshake, deviceThreshold)))
    .get()?.count ?? 0;
  const offlineDevices = database
    .select({ count: count() })
    .from(devices)
    .where(and(statefulOnly, or(isNull(devices.lastHandshake), lte(devices.lastHandshake, deviceThreshold))))
    .get()?.count ?? 0;

  const totalLines = database.select({ count: count() }).from(lines).get()?.count ?? 0;
  const activeLines = database
    .select({ count: count() })
    .from(lines)
    .where(eq(lines.status, "active"))
    .get()?.count ?? 0;
  const inactiveLines = database
    .select({ count: count() })
    .from(lines)
    .where(eq(lines.status, "inactive"))
    .get()?.count ?? 0;

  const trafficRows = database
    .select({
      nodeId: nodeStatus.nodeId,
      nodeName: nodes.name,
      nodeIp: nodes.ip,
      uploadBytes: sql<number>`sum(${nodeStatus.uploadBytes})`,
      downloadBytes: sql<number>`sum(${nodeStatus.downloadBytes})`,
      forwardUploadBytes: sql<number>`COALESCE(SUM(${nodeStatus.forwardUploadBytes}), 0)`,
      forwardDownloadBytes: sql<number>`COALESCE(SUM(${nodeStatus.forwardDownloadBytes}), 0)`,
    })
    .from(nodeStatus)
    .innerJoin(nodes, eq(nodeStatus.nodeId, nodes.id))
    .where(activeNode)
    .groupBy(nodeStatus.nodeId)
    .limit(1000)
    .all();

  const trafficWithNames = trafficRows.map((row) => ({
    ...row,
    uploadBytes: row.uploadBytes ?? 0,
    downloadBytes: row.downloadBytes ?? 0,
    forwardUploadBytes: row.forwardUploadBytes ?? 0,
    forwardDownloadBytes: row.forwardDownloadBytes ?? 0,
  }));

  const recentNodes = database
    .select({
      id: nodes.id,
      name: nodes.name,
      ip: nodes.ip,
      wgAddress: nodes.wgAddress,
      status: nodes.status,
      updatedAt: nodes.updatedAt,
    })
    .from(nodes)
    .where(activeNode)
    .orderBy(desc(nodes.updatedAt))
    .limit(10)
    .all();

  const recentDevicesRaw = database
    .select({
      id: devices.id,
      name: devices.name,
      protocol: devices.protocol,
      wgAddress: devices.wgAddress,
      lastHandshake: devices.lastHandshake,
      lineId: devices.lineId,
      connectionCount: devices.connectionCount,
      updatedAt: devices.updatedAt,
    })
    .from(devices)
    .orderBy(desc(devices.updatedAt))
    .limit(10)
    .all();
  const recentDevices = recentDevicesRaw.map((device) => ({
    ...device,
    status: computeDeviceStatus(device.lastHandshake, device.protocol),
  }));

  return {
    nodes: { total: totalNodes, online: onlineNodes, offline: offlineNodes, error: errorNodes },
    devices: { total: totalDevices, online: onlineDevices, offline: offlineDevices },
    lines: { total: totalLines, active: activeLines, inactive: inactiveLines },
    traffic: {
      totalUploadBytes: trafficWithNames.reduce((sum, row) => sum + row.uploadBytes, 0),
      totalDownloadBytes: trafficWithNames.reduce((sum, row) => sum + row.downloadBytes, 0),
      totalForwardUploadBytes: trafficWithNames.reduce((sum, row) => sum + row.forwardUploadBytes, 0),
      totalForwardDownloadBytes: trafficWithNames.reduce((sum, row) => sum + row.forwardDownloadBytes, 0),
      nodes: trafficWithNames,
    },
    recentNodes,
    recentDevices,
  };
}
